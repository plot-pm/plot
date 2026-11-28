## Implementation brief — a-release-holds-merges-while-it-waits (wave 2: Automatic Hold)

- **Plan (canonical):** docs/plans/2026-11-27-a-release-holds-merges-while-it-waits.md on main
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-release-holds-merges-on-its-own` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review, per the plan's `Review: pr`

This is wave 2. It waits on `bug/a-waiting-release-holds-merges` (wave 1, the person hold). Do not start before wave 1 is merged: this branch reads `releaseHoldable`, `release-hold-person.json` and the `release-waiting` hold in `mergeArm` and `mergeAt`, and all three come from wave 1.

**State on main at dispatch (2026-11-28).** PR #3746 (wave 1's first attempt) merged and was reverted by `fa885117a` (#3766). Main holds no `rules/release-hold.ts`, no `ReleaseHoldStore` port and no `release-waiting` reason. The wave 1 brief on main (`.plot/briefs/a-waiting-release-holds-merges.md`) still describes the reverted automatic design, not the round 2 plan. If wave 1 is not merged when you read this, stop and report it.

### What to build

Round 2 split the hold in two. Wave 1 lets a person start the hold from the board. This wave lets fleetd start the same hold on its own, at green CI on the release head, and keeps it behind a config key that is off by default.

Concrete failure: release PR #3719 got 14 heads between 14:33 and 20:37 UTC on 2026-11-26, 5 of them after a fleet merge. On `e150fd7c1`, `validate` passed at 20:30:57, #3738 merged at 20:33:37 and `a232b0959` replaced the head at 20:34:34, so the review ran on a dead head. A person who is not at the board cannot press the button; the automatic hold is for that case.

Build four things:

1. **The `Release hold: off|auto` key.** Read it with `readConfig(opts, 'Release hold', 'off')` where `auto-merge.ts` reads `Checks wait` (line ~386). Any value other than `auto` reads as `off`. An unread config reads `off`. Document the key in the `## Plot Config` docs the way sibling keys are documented (grep a neighbour such as `Checks wait` for every place that lists keys, including `plot-init` and the config reference, and add the key there).
2. **`advanceReleaseHold(record, reading, now, boundMs)`**, a pure domain rule in `packages/domain/src/rules/` (arrow function, factual TSDoc). It answers the next `.plot/state/release-hold.json`, `{ pr, head, since, spentMs }`, and the hold verdict for this pass. Cover: no record, same head, new head, spent budget, closed PR, merged PR. `reading` carries the release row, the `releaseHoldable` answer from wave 1, `Auto-review`, and the review-start answer (`reviewStartAllowed`).
3. **fleetd writes the record.** A `ReleaseHoldStore` port in `packages/domain/src/ports/` (an `interface`, no runtime code), a file adapter under `packages/domain/src/adapters/release-hold/` (copy the shape of `adapters/repair-record/repair-record-file.ts`: whole-file write by rename, `ENOENT` reads `null`, an unparseable or other-version file reads `null`), and the call where fleetd builds the merge tick's readings (`packages/fleet/src/shared/auto-merge.ts`, near the `defaultBranchFile(home)` read, line ~374). The merge pass runs apart from the release tick (`auto-writes.ts:127`; `release-tick.ts:129-144` keeps its own readings), so the write lives in the merge pass over the index row. fleetd is the one writer of `release-hold.json` and decides nothing beyond what the rule answers.
4. **The automatic hold in `mergeArm` and `mergeAt`.** Wave 1 adds `release-waiting` for the person hold. This wave makes both read the automatic record too, through the same code path: one `release-waiting` reason, one place that decides it. Do not add a second reason or a second check site.

### Settled decisions — do not re-derive them

**`spentMs` counts time held while fleetd runs, and it is the budget.** Each pass adds the time since the previous pass, capped at the merge pass's own interval, so a stopped fleetd spends nothing. A fleet stop during a hold therefore spends nothing; a wall-clock bound (`since + boundMs`) would end the hold during the stop. One budget belongs to one release PR and a new PR number starts at 0. Once `spentMs` reaches `boundMs`, no automatic hold starts for that PR. Rejected: a per-head budget. Measured 2026-11-26, 14 heads in about 6 h would each get a fresh bound and the hold would never end.

**A person hold ignores the budget.** A person hold holds after `spentMs` is spent. The two records are separate files (`release-hold-person.json` is wave 1's, written by the controllers; `release-hold.json` is this wave's, written by fleetd). Do not merge them and do not let fleetd write the person file.

**The bound is `Checks wait`, with no new duration key.** Pass the `checksWaitMs` that `auto-merge.ts` already computes for the same tick. Open question `[question-bound-value]` stays open; implement its recommendation.

**The key is off by default for a measured reason.** During a sprint, the 14 afternoon heads of 2026-11-26 would spend the budget while nobody approves. Do not change the default.

**The automatic hold needs a review that can start.** It holds nothing where `Auto-review` is false or `reviewStartAllowed` refuses the head, because no review can then reach `success`. A naive version passes the green-CI test and holds forever on a head that no review will reach.

**Readiness is wave 1's `releaseHoldable`.** Do not write a second readiness test. It reads no scope, so a `waiting-scope` release holds like `ready`. On 2026-11-26 both `e150fd7c1` and `8e1373e0f` read `waiting-scope` and a stage-reading hold held nothing.

**The record holds facts, not a verdict.** It stores `pr`, `head`, `since` and `spentMs`; it never stores `holds`. The hold is derived each pass. CLAUDE.md "A Decision Reads The Index" names `default-branch.json` as the one sanctioned verdict file; this file is not a second exception.

**Absent is not false.** A missing row, an unparseable record, a failed write and an unread config hold nothing. A hold stops work, so an unread input must never start one. Read the exit code, not the emptiness. The index never says no: a non-OPEN or absent release row holds nothing and never proves "no release".

**Out of scope.** The direct pushes (dispatch's brief bookings, `plot-open-pr.sh`'s PR records) stay; `[question-direct-pushes]` accepts them. The `[question-ready-notice]` notice and the board texts are wave 1's. Do not touch `packages/board/`.

### Done when

The plan's tests list for this slice is the specification:

- With the key absent or `off`, a holdable head holds nothing. Catches a default of `auto`.
- With `auto`, the first holdable pass starts the hold at that pass, not at the next one.
- `advanceReleaseHold` covers no record, same head, new head, spent budget, merged PR and closed PR.
- Three heads of one PR held 25 min each with `boundMs` 3600 s hold until `spentMs` reaches 3600 s and not one pass later. Catches a per-head budget and an off-by-one at the bound.
- A new PR number starts at 0.
- A fleet stop during a hold spends nothing. Catches a wall-clock bound.
- A person hold holds after `spentMs` is spent.
- `Auto-review` false, or a refused review start, holds nothing.
- A lift ends the automatic hold for its head, and a new head starts it again within the budget.
- Two ticks on the same head leave `since` unchanged. The naive version resets `since` every pass and passes every other test.

Plus the repo's gates: a changeset for `plot` (patch), description first and the `bumps:` block last, with the optional `plan:` line naming this plan. Add one paragraph for `release-hold.json` to CLAUDE.md "A Decision Reads The Index" (wave 1 adds the person file's paragraph; extend it, do not duplicate), then run `./scripts/check-agents-md.sh --write`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This branch should touch no `.sh` file; if it does, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` grows, and the growth must be paid for in the same change by removing shell elsewhere or writing the rule in the domain. The gate counts commands, not lines, and has no override. New code is arrow functions; outside `adapters/` the domain imports `zod` only.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR through the controller: `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Automatic Hold` in the plan's `## Slices` section. Before a hand fix of a PR, read `inFlight` in `.plot/state/fixer-attempts/<pr>.json`.

### Scope guard

This branch owns `packages/domain/src/rules/` (the new `advanceReleaseHold` file and its test), the new port and adapter for `release-hold.json`, `packages/fleet/src/shared/auto-merge.ts` (the readings and the one record write), the `release-waiting` read of the automatic record in `mergeArm` and `mergeAt`, the `Release hold` key's documentation, `CLAUDE.md` with its generated `AGENTS.md`, and the changeset.

`bug/a-waiting-release-holds-merges` (wave 1) owns `releaseHoldable`, the person hold, both controllers, the buttons, the board texts and `release-hold-person.json`. This branch edits `mergeArm` and `mergeAt` after wave 1 merges, so rebase on main before the first edit there and keep the diff to the one read.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
