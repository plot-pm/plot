## Implementation brief — the-pulse-s-tracer-flag-means

- **Plan (canonical):** docs/plans/2026-11-04-the-pulse-s-tracer-flag-means.md on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3115 merged
- **Branch:** `feature/the-pulse-s-tracer-flag-means` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** `Review: pr` — the plan-review App reviews the PR; no hand merge

This slice waits on `bug/the-queue-hands-out-an-approved-spike` (PR #3105, open when this brief was written). That PR rewrites `plan-walk-assembly.ts` around `sliceReadingsOf` and keeps one `planSpikes` sum only for `tracer`. Start after #3105 merges, rebase onto `main`, and cite the walk by symbol name, not by line.

### What to build

The pulse's `tracer` flag has two meanings. `assemblePlanWalk` sets `tracer: planSpikes > 0` (any `<!-- spike -->` branch marker), while `FleetReadingSchema` (`packages/domain/src/entities/fleet.ts:713-720`), `plot-plan-meta.sh`, the board card and `auto-verify.ts` all read the plan's `Tracer: yes` line. Result today: a plan with a spike marker and no `Tracer:` line is held at auto-delivery and its fleet rows sit in Design, while its card sits in its state's phase. A `Tracer: yes` plan with no marker does the reverse. The slice makes the walk read the line, and nothing else changes meaning.

1. `PlanRecord` (`packages/domain/src/ports/plan-store.ts`) gains optional `tracer?: boolean` — "`true` when the plan's `## Status` says `Tracer: yes`; absent otherwise".
2. `RawPlan` in `adapters/plan-store/plan-store-shell.ts` gains `tracer?: boolean`; `planOf` maps `...(raw.tracer === true ? { tracer: true } : {})`, the shape of the branch `spike` mapping at `:95`.
3. `planWalkAssembler` sets `tracer: record.tracer === true`, deletes the `planSpikes` sum (its only reader), and `AssembledPlan.tracer`'s doc changes to "the plan's `## Status` says `Tracer: yes`". `spikeApproved` and the spike slice keep their own source.
4. In `packages/domain/corpus/plan-store.corpus.test.ts`, move `tracer` (and its comment) out of `KNOWN_UNCARRIED` into `FIELDS` as `['tracer', 'tracer']`.
5. Changeset `.changeset/the-pulse-s-tracer-flag-means.md` — the plan holds the exact text; description first, `plan:` and `bumps:` last, package `plot`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **The flag means `Tracer: yes`, not the marker (jwloka, 2026-11-04).** `2026-10-12-design-work-proves-the-path` (D15) keeps them apart on purpose: the marker lets one slice run before approval; the line says the plan waits for a dependent. Four readers already use the line; the walk is the only producer with the spike meaning. Do not "fix" the other readers to match the walk.
- **`planStoreRef` needs no change.** It builds records through the same `planOf` (`plan-store-ref.ts:158`). `planRecord` in `plan-store-fixture.ts` and `mockPlans` in `mock-fleet.ts` leave `tracer` absent, which reads as not a tracer plan.
- **Accepted consequence.** A spike-marker plan with no `Tracer:` line stops being held at auto-delivery and its fleet rows leave Design. Measured on `origin/main` at `e54e53815` over 647 plans: zero say `Tracer: yes`; four have a marker and all four are Released; `2026-11-03-registry-never-hands-out-an-approved` names the marker in prose only. So no live plan changes behaviour.
- **The test inversion is intended.** The test at `plan-walk-assembly.test.ts:215-230` ("…and marks a spike plan a tracer") now expects `tracer === false`. Do not read its old assertion failing as a regression and restore the marker rule.
- **No test sets the pulse `tracer` by hand.** Every test starts from a plan file or a `PlanRecord`, so a missing mapping fails and does not default silently to `false`.
- **Carried invariants:** absent is not false (`tracer` is omitted, never `false`, on a non-tracer plan); read the exit code, not the emptiness.

### Done when

The plan's `## Done when` and `### Tests` sections are the specification. Assertions that exist because a naive implementation passes without them:

- Adapter test (`packages/domain/test/plan-store-shell.test.ts`): two temp plan files read through `planStoreShell` — `Tracer: yes` without marker gives `tracer === true`; marker without line gives `undefined`. Catches a mapping that is missing or keyed on the marker.
- Walk test (`plan-walk-assembly.test.ts`): plan M (spike branch, no `tracer`) reads `false`, plan T (`tracer: true`, no spike) reads `true`. Both fail on `main`.
- Auto-deliver test (`auto-deliver.test.ts`): build the pulse through `assemblePlanWalk` → `planRow` → `FleetReadingSchema.parse` → `planAutoDeliver`, not through `world()`, which sets `tracer` by hand. Result names M, not T. Catches a fixture that hard-codes the answer.
- Fleet-row test (`packages/board/test/unit/fleet.test.ts`): same two-plan pulse through `rowsFromPulse`; with `DEFAULT_PHASE_MAP`, M's rows read `Development`, T's rows read `Design`, and each equals `phaseOfPlan(phaseMap, { state: 'approved', tracer })` — the card's phase. Fails on `main` for both plans.
- Corpus change passes on `main` and after; the adapter test holds the `true` mapping.

Plus the gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints (domain `vitest related` and `tsc --noEmit -p .`, board `vitest related --run --project parallel` and `pnpm run typecheck`, the gate tests, the `scripts/check-*.sh` list). The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. No shell file changes, so `scripts/check-shell-lines.sh` is unaffected; if you touch a `.sh` file, pay for the growth in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves) — never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Do not edit `Started:` or `State:` by hand.

### Scope guard

This branch owns: `packages/domain/src/ports/plan-store.ts`, `packages/domain/src/adapters/plan-store/plan-store-shell.ts`, `packages/domain/src/workflows/plan-walk-assembly.ts`, `packages/domain/corpus/plan-store.corpus.test.ts`, the four test files above, and the changeset.

In flight: `bug/the-queue-hands-out-an-approved-spike` (#3105) holds `plan-walk-assembly.ts:317-340` (`spikeCounts`/`spikeSliceOf` → `sliceReadingsOf`) — the collision is known, hence the wait. Out of scope: #3121 (corpus field lists accept a key on both `FIELDS` and `KNOWN_UNCARRIED`) and `packages/fleet/src/shared/auto-verify.ts:231`, which already has the `Tracer: yes` meaning.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
