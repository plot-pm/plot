---
'plot': patch
---

`plot-host.sh` on Bitbucket ends the fetch bound's watcher `sleep` together with the watcher, so a `pr-state` or `pr-list --rich` read ends when its base fetch ends instead of holding its caller's stdout open for the full 10 s bound. The board census's no-client rows (S1, S2) open their window only after the board has had no child process for 3 s.

<!--
plan: docs/plans/2026-11-08-no-tab-no-pulse.md
-->
