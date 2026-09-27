---
'plot': patch
---

`branch-state.corpus.test.ts` says which half of its comparison is independent. The readings are verified: they are gathered here from the sources the scan reads, so a wrong ref, a missed merge subject or an unjoined `pr-list` row still disagrees. The decision is not: the scan's only branch-state answer comes from `board/plot-branch-state.mjs`, a bundle of the same `branchState` the test calls, and a mutant on the arm 20 of 26 branches reach fails with a stale bundle and passes with a rebuilt one. The docstring records the CI asymmetry that follows — the `corpus` job does not rebuild the board, so it catches a contributor who edits the rule and forgets to rebuild, while one who rebuilds per the Definition of Done goes green. The mutation report gains the 2026-09-26 arm coverage and names which 2026-09-06 claim it supersedes: four branches now reach the no-ref merge-subject lookup that the older table records as never reached, and nothing reaches `branch-state.ts:264`.

<!--
plan: docs/plans/2026-09-26-a-corpus-test-says-what-it-verifies.md
-->
