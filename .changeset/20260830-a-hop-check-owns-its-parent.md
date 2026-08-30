---
'plot': patch
---

The worker-loop hop check counts only worktrees it created.

`test/reconcile/workerloop.test.mjs` proves a timed-out worker does not hop to a
next wave by counting `plot-wt-*` directories beside its fixture. The fixture was
created directly in `os.tmpdir()`, so *beside* meant the machine's shared tmp
root — and **any** `plot-wt-*` there counted as a hop this loop had made.

**Measured 2026-08-30 on a clean `main`:** one empty leftover directory,
`plot-wt-dead-bbvqDu`, failed `a timed-out worker exits without hopping` with
`1 !== 0`. It was left by an aborted run of `packages/board/test/agent-panel.test.mjs`,
which names its own fixture `plot-wt-dead-`. Two suites, one namespace.

The failure is worse than a flake because of **where** it points. It fails in
1.9s rather than the fixture's 48s, on a file the branch under test never
touched, and it survives a re-run — so it reads as a real regression in the
branch. It cannot reproduce in CI, where each job gets a fresh tmp, so it only
appears on a developer machine that has run both suites.

Each fixture now gets its own parent directory and the worktree sits inside it,
so *beside the fixture* means only what this test created. A `discard()` helper
removes the parent at all 17 teardown sites, so the parent cannot outlive its
worktree.

Verified by planting a foreign `plot-wt-*` in the shared tmp root: 17/18 before,
18/18 after.

<!--
bumps:
  skills:
    plot: patch
-->
