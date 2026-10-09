---
'plot': patch
---

`plot-reap.sh` is a launcher over `board/plot-reap.mjs`, fixing the npm-layout failure where its four `node --input-type=module` heredocs resolved rule imports from a `packages/` checkout path that does not exist in a published install. Desk removal is now a `trees` port write (`removeOnly`), forcing through uncommitted content exactly as the shell's own `git worktree remove --force` did.

<!--
plan: docs/plans/2026-10-09-the-shell-sheds-its-decisions.md
-->
