## Implementation brief — delivery-sections-count-alike (wave 2: Held slices)

- **Plan (canonical):** docs/plans/2026-11-22-delivery-sections-count-alike.md on main
- **Approved:** 2026-11-22, Jan Wloka, plan-PR #3656 merged
- **Branch:** `feature/a-held-slice-names-its-hold` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR, per the plan's `Review: pr`

Wave 1 (`feature/delivery-header-counts-every-state`, PR #3662) merged 2026-11-22. The plan's `waits:` prerequisite `feature/release-delivery-plan-rows-unfold` (PR #3665) merged 2026-11-22. Both are on `origin/main`, so this branch is unblocked. Wave 3 (`feature/fleet-rows-name-their-plan`) waits on a different branch and does not wait on this one.

### What to build

A not-started slice that waits for a brief or for another slice reads the same as a slice nobody has reached. Measured 2026-11-22: the Sprint delivery header read "7 plans · 11 of 16 slices delivered · 1 at a gate · 0 blocked", and `feature/delivery-work-items-grid` (no brief) and `feature/delivery-activity-signals` (waits on it) both counted `not-started`. The Delivery tab showed neither reason, although `/api/fleet` carries both (`brief: missing`, `blockedBy`).

Build three things on top of what wave 1 and #3665 landed:

1. **`notStartedHold` in the domain** (a new rule next to `sliceStateOf` in `packages/domain/src/rules/slice-states.ts`, or its own file under `rules/`). It takes a `not-started` slice's `WorkItemReading` and returns `{ kind: 'no-brief' } | { kind: 'waits-on', slice } | null`. `no brief` where the item says its brief is missing; `waits on <slice>` where `WorkItemReading.waitsOn` names one; `null` otherwise. Where both hold, `no brief` wins, because the brief is what the agent needs before the wait matters. State that order in the TSDoc and test it.
2. **A held count in the header.** `headerCountParts` (`release-plan-rows.ts:358`) already returns the five states in `SLICE_STATES` order. Give the not-started part a held count, so the header text reads "4 not started · 2 held". The held count has no reasons in it: the design spec keeps header text visual. The count is summed from the plan rows the way `stripStateCounts` sums the five states; add no second sum over a different source. A held count of 0 prints nothing after `not started`.
3. **The hold on the slice line and the Work items row.** `slicePills` (`release-plan-rows.ts:199`) takes the slice's state only. Let it take the hold as well, so a held not-started line reads "not started · no brief" or "not started · waits on Work items grid". `workItemPills` / `waitPills` (`delivery-work-columns.ts:76`) already print `waits on <slice>` from `facts.waitsOn`; add `no brief` there from the same hold, and do not print the same wait twice.

`PlanSliceFact` (`release-plan-rows.ts:35`) is where the board hands the domain what it read per slice: `factsOf` in `delivery-view.ts:988` builds it and already reads `rows` per slice. Add the hold there, derived from the item's reading, not from a second pass over the rows.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The hold is a sub-count of `not-started`. It never sets `heldBy`, and `sliceStateOf` does not change.** `heldBy` moves a slice to `at-a-gate` (`slice-states.ts` line 69, `item.heldBy !== undefined`), and a slice that waits for a brief is not at a gate. Changing the state would move the held slices out of `not-started`, and the five counts would no longer match the bar and the Release group legend. The test the plan names says it: a held queued slice still counts `not-started`.

**`sliceHold` in `verdict.ts:106` keeps its meaning.** It answers the dispatch question (is the whole slice held, so a dispatch would fail). `notStartedHold` answers a display question for one slice's item. Do not call one from the other and do not merge them: they read different inputs (branch `state`/`startability` versus a `WorkItemReading`) and a shared function would couple the controller's refusal to a label.

**No new state file, no per-tick hold record.** A persisted hold is a second persisted verdict, which *Answers, never verdicts* in CLAUDE.md refuses. The hold derives from fields `/api/fleet` already carries.

**fleetd-only holds stay out of the count.** `ref-held`, `in-flight`, `refused` and `no-free-agent` (`PlanSkipReason`, `auto-dispatch.ts:816`) reach fleetd's log only and the board has no reading of them. Counting them would need a new read, which the plan rules out.

**Absent is not false.** A slice whose row the board did not read has no hold, and it already reads `unread`, not `not-started`. Do not read an absent brief fact as "has a brief" or as "missing": `notStartedHold` returns `null` for it, and the `unread` rule is unchanged.

**Where the brief fact comes from.** `WorkItemReading` (`delivery-placement.ts`) has `waitsOn` and no brief field. `rowItem` in `packages/board/src/app/lib/agent-rows/delivery-readings.ts:261` fills `waitsOn` from `blockedBy` and is where the brief fact is filled. Read it from `needsBrief(row)` (`row-identity.ts:135`), which reads `startability === 'needs-brief'`. That is the field `needsBrief` already follows, and `brief: 'missing'` is the state `schema.ts:3155` says cannot tell "nobody asked" apart from "being written"; do not read `brief: 'missing'` alone. Add one optional field to `WorkItemReading` (`needsBrief?: boolean`, set only where true, like `blockedMarker`), so every existing reading stays valid.

**Arrow functions.** New functions in `packages/domain/**` and any new helper you write elsewhere are arrows (`export const f = (…) => …`), with factual TSDoc and no history.

### Done when

The plan's slice line is the specification: the not-started count names how many slices are held, and the slice line names each hold. The assertions that exist because a naive implementation passes without them:

- **A held queued slice still counts `not-started` in `countSliceStates`** (`slice-states.test.ts`). A change that moves held slices to `at-a-gate` or drops them from the five counts breaks the sum, and this test is the one that sees it.
- **A needs-brief reading gives `no brief`, a `waitsOn` gives `waits on <slice>`, neither gives `null`, both gives `no brief`.** Four cases; a rule that returns the first truthy field passes three of them.
- **The held count is a sub-count.** "4 not started · 2 held" holds only where 4 ≥ 2 and the five states still sum to the total. Assert the five-part sum with a held slice in the input.
- **A held count of 0 prints no ` · 0 held`.** A format string that always appends it passes every held case.
- **A `building`, `at-a-gate` or `delivered` slice with `waitsOn` set gets no hold.** The hold applies to `not-started` only.
- **`waits on` is not printed twice** on a Work items row that already shows it through `waitPills`.
- **A slice with no read item gives no hold and stays `unread`.**

Plus: run `nvm use` (Node 26, per `.nvmrc`), then `node skills/plot/scripts/board/plot-local-checks.mjs` after each commit and before each push, and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `pnpm run test:e2e`. A builder runs `pnpm build:board` only to look at the result locally and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one.

The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Add a changeset naming `@plot-pm/board` with the description first, no `bumps:` block, and a `plan:` line inside the trailing comment; copy the format of a recent file in `.changeset/`. The domain 100 % coverage gate applies to `notStartedHold`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this slice's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/slice-states.ts` (or a new rule file beside it), `packages/domain/src/rules/release-plan-rows.ts`, `packages/domain/src/rules/delivery-work-columns.ts`, `packages/domain/src/rules/delivery-placement.ts` (the one optional field), `packages/board/src/app/lib/agent-rows/delivery-readings.ts`, `delivery-view.ts`, `delivery-row-facts.ts` for the hold only, their tests, and one changeset.

Checked against open PRs on 2026-11-23: no open pull request other than the release PR (`changeset-release/main`, #3598) changes these files. `feature/fleet-rows-name-their-plan` (wave 3) will touch `delivery-readings.ts` and `delivery-row-facts.ts` after `feature/fleet-switches-in-fleet-section` lands; keep your edits to `rowItem` to the one `needsBrief` line so the later merge is a clean one. Do not touch `RoleRunSchema`, `agentActsOnBranch` or the Fleet rows: they belong to wave 3.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
