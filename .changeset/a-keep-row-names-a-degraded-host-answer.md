---
'@plot-pm/board': patch
---

`plot-reap`'s branch sweep now carries the host's merge answer as `merged | not-merged | unknown` plus a refusal kind, instead of collapsing every non-merge case into one boolean. A branch the host answered `unknown`, or whose host call failed, now prints `keep — the host could not answer` (or `, rate-limited` for a throttled call) instead of the misleading `keep — unlanded work — no merged PR`, which is now reserved for a genuine not-merged answer.

<!--
plan: docs/plans/2026-10-28-plot-reap-yes-deletes-a-different.md
bumps:
-->
