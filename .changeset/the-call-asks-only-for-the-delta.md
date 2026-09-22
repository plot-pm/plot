---
'@plot-pm/board': patch
'plot': patch
---

The board asks its git host only about pull requests that changed since it last looked. `plot-host.sh pr-list` gains `--since <iso>`, which GitHub takes as `--search "updated:>…"` and the Bitbucket sweep composes into the one `q=` it already builds; `refreshPrs` sends the store's watermark unmodified and merges the answer into what it held. Measured on this repository: one `gh pr list --state all` over 933 pull requests takes 29 811 ms with the fields the board needs, and the same call over one day takes 943 ms for 3 rows — factor 32, with every expensive field still included, so the call itself gets cheap rather than being cached. A delta is never recorded as complete, because only a whole answer may drop a row the host no longer lists, and a periodic full read stays for exactly that reason: a delta cannot see a deletion. The served maps are derived from the merged store rather than from the window's own rows, so a window returning 3 rows still serves 933. A cold store, a store carrying no watermark, a store nobody proved whole and a store due its full read each issue the unchanged full call, so the store remains an optimisation whose absence costs time and nothing else.

<!--
plan: docs/plans/2026-09-21-the-board-asks-only-what-changed.md
bumps:
  skills:
    plot: patch
-->
