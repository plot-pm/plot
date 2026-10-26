---
'plot': patch
---

The tracker port's `VERSION_NOT_FOUND` constant now lives on `ports/tracker.ts` instead of the shell adapter, `issueListLabelled` is removed from the port and every adapter in favour of `issueListWithTitle`, the fixture's `versionRead` counts the version-existence check in its page total the way the Jira adapter does, and `plot-detect-repo.sh`'s `top_prefix` helper counts a ticket prefix once per line instead of once per occurrence, so a single branch or commit subject naming its ticket twice no longer inflates the count.

<!--
plan: docs/plans/2026-10-24-tracker-arms-in-plot-host-sh.md
bumps:
  skills:
    plot: patch
-->
