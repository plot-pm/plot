---
'plot': patch
---

`test/reconcile/main-checkout-writers.test.mjs` now proves what its assertions claim rather than what their comments claim: the `pr-create` check strips comment lines before matching so a comment-only mention no longer passes a deleted real call, the `doesNotMatch` guard catches `git -C <dir> commit` with a flag between `git` and `commit`, the header names exactly which tests run against a sandbox versus against source text alone, and the scratch-writer test walks nested scripts under `skills/plot/scripts/` and requires an `mv` to target the same scratch path rather than any `mv` in a trailing window. `docs/plans/2026-10-23-recording-a-slice-pr-number-writes.md` step 4 now names the dispatched agent's worktree session as the confirmed writer and drops the two already-ruled-out candidates.

<!--
plan: docs/plans/2026-10-24-the-main-checkout-write-gate-misses.md
bumps:
  skills:
    plot: patch
-->
