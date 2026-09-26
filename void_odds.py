"""
Oh Hell void odds: exact probabilities, no simulation.

For N players each dealt M cards from a 52-card deck (rest undealt), computes
P(exactly j of the N players hold exactly k voids) and
P(exactly j of the N players hold at least k voids), for k = 0..3.

Method
  A deal is summarised by its suit-count matrix c[i][s] = cards of suit s in hand i.
  The number of deals with a given matrix is
      prod_s 13! / (prod_i c[i][s]! * (13 - sum_i c[i][s])!)
  A dynamic program walks the hands one at a time. The state is the running
  column sums (cards of each suit used so far) plus j, the number of hands so far
  that meet the void condition. Each hand contributes weight 1 / prod_s c[i][s]!;
  the per-suit factor 13!/(13 - col_s)! is applied once at the end.
  Normalising by the total gives exact probabilities.

Checks (run automatically)
  1. The summed count equals the true number of deals, 52! / (M!^N (52-NM)!).
  2. Expected number of qualifying hands = N * single-hand probability (linearity).
  3. P(no player has >= 1 void) equals P(all N players have exactly 0 voids).

Usage
  python void_odds.py            # prints tables, writes void_odds.json and void_odds.csv
  Requires numpy. Covers 3-7 players and every hand size up to floor(52 / N).
"""
import csv
import itertools
import json
from math import comb, factorial, lgamma, exp

import numpy as np

SUITS, RANKS = 4, 13
SIZE = RANKS + 1  # column sums run 0..13


def single_hand(M, k):
    """P(one M-card hand has exactly k voids), by inclusion-exclusion."""
    s = SUITS - k
    ways = sum((-1) ** j * comb(s, j) * comb(RANKS * (s - j), M) for j in range(s + 1))
    return comb(SUITS, k) * ways / comb(52, M)


def table_distribution(N, M, k, at_least=False):
    """P(exactly j of N hands meet the void condition), j = 0..N."""
    rows = [r for r in itertools.product(range(min(M, RANKS) + 1), repeat=SUITS) if sum(r) == M]
    A = np.zeros((N + 1,) + (SIZE,) * SUITS)
    A[(0,) + (0,) * SUITS] = 1.0
    for _ in range(N):
        B = np.zeros_like(A)
        for r in rows:
            voids = sum(x == 0 for x in r)
            hit = voids >= k if at_least else voids == k
            w = 1.0 / np.prod([factorial(x) for x in r])
            a, b, c, d = r
            src = A[:, :SIZE - a, :SIZE - b, :SIZE - c, :SIZE - d] * w
            if hit:
                B[1:, a:, b:, c:, d:] += src[:-1]
            else:
                B[:, a:, b:, c:, d:] += src
        A = B
    g = np.array([factorial(RANKS) / factorial(RANKS - c) for c in range(SIZE)])
    W = g[:, None, None, None] * g[None, :, None, None] * g[None, None, :, None] * g[None, None, None, :]
    counts = (A * W).reshape(N + 1, -1).sum(axis=1)

    # Check 1: total matches the true number of deals.
    true_deals = exp(lgamma(53) - N * lgamma(M + 1) - lgamma(53 - N * M))
    assert abs(counts.sum() / true_deals - 1) < 1e-9, (N, M, k)

    p = counts / counts.sum()

    # Check 2: expected count equals N x single-hand probability.
    single = sum(single_hand(M, v) for v in range(k, SUITS)) if at_least else single_hand(M, k)
    assert abs(sum(j * x for j, x in enumerate(p)) - N * single) < 1e-9, (N, M, k, at_least)
    return p


def main():
    configs = [(N, 52 // N) for N in (3, 4, 5, 6, 7)]
    results, out_rows = {}, []
    for N, max_m in configs:
        for M in range(1, max_m + 1):
            for mode in ("exactly", "at_least"):
                for k in range(SUITS):
                    p = table_distribution(N, M, k, at_least=(mode == "at_least"))
                    results[f"{N},{M},{mode},{k}"] = p.tolist()
                    out_rows.append([N, M, mode, k] + [f"{x:.6f}" for x in p])
            # Check 3
            assert abs(results[f"{N},{M},at_least,1"][0] - results[f"{N},{M},exactly,0"][N]) < 1e-12

    with open("void_odds.json", "w") as f:
        json.dump(results, f, separators=(",", ":"))
    with open("void_odds.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["players", "cards", "mode", "voids"] + [f"p_{j}_players" for j in range(7)])
        w.writerows(out_rows)

    print("P(at least one player at the table holds a void)")
    print("cards  " + "  ".join(f"N={N:<5}" for N, _ in configs))
    for M in range(1, 18):
        cells = []
        for N, max_m in configs:
            cells.append(f"{100 * (1 - results[f'{N},{M},at_least,1'][0]):6.1f}%" if M <= max_m else "     - ")
        print(f"{M:>5}  " + "  ".join(cells))
    print(f"\nWrote {len(out_rows)} distributions to void_odds.json and void_odds.csv; all checks passed.")


if __name__ == "__main__":
    main()
