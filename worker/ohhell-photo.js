/*
  ohhell-photo - Cloudflare Worker relay for the Oh Hell bid calculator's Photo button.
  Copyright (C) 2026  Jim Agniel.  GNU GPL v3 or later (see ../LICENSE).

  Holds the Anthropic API key so the page never sees it. It is NOT a general
  proxy: the prompt, tool, model list and token limit are fixed here, and the
  browser can only send an image and pick between two models.

  Settings (Cloudflare dashboard -> Worker -> Settings -> Variables and Secrets):
    ANTHROPIC_API_KEY  secret  your Anthropic key
    ACCESS_CODE        secret  the group password typed into the page
    DAILY_LIMIT        text    optional, photos allowed per UTC day (default 200)
    ALLOWED_ORIGINS    text    optional, comma-separated (default https://agniel.github.io)
  Binding (Settings -> Bindings -> KV namespace):
    USAGE              KV namespace used for the daily counter (optional but recommended;
                       without it there is no daily cap)
*/

const MODELS = ["claude-sonnet-5-5", "claude-opus-5-5"];
const MAX_IMAGE_B64 = 6_000_000;   // ~4.5 MB decoded; the page sends ~300-600 KB

const TOOL = {
  name: "report_hand",
  description: "Report every playing card held in the player's hand in the photo.",
  input_schema: {
    type: "object",
    properties: {
      cards: { type: "array", items: { type: "object", properties: {
        rank: { type: "string", enum: ["2","3","4","5","6","7","8","9","10","J","Q","K","A"] },
        suit: { type: "string", enum: ["spades","hearts","diamonds","clubs"] },
        confident: { type: "boolean", description: "false if the index was partly hidden, blurred or ambiguous" }
      }, required: ["rank","suit","confident"] } },
      notes: { type: "string", description: "Brief note on anything ambiguous: overlapping cards, glare, cards that might be on the table rather than in hand. Empty if none." }
    },
    required: ["cards","notes"]
  }
};

const PROMPT = "This is a photo of a player's hand in a card game played with one standard 52-card deck (no jokers). "
  + "Identify every card in the hand. In a fanned hand most cards show only their corner index (rank and suit pip), so read each corner "
  + "carefully and count each physical card exactly once. Tell hearts from diamonds and spades from clubs by pip shape, not colour alone. "
  + "No card can appear twice. If cards lying face-up on a table are also visible, report only the held hand and mention the others in notes. "
  + "Mark a card confident=false if you had to guess any part of it. Answer with the report_hand tool.";

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || "https://agniel.github.io").split(",").map(s => s.trim());
    const origin = req.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "content-type, x-access-code",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const reply = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...cors, "content-type": "application/json" } });

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method !== "POST") return reply(405, { error: "POST only" });
    if (!allowed.includes(origin)) return reply(403, { error: "This relay only serves the Oh Hell calculator." });
    if (!env.ANTHROPIC_API_KEY || !env.ACCESS_CODE) return reply(500, { error: "Relay isn't configured yet (missing secrets)." });
    if (!safeEqual(req.headers.get("x-access-code") || "", env.ACCESS_CODE)) return reply(401, { error: "Wrong group password." });

    let body;
    try { body = await req.json(); } catch { return reply(400, { error: "Bad request." }); }
    const image = typeof body.image === "string" ? body.image : "";
    const model = MODELS.includes(body.model) ? body.model : MODELS[0];
    if (!image || image.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200)))
      return reply(400, { error: "Missing or oversized image." });

    // Daily cap. KV is eventually consistent, so this is approximate - fine for a spend guard.
    if (env.USAGE) {
      const day = "n:" + new Date().toISOString().slice(0, 10);
      const used = parseInt(await env.USAGE.get(day) || "0", 10);
      const limit = parseInt(env.DAILY_LIMIT || "200", 10);
      if (used >= limit) return reply(429, { error: "Daily photo limit reached. Try again tomorrow or enter the cards by hand." });
      await env.USAGE.put(day, String(used + 1), { expirationTtl: 60 * 60 * 48 });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model, max_tokens: 1024, tools: [TOOL], tool_choice: { type: "tool", name: "report_hand" },
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image } },
          { type: "text", text: PROMPT }
        ]}]
      })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return reply(502, { error: "Anthropic API error: " + ((j.error && j.error.message) || ("HTTP " + r.status)) });
    const use = (j.content || []).find(b => b.type === "tool_use");
    if (!use) return reply(502, { error: "The model didn't return a hand. Try a clearer photo." });
    return reply(200, use.input);
  }
};

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
