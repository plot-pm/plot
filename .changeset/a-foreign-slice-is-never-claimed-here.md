---
'plot': patch
---

A slice line that places its branch in another repository — an `<owner>/<repo>:` prefix at the start of its description, or an arrow `→ owner/repo#N` — now reads `foreign` in the pulse. A foreign branch is never offered to auto-dispatch, `dispatch --branch` refuses it as `branch-foreign` and names the repository, and it settles its slice only where the host answers its PR in that repository merged. A waiter on a foreign branch with no arrow stays `waiting`, and the report names the repository.

<!--
plan: docs/plans/2026-11-27-a-foreign-slice-is-never-claimed-here.md
-->
