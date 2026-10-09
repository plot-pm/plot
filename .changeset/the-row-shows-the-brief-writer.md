---
'@plot-pm/board': minor
---

A NOT STARTED row whose brief writer is running now shows a working indicator, reusing the board's existing pulse-dot animation — replacing the age-only `briefAskedAt` reading, which could never say when the work was done. `fleet.ts` reads a new domain rule, `briefWriterState` in `@plot-pm/domain`, from `brief-ask-log.ts`'s per-branch writer reading; a run given no branch still marks every brief-less sibling as `asked`, never `writing`.

<!--
plan: docs/plans/2026-10-09-a-slice-whose-brief-is-being.md
-->
