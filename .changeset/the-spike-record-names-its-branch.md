---
'plot': minor
---

The `Spike approved:` record names the branch it licenses as its fourth field, `<date>, <who>, <channel>, <branch>`, and one domain rule, `licensedSpike`, answers which branch a record licenses. A record with no branch, or one that names a branch the plan no longer marks, licenses nothing. `plot-approve.mjs --spike` replaces such a record in place through `replaceStatusRecord` and leaves one line, so a person re-approves. Records written before this change, such as `2026-11-03` or `2026-10-12, jwloka, in-session`, license nothing until re-approved.

<!--
plan: docs/plans/2026-11-04-record-names-no-branch-so-a.md
bumps:
  skills:
    plot-approve: minor
-->
