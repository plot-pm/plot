---
"@plot-pm/fleet": patch
"@plot-pm/domain": patch
---

`startImplement` captures the main checkout's branch before running `/plot-implement` and restores it once the run ends — on success, on a failed run, and on the `IMPLEMENT_TIMEOUT_MS` bound kill alike. A checkout left on a slice branch by a prior `/api/implement` run, as happened on 2026-10-20, previously stayed there until a person intervened; a second run could then commit its own brief onto that stranded branch. The restore reads and checks out the branch through two new `Trees` port methods, `currentBranchSync` and `checkoutSync`, rather than calling `git` directly from `packages/fleet/src/shared/implement-run.ts` — the direct calls tripped CI's "One place reaches a process" ratchet, which only adapter code may cross.

<!--
plan: docs/plans/2026-10-24-implement-leaves-the-main-checkout-on.md
bumps:
  skills:
    plot: patch
    plot-implement: patch
-->
