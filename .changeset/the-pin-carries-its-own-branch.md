---
'@plot-pm/board': patch
---

`pinClone` now adds `infra/plot-corpus-fixture`, one commit on top of the pin that names itself in a fixture plan's Slices section, so the refs corpus guard at `refs.corpus.test.ts` always has a branch with a known `changed_paths` to assert on by name. The guard no longer depends on an open slice branch carrying unmerged remote changes, the condition #1391 removed from the real estate and the reason the `corpus` CI job failed on every PR since (#1403).

<!--
plan: docs/plans/2026-10-09-the-refs-corpus-test-fails-when.md
-->
