---
'plot': patch
'@plot-pm/board': patch
---

The queue reads a live manifest as an assignment, not only a claim ref. `readQueue` builds `assigned: branch → agent id` from every `running` or `waiting` manifest naming a branch, and `whyNotReady` holds that branch `assigned` — tested after the two landing holds and before `waits` — so a slice a dispatch just handed over cannot be matched to a second agent before its claim push lands. Fixes the 2026-10-01 defect where the supervisor handed agent `8111e3ec` a second slice while its manifest still named the first.

A dead agent's manifest is still not an assignment: only `running`/`waiting` count, so a crashed agent's unpushed branch returns to the queue as before (#1039's negative control).

The tick also reports orphaned claims. `packages/domain/src/rules/claim.ts` adds `claimTip` (one of `absent`/`claim-only`/`work`/`unknown`, from a branch's remote-tracking ref and its commits ahead of the default branch — `isEmptyClaim`/`realCommits` decide, never a second prefix comparison) and `orphanedClaims` (which claim-only, unassigned branches are older than one tick interval, 60 s). The refs port gains `commitSubjects(range)`, reading each commit's time, subject, tree and first parent's tree via `git log --boundary` in one call per branch — a git call, spending no host budget. For each plan-named, unmerged branch carrying a ref, the tick writes `orphaned-claims=N` and, per branch, `<branch>: claim with no agent — plot-dispatch.sh --release <branch>`. It reports and never releases; deleting a ref stays a person's command.

`scripts/check-claim-prefix-comparison.sh` gates the claim vocabulary to its one home, `rules/empty-claim.ts`, scoped to the domain and board's TypeScript — the shell's own, separately declared `plot: claim ` comparisons in `plot-reconcile-scan.sh` and `plot-fleet-scan.sh` are untouched.

<!--
plan: docs/plans/2026-10-01-an-assignment-is-read-where-it-is-recorded.md
bumps:
  skills:
    plot: patch
-->
