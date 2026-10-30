## Implementation brief — merged-slices-update-the-comment (wave 2: Merged slice count)

- **Plan (canonical):** docs/plans/2026-10-29-tickets-follow-the-delivery-loop.md on main
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2916 merged
- **Branch:** `feature/merged-slices-update-the-comment` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review via plot-review app)

This branch's prior wave, "Comment renderer" (`feature/the-plan-comment-renders-records`), merged as PR #2932. The renderer and the port field it writes through are already on `main`; this wave feeds them their first real input. The third wave, "Jira at approve" (`feature/jira-moves-at-approve`), is independent of this one — neither blocks the other.

### What to build

Today, `PlanStateWrite.sliceProgress` (`packages/domain/src/ports/tracker.ts:122`) exists and `planIssueComment` (`packages/domain/src/rules/plan-issue-comment.ts:46`) already renders it when present — but nothing in the codebase ever sets it. Verified by `grep -rn sliceProgress packages/ --include="*.ts"`: every non-test hit is inside the renderer, the port, or `tracker-plan-state.ts`'s D6 read-back fallback. No caller computes the string and no write point passes it. This wave closes that gap: add `sliceProgress` to `rules/deliverable.ts` (it sits beside `allSlicesMerged`, same file, same pulse), and wire a `pr merged` index finding to trigger a plan-state write that carries it.

The count itself: "M of N slices merged", where N is the plan's non-deferred slices and M is how many read `complete` on the pulse — the same resolution `allSlicesMerged` already uses (merge-subject evidence counted as merged, since this write is comment-only and reversible, unlike delivery). Render no line at all on a partial pulse; a half-computed count is worse than a stale one.

### Decisions already settled — do not re-derive them

**The count reuses `allSlicesMerged`'s plumbing, not a new traversal.** `allSlicesMerged` (`packages/domain/src/rules/deliverable.ts:62-189`) already walks `pulse.plans[].slices[].branches[]`, already excludes `deferred` branches from both the numerator and the denominator's zero-check, and already refuses on a slice naming no branch. `sliceProgress` needs the same walk, counting `merged` (slices whose `verdict === 'complete'`) against `total` (non-deferred slices with at least one branch) rather than collapsing to one of three enum values. Do not write a second traversal with its own deferred-handling — the shared `landed()` helper (`:124-189`) is the reference for exactly which branches count; if the counting logic needs its own helper, factor it out of `landed()` rather than reimplementing the deferred/empty-slice rules from scratch. A unit test must pin `merged === total` exactly when `allSlicesMerged` answers `'merged'` on the same fixture — the plan's Design section requires this invariant explicitly.

**No line on a partial pulse, matching `allSlicesMerged`'s `'unknown'` refusal.** `allSlicesMerged` returns `'unknown'` when `!pulse || !complete` (`:132`). `sliceProgress` must refuse the same way — return `undefined`, which `planIssueComment` already treats as "keep the existing line" via D6's read-back path. Do not render "0 of N" on a partial pulse; that is a false negative, not an honest unknown.

**The trigger is the index's `pr merged` finding, already computed, never before consumed as a write trigger.** `rules/index-findings.ts:105` emits `'pr merged'` on every merge inside its window; today its only consumers are UI toast/attention logic (`follow-channel.ts:20`, `attention.ts:86-91`) — verified by grepping for the string outside `index-findings.ts` and its tests. This wave adds a server-side consumer: wherever findings are read to drive fleetd's or the board's write points (look at how `attention.ts` or `follow-channel.ts` are invoked from `packages/fleet/` or `packages/board/src/server/` to find the right call site — there is no existing plan-state trigger point to extend, so trace one finding's consumption end-to-end before adding a second). The write is comment-only: no label change, and it fires only while the plan reads `approved` on the default branch — check the plan's phase before writing, the same guard `deliver.ts`'s phase-specific writes already use elsewhere in this file's sibling callers.

**Wire `sliceProgress` into `PlanStateReading` and `plan-state.ts`'s `run()`.** `PlanStateReading` (`packages/domain/src/rules/issue-status.ts:65-74`) currently carries only `phase`, `issues`, `planLink`, `version` — no `sliceProgress` field. `plan-state.ts:162-203`'s `run()` builds its `reading` from `plot-plan-meta.sh`'s JSON and flags alone; it reads no pulse today. Verified: `grep -n "sliceProgress\|highTickets" packages/board/src/server/entry/plan-state.ts` returns nothing. This wave must add the pulse read (the same `FleetReading | null` + `complete` pair `board.ts:1319-1332`'s `planStatus` already takes) to whichever entry point ends up doing the `pr merged`-triggered write, compute `sliceProgress` there, and pass it through to `PlanStateWrite`. Do not thread it through `PlanStateReading` if the `pr merged` trigger calls the tracker directly instead of through `plan-state.ts` — follow the actual call path the trigger wiring requires, and say in your PR which shape you chose and why if it is not `plan-state.ts` itself.

**D6's read-back is already correct and needs no change.** `tracker-plan-state.ts:191` already falls back to the prior comment's progress line when `write.sliceProgress === undefined`. Do not touch that file unless the write-point wiring reveals an actual defect in it — the mechanism it implements was this plan's prior wave, already reviewed and merged.

**A repository with no `Issue:` line gets nothing**, per the plan's closed Open Question — `planStateWrites` already returns an empty list for such a plan (verify this still holds; do not add a special case here).

### Done when

The plan's `## Done when` is implicit in its Design section (no literal `## Done when` heading exists in this plan — the Design section's invariants are the specification): a merge, by a person or the fleet, updates the plan issue's Plot comment to show the new "M of N slices merged" count, while the plan is Approved, with no hand edit. Lift these as assertions:

- A unit test pinning `sliceProgress(meta, pulse, complete)` returns `undefined` on a partial pulse (`!complete`), matching `allSlicesMerged`'s `'unknown'` refusal on the identical fixture.
- A unit test pinning `merged === total` in the rendered string exactly when `allSlicesMerged` answers `'merged'` on the same fixture — this is the explicit invariant the plan's Design section names, and it is the test most likely to be skipped because it requires running both rules side by side rather than testing `sliceProgress` in isolation.
- A unit or integration test proving a `pr merged` finding on an `approved` plan with an `Issue:` line produces a `PlanStateWrite` carrying the new count string — not just that `sliceProgress` computes correctly in isolation, since the wiring from finding to write is the actual gap this wave closes.
- A test proving the write does NOT fire (or fires with no `sliceProgress`) when the plan's phase is not `approved` — the design explicitly scopes this to "while the plan reads `approved`."
- A test proving a plan with no `Issue:` line triggers no tracker call at all on a `pr merged` finding.

Plus: `packages/domain` fails below 100% coverage per this plan's Design section ("All new domain rules carry full coverage") — run coverage on any new file under `packages/domain/src/rules/`. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` (path resolved relative to this skill's directory) before each push, and run what it prints. The suites named under the repo's `CI suites` config key run in CI only — do not run them locally as a matter of course; a failure there comes back as a correction.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grows past its merge base. This wave is domain/board TypeScript, not shell — it should not touch `.sh` files at all; if it turns out to need a shell change, that growth must be paid for in the same change (remove shell elsewhere, or push the logic into the domain/bundle instead).

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while work is still moving
```

It reads this plan's `## Slices` section for the wave heading and title, and refuses a branch no plan names or one a PR already carries. Push the first real commit as soon as it exists, so the branch is visible to `/plot-pulse` and the fleet early.

Once the PR exists, append `→ #<number>` to this branch's line under "### Merged slice count" in the plan's `## Slices` section, in the same commit or a fast follow-up — `/plot-deliver` back-fills a missed annotation, but doing it at creation keeps the plan current for anyone reading it mid-flight.

### Scope guard

This branch owns: `packages/domain/src/rules/deliverable.ts` (the new `sliceProgress` export), and whichever file ends up hosting the `pr merged` → plan-state-write wiring (likely `packages/board/src/server/entry/plan-state.ts` and/or `packages/domain/src/rules/issue-status.ts`'s `PlanStateReading`, or a fleet-side trigger point under `packages/fleet/` — trace the finding's actual consumption path before committing to a file).

This branch does NOT own: `packages/domain/src/rules/plan-issue-comment.ts`, `packages/domain/src/adapters/tracker/tracker-plan-state.ts`, or the `PlanStateWrite`/`PlanHighTicket` port shapes in `packages/domain/src/ports/tracker.ts` — all already merged in PR #2932 (wave 1). Touch them only if the write-point wiring surfaces an actual defect, and say so explicitly in the PR.

The sibling in-flight branch, "Jira at approve" (`feature/jira-moves-at-approve`), touches `approve.ts`'s call to `plot-issue-status.sh` and the status-word reads in `plot-issue-status.sh`/`plot-issue-status.mjs` — no file overlap with this wave's scope as currently understood. Re-check with `/plot-pulse` before merging if either branch's actual diff grows past what's named here.

If you find something the plan did not anticipate — in particular, if no clean call site exists for turning a `pr merged` finding into a tracker write without duplicating logic `attention.ts`/`follow-channel.ts` already has — report it rather than improvising a shape the plan didn't choose.
