---
'@plot-pm/board': patch
---

The domain gains a reader that answers ref and worktree questions from the files under `.git` (loose refs, `packed-refs`, symbolic refs, `worktrees/*`), with a corpus test against git. It answers `unaskable` on a reftable repository and after two `packed-refs` changes in a row. No adapter calls it yet.

<!--
plan: docs/plans/2026-11-09-refs-from-files.md
-->
