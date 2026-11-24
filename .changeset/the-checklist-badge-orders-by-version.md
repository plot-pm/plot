---
'@plot-pm/board': patch
---

The board's release-checklist badge counts `vnext-checklist.md` where it exists, and otherwise the `vN.N.N-checklist.md` file with the highest version, so `v2.19.0` now outranks `v2.9.0`. Only `vnext` and `vN.N.N` names count as checklists: a name such as `notes-checklist.md` or `v2.19.0-rc.1-checklist.md` no longer feeds the badge.

<!--
plan: docs/plans/2026-11-23-the-checklist-badge-reads-the-newest-release.md
-->
