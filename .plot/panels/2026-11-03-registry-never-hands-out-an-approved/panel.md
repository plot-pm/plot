# Panel — registry never hands out an approved spike

Subject: `docs/plans/2026-11-03-registry-never-hands-out-an-approved.md` (plan PR #3095, issue #3092)
Convened: 2026-11-03, round 1, jurors against `origin/main` at `791be809d`; the moderator verified against `1fa36d2aa`, where every cited line still matched.
Lenses: layering, safety, testability, seams — four jurors, one rubric, persona varied only.

## Outcome: UNANIMOUS — 4 amend

| Lens | Position | Evidence |
|---|---|---|
| layering | **amend** | read only |
| safety | **amend** | read only |
| testability | **amend** | read only |
| seams | **amend** | read only |

All four gated with a committed position. Reconcile: `unanimous amend layering,safety,testability,seams`.

## Agreement across all four

1. **`blockingBranches` has the same gap and belongs with the queue fix.** `known-pr.ts:200` calls `sliceVerdicts` with `outstanding`, `phase` and `branches` only. Its one caller is the queue's landing walk (`queue-reading.ts:622`), not restart. The draft put it in the restart slice. Safety rated it conservative (it withholds a lookup and releases nothing); the other three rated it the same divergence.
2. **The parity test needs a fixture constraint.** `planQueue` counts `outstanding` from `settled` (`queue.ts:930`); the walk counts it from `branchState` with a `--loose` readiness arm (`plan-walk-assembly.ts:321-329`). A fixture with `wip` or claimed branches compares the two `outstanding` rules, which differ on purpose. Fixtures hold all-open or all-merged branches, and the test compares claimability, because `planQueue` returns no verdict. It is a unit test in `packages/domain/test/`, not a corpus test.
3. **Restart cannot help the issue's case.** The pulse carries Design plans (`plan-walk-assembly.ts:19`, `:302-303`) and `branchFromPulse` has no phase filter. A never-started spike has no worktree, so a fixed lookup answers `no-worktree` (`restart-command.ts:120-122`). The `unknown-branch` refusal comes from a `null` bridged pulse (missing, older than 15 min, foreign version, or failing its schema).
4. **This plan's own `<!-- spike -->` marker is wrong.** The slice is the whole fix, not a tracer. In Approved it is inert for verdicts, but it sets `tracer: true` on the pulse (`plan-walk-assembly.ts:391`), and `planAutoDeliver` then leaves delivery to a person (`auto-deliver.ts:281`, `:293-294`). In Design it would hold the plan behind the very defect it fixes.

## Findings from some jurors only

- **`Spike approved:` names no branch (safety only).** `approveSpike` decides with a `branch` but writes `${on}, ${who}, ${channel}` (`transitions/plan.ts:600`). A marker moved after approval moves the approval. Today that reaches only the scan's word; after this fix fleetd starts an agent on it. Verified. Already raised as M2 in #1637, closed and folded into #1836. Filed again with the new consequence as #3101.
- **Optional fields let callers omit them (layering only).** `SliceReadings.spike` and `spikeApproved` are optional (`eligible.ts:41`, `:48`), which is why two callers compiled without them. Required keys typed `boolean | undefined` make `tsc` the gate. The moderator found that this also touches `verdicts.ts:112-113` (spreads `{}`) and the inline literals in three domain test files, which `tsc` checks because the domain `tsconfig.json` includes `test`.
- **The builder's inputs (layering, testability).** Name the signature, compute `spike` from the whole plan rather than take `spikeSliceOf` as a parameter, and own one `spikeApproved` predicate. Safety stated the same requirement from the admission side: a per-slice `spike` would admit two marked slices.
- **The builder needs its own unit test (testability only).** The domain holds 100 % on `src/!(adapters)/**` (`vitest.config.ts:71`).
- **The negative queue cases (safety only).** Two markers, no record, a Draft plan with a record, a spike slice with a second or deferred branch, slice 2 after the spike merged.
- **A changeset (seams only).** The fix reaches the reporter's marketplace checkout only through a release.
- **The `tracer` flag means two things (safety only, side note).** `entities/fleet.ts:714` says `Tracer: yes`; the walk computes it from spike markers. Verified, and the parser's `tracer` key never reaches `PlanRecord`. Filed as #3102.

## Rejected after checking the source

- **`.trim() !== ''` as the `spikeApproved` predicate (layering).** The parser already trims (`plot-plan-meta.sh:460-464`), and eleven test fixtures in five files cast to `PlanRecord` without `spikeApprovedRaw`, so `.trim()` would throw in each one that reaches a caller. The plan keeps the walk's `!== undefined && !== ''`, which leaves the scan's answers unchanged.
- **A restart slice that refuses `unapproved` (safety amendment 4).** Restart leaves the plan, so the amendment has no subject here. The bypass safety describes needs a widened pulse, and this plan widens nothing.

## Shared blind spots

- **No juror ran anything.** Every fail-before claim comes from reading `eligible.ts` and the callers. No test, typecheck or bundle ran.
- **Nobody reproduced the live queue.** No juror ran a fleetd tick or the queue against a Design plan with an approved spike, and none reproduced the `unknown-branch` refusal. The restart cause is inferred from code paths.
- **No juror counted what required keys break.** Only the moderator checked which test literals and which board file stop compiling.

## Operator decisions

1. Remove `<!-- spike -->` from the plan's own slice line. The plan is not a spike.
2. Drop the restart slice. File the misleading `unknown-branch` refusal on a missing, stale or foreign-version pulse as its own issue: #3100.
3. One shared, pure builder in `packages/domain/src/rules/` computes `spike` from `spikeOf` over the whole plan and reads `spikeApproved` with one stated predicate. `planQueue`, `assemblePlanWalk` and `blockingBranches` call it; each keeps its own `outstanding` rule. `SliceReadings.spike` and `spikeApproved` become required keys typed `boolean | undefined`.
4. The queue keeps the hold word `not-claimable`; no `unapproved` word.
5. Tests in `packages/domain/test/`: the positive spike case, the negative cases, a `blockingBranches` case, a builder unit test, and an agreement test over all-open or all-merged fixtures across `draft`, `design`, `approved` and `delivered`, with and without a record.
6. Out of scope as Notes and filed issues: the record names no branch (#3101) and the `tracer` meaning (#3102).
7. One changeset: `'plot': patch`, description first, `plan:` line and a `plot: patch` skill bump.
8. One slice, one branch: `bug/the-queue-hands-out-an-approved-spike`.
