---
'@plot-pm/board': patch
---

The board asks the git host for its whole PR history once a day and asks only for changed PRs between those reads. It made the whole read on every second refresh before: a delta's answer marked the PR index as not whole, and the next refresh then refused to narrow. Measured 2026-10-01 on this repository, the whole read took 43.0 s for 1000 rows against 0.8 s for the delta. A whole read that fails no longer repeats every minute — the board asks for changed PRs and retries the whole read an hour later. A PR index written by an older Plot is read once in full, as an unrecognised version has always been.

<!--
plan: docs/plans/2026-10-01-a-pr-refresh-reads-the-history-once-a-day.md
-->
