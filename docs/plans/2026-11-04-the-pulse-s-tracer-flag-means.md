# The pulse's tracer flag means one thing

> The pulse's `tracer` flag is computed from `<!-- spike -->` markers while its schema documents `Tracer: yes`; the walk now reads `Tracer: yes`, so the walk, the schema, the parser and the board agree.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3102
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3115 merged
- **Started:** 2026-11-04, Jan Wloka, `feature/the-pulse-s-tracer-flag-means`
- **Delivered:** 2026-11-06
- **Released:** 2026-11-07, v2.31.0

## Changelog

- The pulse's `tracer` flag reads the plan's `Tracer: yes` line, as its schema says, so the fleet view, the board card and auto-delivery treat the same plans as tracer plans.

<!-- Board impact: the plan format is unchanged. The fleet view's branch rows change column: `rowsFromPulse` (`packages/board/src/server/fleet.ts:6616`) passes the pulse's `tracer` to `phaseOfPlan`, so today a plan with a `<!-- spike -->` branch and no `Tracer:` line puts its rows in the Design phase while its board card sits in its state's phase. After this plan both read `Tracer: yes`. -->

## Motivation

The `tracer` flag on a pulse plan row has two meanings, and each reader sees one of them. Measured on `origin/main` at `e54e53815`.

The pulse meaning (any spike marker), and its readers:

- `assemblePlanWalk` sets `tracer: planSpikes > 0` (`packages/domain/src/workflows/plan-walk-assembly.ts:391`), where `planSpikes` sums the `spike` flags of the plan's branch lines (`:337-338`). `planRow` writes the value to the pulse row (`:552`). `AssembledPlan.tracer` documents it as "it names a spike" (`:111`). Commit `45ae8a839` introduced this.
- `planAutoDeliver` skips a pulse tracer plan until a dependent plan delivers (`packages/domain/src/rules/auto-deliver.ts:293-294`), and leaves a tracer plan with no dependent to a person (`:281`).
- `rowsFromPulse` passes the pulse `tracer` to `phaseOfPlan` for each branch row (`packages/board/src/server/fleet.ts:6616`). `phaseOfPlan` puts a tracer plan in the phase holding `plan:design` in every state but `released` (`packages/domain/src/rules/workflow-phases.ts:149`).

The `Tracer: yes` meaning, and its readers:

- `FleetReadingSchema` documents the pulse field as "Whether the plan's `## Status` says `Tracer: yes`" (`packages/domain/src/entities/fleet.ts:713-720`).
- `plot-plan-meta.sh` emits `"tracer":true` only for a `Tracer: yes` (or `true`) line (`skills/plot/scripts/plot-plan-meta.sh:806`, read at `:1284`). `PlanRecord` (`packages/domain/src/ports/plan-store.ts`) has no tracer field, so the walk never reads that key.
- The board reads the parser key into `PlanMeta.tracer` (`packages/board/src/contract/schema.ts:167-168`) and passes it to `decidePlanStatus` (`packages/board/src/server/board.ts:1457`; `planStatus` returns `proven` for a merged tracer plan, `packages/domain/src/rules/phase.ts:80`), to `phaseOfPlan` for the card (`board.ts:2637`, `:2673`), and to the delivered-plan reading (`board.ts:2731`).
- `packages/fleet/src/shared/auto-verify.ts:231` reads the parser key directly and feeds `verifyStart` (`:441`), which refuses `tracer` (`packages/domain/src/rules/auto-verify.ts:165`). `verificationOf` reads a tracer plan as `unverified` (`packages/domain/src/rules/verification-record.ts:129`).

The walk is the only producer with the spike meaning. Its effect today:

- A plan with a `<!-- spike -->` branch and no `Tracer:` line reads as a tracer plan in the pulse. Auto-delivery holds it for a person, and the fleet view puts its rows in the Design phase while its board card reads `deliverable` in its state's phase.
- A plan with `Tracer: yes` and no marker does not read as a tracer plan in the pulse. Auto-delivery delivers it, and the fleet view puts its rows in its state's phase while its board card reads `proven` in Design.

The estate on `origin/main` at `e54e53815`, read with `plot-plan-meta.sh` over all 647 plan files:

- Zero plans carry `Tracer: yes`.
- Four plans carry a branch line with a `<!-- spike -->` marker, and all four are Released: `2026-10-12-design-work-proves-the-path`, `2026-10-12-the-fleet-verifies-what-it-delivered`, `2026-10-12-tickets-and-stories-have-lanes`, `2026-10-15-a-desk-started-by-plot-dispatch`.
- `2026-11-03-registry-never-hands-out-an-approved` (Approved) names the marker in prose only. The parser reads no spike branch in it, so the pulse does not read it as a tracer plan today.

The safety juror of the panel on plan PR #3095 found the split (`.plot/panels/2026-11-03-registry-never-hands-out-an-approved/safety.md`).

## Design

### Approach

**Decision (jwloka, 2026-11-04): the pulse's `tracer` flag means `Tracer: yes`.** The plan `2026-10-12-design-work-proves-the-path` defines a tracer plan by that line (D15) and keeps it apart from the spike marker on purpose: the marker lets one slice run before approval, and the line says the plan waits for a dependent. Every reader except the walk already uses that meaning, so the slice changes the walk and leaves the other readers as they are.

- `PlanRecord` (`packages/domain/src/ports/plan-store.ts`) gains `tracer?: boolean`, documented as "`true` when the plan's `## Status` says `Tracer: yes`; absent otherwise". The field is optional, the way `PlanRecordBranch.spike` is, because the parser emits the key only for a tracer plan.
- `RawPlan` in `packages/domain/src/adapters/plan-store/plan-store-shell.ts` gains `tracer?: boolean`, and `planOf` maps it as `...(raw.tracer === true ? { tracer: true } : {})`, the same shape as the branch `spike` mapping (`plan-store-shell.ts:95`). `planStoreRef` (`plan-store-ref.ts:158`) builds its records through the same `planOf`, so it needs no separate change. `planRecord` in `plan-store-fixture.ts` and `mockPlans` in `packages/board/src/server/mock-fleet.ts` leave the field absent, which reads as not a tracer plan.
- `planWalkAssembler` in `plan-walk-assembly.ts` sets `tracer: record.tracer === true`. The spike readings (`spikeApproved`, the spike slice) keep their own source.
- The `planSpikes` sum then has no reader, and the slice removes it. After #3105 merges, `planSpikes` is the only remaining spike sum in `planWalkAssembler` and feeds only `tracer` (`docs/plans/2026-11-03-registry-never-hands-out-an-approved.md:63`).
- `AssembledPlan.tracer`'s doc comment changes from "it names a spike" to "the plan's `## Status` says `Tracer: yes`".
- The schema doc in `fleet.ts:713-720`, the parser, and the board readers stay as written.
- `tracer` moves out of `KNOWN_UNCARRIED` in `packages/domain/corpus/plan-store.corpus.test.ts:77` (with its comment at `:76`) and into `FIELDS` as `['tracer', 'tracer']`, so the corpus compares the parser key to `PlanRecord.tracer` on every plan.

**Accepted consequence (jwloka, 2026-11-04).** A plan with a `<!-- spike -->` branch and no `Tracer:` line stops being held for a person at auto-delivery, and its fleet rows leave the Design phase. This includes `2026-11-03-registry-never-hands-out-an-approved` if a marker ever reaches one of its branch lines; on `origin/main` its marker is prose only, so its delivery does not change. No plan on `main` says `Tracer: yes`, so after this change the auto-deliver tracer hold (`auto-deliver.ts:294`) holds no current plan until a plan opts in with that line.

The decision passes the MANIFESTO 9-question checklist: it adds no configuration and no project-specific name, and it removes a meaning rather than adding one.

### Tests

Each test below fails on `main` and passes after the slice, unless it says otherwise. No test sets the pulse `tracer` by hand: each starts from a plan file or a `PlanRecord`, so a missing mapping fails a test and does not default silently to `false`.

**The adapter maps the line (`packages/domain/test/plan-store-shell.test.ts`).** Write two plan files to a temp directory, the way the `deferred_prs` test in that file does: one with `- **Tracer:** yes` in `## Status` and no marker, one with a `<!-- spike -->` branch line and no `Tracer:` line. Read both through `planStoreShell`. Assert `tracer === true` for the first and `tracer === undefined` for the second. Fails on `main`: `PlanRecord` has no `tracer` field (a type error under `tsc`, `undefined` at run time for the first plan).

**The walk reads the line, not the marker (`packages/domain/test/plan-walk-assembly.test.ts`).**

- Invert the existing test at `:215-230`, "counts each branch state in the summary and marks a spike plan a tracer". Its plan has a `spike: true` branch and no `tracer` field, so the new expectation is `tracer === false`, and the test name becomes "…and does not read a spike plan as a tracer". This inversion is intended; an agent that reads the old assertion's failure as a regression and restores the marker rule breaks the decision above.
- Add one test with two `PlanRecord` fixtures through `assemblePlanWalk`: plan M has a `spike: true` branch and no `tracer`; plan T has `tracer: true` and no spike branch. Assert `tracer === false` for M and `tracer === true` for T. Both assertions fail on `main`.

**Auto-delivery holds the `Tracer: yes` plan and delivers the spike plan (`packages/domain/test/auto-deliver.test.ts`).** Build the pulse through the walk, not through the file's `world()` helper (`:104-112`), which sets `tracer` by hand. Two Approved `PlanRecord` fixtures, M and T as above, each with all branches merged and no dependent plan. Run `assemblePlanWalk`, map each assembled plan through `planRow`, parse the result with `FleetReadingSchema.parse`, and call `planAutoDeliver`. Assert the result names M and not T. Fails on `main`: it names T and not M.

**The fleet row and the card read the same phase (`packages/board/test/unit/fleet.test.ts`).** Build the same two-plan pulse through `assemblePlanWalk` and `planRow`, run `rowsFromPulse`, and compare each plan's row `phase` with `phaseOfPlan(phaseMap, { state: 'approved', tracer })` where `tracer` is what the parser gives for the plan file (`true` for T, absent for M), which is what the card at `board.ts:2637` reads. With `DEFAULT_PHASE_MAP` (`workflow-phases.ts:39`), assert M's rows read `Development` and T's rows read `Design`, and that each equals the card's phase. Fails on `main` for both plans: M's rows read `Design` and T's rows read `Development`.

**The corpus carries the key (`packages/domain/corpus/plan-store.corpus.test.ts`).** Moving `tracer` from `KNOWN_UNCARRIED` to `FIELDS` makes the corpus compare the key on every plan on `main`. No plan on `main` says `Tracer: yes`, so the corpus compares only absent against absent today; the adapter test above is the test that holds the `true` mapping. The corpus change passes on `main` and after; it makes the list record the decision.

### Gates

Run on the slice branch, from `node skills/plot/scripts/board/plot-local-checks.mjs`:

- `pnpm --filter @plot-pm/domain exec vitest related --run` over the changed domain files, and `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` (`PlanRecord` changes).
- `pnpm --filter @plot-pm/board exec vitest related --run --project parallel` over the changed board test, and `pnpm run typecheck` (the board imports `PlanRecord`).
- `node --test test/reconcile/*gate*.test.mjs` and the `scripts/check-*.sh` list from the `Local checks` key. No shell file changes, so `scripts/check-shell-lines.sh` is unaffected.

### Out of scope

- The corpus field lists accept a key that is on both `FIELDS` and `KNOWN_UNCARRIED`, and a carried key on `KNOWN_UNCARRIED` (`spike_approved_raw`, mapped at `plan-store-shell.ts:168`). Filed as #3121.
- The fleet's verify reader keeps reading the parser key directly (`packages/fleet/src/shared/auto-verify.ts:231`). It already has the `Tracer: yes` meaning.

### Changeset

`.changeset/the-pulse-s-tracer-flag-means.md`, in the slice's branch. `@plot-pm/domain` is private and ships inside the `plot` bundles, so the changeset names `plot`:

```markdown
---
'plot': patch
---

The pulse's tracer flag now reads the plan's `Tracer: yes` line, as its schema says, so the fleet view, the board card and auto-delivery treat the same plans as tracer plans. A plan with only a `<!-- spike -->` marker is no longer held for a person at auto-delivery.

<!--
plan: docs/plans/2026-11-04-the-pulse-s-tracer-flag-means.md
bumps:
  skills:
    plot: patch
-->
```

## Slices

### Tracer flag

- `feature/the-pulse-s-tracer-flag-means` <!-- waits: bug/the-queue-hands-out-an-approved-spike --> — `PlanRecord.tracer` mapped by `planOf`; the walk reads it and drops the `planSpikes` sum; `tracer` moves to the corpus `FIELDS`; the adapter, walk, auto-deliver and fleet-row tests; the changeset → #3194

## Notes

- Source: issue #3102. The decision between the two meanings is jwloka's, recorded in Design.
- Ordering: open PR #3105 (`bug/the-queue-hands-out-an-approved-spike`) rewrites `plan-walk-assembly.ts:317-340`, replaces `spikeCounts`/`spikeSliceOf` with `sliceReadingsOf`, and keeps one `planSpikes` sum only for `tracer`. This slice waits on it, rebases onto `main` after it merges, cites the walk by symbol name rather than by line, and removes that sum.
- Out-of-scope finding: #3121 (corpus field lists).
- Panel: `.plot/panels/2026-11-04-the-pulse-s-tracer-flag-means/panel.md`.
