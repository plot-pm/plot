## Implementation brief — the-queue-reads-the-order-the-scan-reads (slice 1: The queue reads the scan's order)

- **Plan (canonical):** `docs/plans/2026-10-01-the-queue-reads-the-order-the-scan-reads.md` on `main`
- **Issues:** #1100, #1149 (this slice answers #1100)
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-queue-reads-the-scans-order` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

**This slice is wave 1 and three slices wait on it:** `bug/a-hand-over-is-checked-before-it-is-made` (same plan), `bug/the-queue-reads-the-assignment`, and `bug/every-wait-reaches-the-verdict`. The last two change `planQueue`, `QueueHold` and `HOLD_SCOPE` after you, and `PlanRecordBranch.waitsOn` is changed to a list by a later plan, so keep `waitsOn: string` exactly as the plan names it.

### What to build

The supervisor hands out a slice that the scan reports `blocked`. `queueOfPlan` (`packages/board/src/server/queue-reading.ts:144-145`) settles a branch on `claimed.has(branch) || merged.has(branch)`, so a claimed first slice makes the second slice `eligible` for the queue. The scan counts only a merged branch as settled (`plot-fleet-scan.sh:233-236`, `:3887-3900`). On 2026-10-01 three plans held an empty claim ref on their first slice, and the supervisor handed all three second slices to agents. Each agent wrote `PLOT-BLOCKED`. Separately, `plot-plan-meta.sh` reports `waits_on` and nothing on the queue's path reads it: `plot-fleetctl.sh --once` decided `hand over to ac80eeac-…` for a slice the scan read `blocked`.

Build, in this order:

1. **Move the fold into the domain.** `planQueue(plan, claimed, merged, listingWhole)` in `packages/domain/src/rules/queue.ts`, a pure function over a `PlanRecord`, the claimed set, the merged set and whether the merged listing answered whole. `queueOfPlan` keeps only the reads and calls it. After the move, `queue-reading.ts` contains no `claimed.has(` join.
2. **One `settled(branch, merged)` predicate**, exported from `rules/queue.ts`, true only where the merged set names the branch. The fold passes it to `sliceVerdicts` as `outstanding`, and `landedWithoutListing` passes it to `blockingBranches` (`queue-reading.ts:307`). A separate reading, *taken* (`claimed || merged`), still keeps a branch out of the queue, so a claimed branch is not offered again.
3. **`PlanRecordBranch.waitsOn: string`** (`''` where none) in `packages/domain/src/ports/plan-store.ts:67-76`, mapped from `raw.waits_on` in `branchOf` (`plan-store-shell.ts:46-51`).
4. **The `waits` hold.** `QueueHold` gains `'waits'`, `QueuedSlice` gains `waitsOn`, `whyNotReady` (`queue.ts:205-210`) answers `'waits'` after the two landing holds and before `no-brief`, `QUEUE_HOLDS` and `HOLD_SCOPE` (`registryd-main.ts:1203-1209`, scope `queue`) gain the key, and the held list (`registryd-main.ts:1293-1305`) prints `    <branch> — waits on <prerequisite> (<unmerged|unreachable>)` under `held on waits (N):`. Keep that exact form; it is grepped.
5. **The queue joins the corpus.** `packages/domain/corpus/eligible.corpus.test.ts` gains the queue as a third surface beside the board's verdict and `--list-eligible`.

### Decisions the plan settles — do not re-derive them

**The queue does not read the scan's output.** It applies the scan's rule to the same plan records, and the corpus test pins the two to agree. Calling the scan costs 18.3 s per question, and the supervisor ticks every 60 s.

**`settled` stays a merged-only rule, and `sliceVerdicts` and `isClaimable` do not change.** The 2026-09-06 case in the comment at `queue-reading.ts:131-143` stays answered, because a merged branch with no ref still settles. Do not widen `settled` to include `claimed` to keep a test green: that is the defect.

**The answer to `waitVerdict` is read in this order, and the queue never answers `none`.**

| Reading | Answer |
|---|---|
| the merged set, after the `landedWithoutListing` fallback, names the prerequisite | `merged` |
| otherwise the listing did not answer whole (`MergedListing.whole === false`, `queue-reading.ts:85-90`) | `unreachable` |
| otherwise | `unmerged` |

`waitVerdict` (`eligible.ts:213-220`) answers `waiting` for `unreachable` and `unmerged` alike, so a partial listing holds the slice and never offers it. The merged listing cannot tell *never had a PR* from *has an open PR*, so `blocked` stays the scan's word. Absent is not false: do not turn a missing row into `none`.

**The rule takes readings as values and fetches nothing.** No new script, no change to the scan, no spawn in the domain.

### Done when

The plan's `## Done when` list is the specification, slice 1 lines. The assertions that exist because a naive implementation would pass without them:

- **The two-slice case with a claimed, unmerged first branch** asserts the second slice is not `claimable`, and the same case with the first branch merged asserts it is. A naive fix that drops `claimed` from the fold's `taken` reading passes the first half and re-offers claimed branches.
- **The partial-listing row** (a listing with rows, `whole: false`, not naming the prerequisite) holds the slice as `waits` with `unreachable`. A naive implementation reads rows as an answer and says `unmerged`, which is the same hold for the wrong reason, so assert the word in the held line.
- **The corpus surface** names both answers and the slice on a disagreement. Run it over the real `docs/plans/`; on a disagreement the branch stops, and adjusting either side to make the comparison pass is the one move forbidden (`docs/shell-and-domain.md`).
- **The `registryd-main` held-list test** asserts the full line, `<branch> — waits on <prerequisite> (unmerged)`, under `held on waits (1):`. The existing test at `registryd-main.test.ts:538` iterates `QUEUE_HOLDS` and will pick up the new key.
- **`plan-store-shell` maps `waits_on`**, with a case for a branch line that declares none.

Plus: `nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck` and the domain coverage gate at 100% branches. Do not run `pnpm run test:e2e`; CI owns it. A changeset for `@plot-pm/board` if the artifact changes (package frontmatter, description first), plus the `plot` package changeset with a `bumps:` block last if a skill changes. `pnpm build:board` rebuilds the artifact; commit it.

### Rules that bite this slice

- New functions are arrow functions; TSDoc says what a function returns and how it fails, and the reasoning goes in the commit message.
- The domain imports `zod` and nothing else outside `adapters/`. `planQueue` reads nothing.
- A new `QueueHold` key fails the build in `HOLD_SCOPE` until it is added there; that is intended.
- Use `trash`, never `rm`. Never `git stash` in a shared worktree.

### Rollout note

The supervisor loads `plot-registryd.mjs` once. This fix takes effect after the artifact is rebuilt and the supervisor restarts. Do not restart it yourself; the master agent does, after #1144's second slice has merged.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's heading line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/queue.ts`, `packages/domain/src/ports/plan-store.ts`, `packages/domain/src/adapters/plan-store/plan-store-shell.ts`, `packages/board/src/server/queue-reading.ts`, the `HOLD_SCOPE` and held-list code in `packages/board/src/server/entry/registryd-main.ts`, `packages/domain/corpus/eligible.corpus.test.ts`, their tests, and the rebuilt board artifact.

In flight, verified 2026-10-02 against `git branch -r` and `git worktree list`:

- `bug/the-queue-reads-the-merge-subject` (worktree `.worktrees/free-d1de2863`, remote ref present) changes `landedWithoutListing` and `queueOfPlan` in `queue-reading.ts` to take `merged ∪ proven(plan)` per plan. **Expect a textual conflict in `queue-reading.ts`.** If it merged first, rebase onto `main` and carry its per-plan union into the call you move into `planQueue`; if yours merges first, it rebases onto your version. Do not drop its `proven` argument.
- `bug/the-row-reads-the-hand-over` and `bug/the-loop-waits-out-a-usage-limit` do not name these files in their plans' slices; confirm with `git diff origin/main...origin/<branch> --stat` before assuming a collision.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
