---
'plot': patch
---

`issue-list --fix-version` now runs its Jira version-existence check once per project per read instead of once per page, matching the call count `versionRead` already reports; a malformed version-list response exits as a failed question (3) rather than `version-not-found` (4); `--limit` values too large for a bash integer comparison are refused (2) instead of reaching Jira unbounded; and a `--fix-version` combined with `--state` in either argument order is refused (2) instead of one silently overwriting the other.

<!--
plan: docs/plans/2026-10-24-tracker-arms-in-plot-host-sh.md
bumps:
  skills:
    plot: patch
-->
