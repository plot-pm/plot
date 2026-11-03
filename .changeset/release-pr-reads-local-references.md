---
'plot': patch
---

`releasePr` now reads repository-qualified, deferral-aware PR references, so a plan's local `→ #N` wins the version lookup over a higher-numbered foreign `→ owner/repo#N`; a plan whose every non-deferred PR is foreign books `Released` with reason `all-prs-foreign`, asking the host nothing.

<!--
plan: docs/plans/2026-11-03-release-resolution-reads-a-cross-repo.md
bumps:
  skills:
    plot-deliver: patch
-->
