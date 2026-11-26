# ohhell-photo relay

A Cloudflare Worker that reads hand photos for the Photo button in `ohhell.html`. The worker holds the Anthropic API key, so people using the page only need the group password. The free Workers plan is enough.

The worker isn't a general proxy. The prompt, tool, model list (Sonnet 5.5 or Opus 5.5) and token limit are fixed in `ohhell-photo.js`. It only accepts requests from `https://agniel.github.io` that carry the right password, and it stops after a daily number of photos.

## Deploy from the Cloudflare dashboard

1. **Create the worker.** Go to Workers & Pages → Create → Create Worker. Name it `ohhell-photo` and click Deploy, then Edit code. Replace the starter code with the contents of `ohhell-photo.js` and deploy again.
2. **Add the secrets.** Open the worker's Settings → Variables and Secrets, and add:
   - `ANTHROPIC_API_KEY` (Secret): your key from console.anthropic.com
   - `ACCESS_CODE` (Secret): the password your group will type in
   - `DAILY_LIMIT` (Text, optional): photos per UTC day. The default is 200.
3. **Add the daily counter.** Go to Storage & Databases → KV → Create namespace and call it `ohhell-photo-usage`. Then open the worker's Settings → Bindings → Add → KV namespace. Set the variable name to `USAGE` and pick that namespace. If you skip this step there's no daily cap.
4. **Point the page at the worker.** Copy the worker's URL, which looks like `https://ohhell-photo.<your-subdomain>.workers.dev`. In `ohhell.html`, set `RELAY_URL` to that URL.

## Spend control

- Each photo costs roughly 1–2¢ on Sonnet 5.5 and a few cents on Opus 5.5.
- A failed read still counts toward the daily cap, so the cap limits attempts as well as successes.
- As a hard backstop, set a monthly spend limit in the Anthropic Console under Settings → Limits.
- To lock everyone out, change `ACCESS_CODE`. Saved passwords are cleared the first time they're rejected.
