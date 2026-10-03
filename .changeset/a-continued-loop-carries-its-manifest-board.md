---
'@plot-pm/board': patch
---

`manifestForWorktree` is now built on a new `deskManifestFor`, which answers the full `DeskManifest` — `named`, `unnamed` or `several` — rather than collapsing the last two to `''`. `/api/continue` uses it to refuse a continuation 409 when no manifest names the worktree or when more than one does, naming every path in the refusal, before it writes the prompt file or touches the previous run's records. A successful continuation now passes `PLOT_MANIFEST_FILE` to the spawned worker's environment and removes any stale `.plot-worker.wrapper.pid` left by a previous dispatch.

<!--
plan: docs/plans/2026-10-01-a-desk-and-its-manifest-name-each-other.md
-->
