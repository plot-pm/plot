# A release holds merges while it waits

> A person who opens the board to approve a release presses "Hold merges, I am approving now", and fleetd's merge arm and `plot-ask.mjs merge` then hold every merge into the default branch as `release-waiting` for at most `Checks wait`, until the person lifts the hold or the release ends. An automatic hold from green CI on the release head stays available behind the `Release hold` config key, off by default.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-waiting-release-holds-merges`
- **Started:** 2026-11-28, Jan Wloka, `bug/a-release-holds-merges-on-its-own`
- **Started:** 2026-11-28, Jan Wloka, `bug/a-person-holds-merges-for-a-release`

## Changelog

- A person can hold the fleet's merges into main while they approve a release, so the release head no longer moves under the approval. The release row's "Hold merges, I am approving now" button and `plot-ask.mjs release-hold <sha>` hold merges as `release-waiting` for at most `Checks wait`, *Waiting on you* and the release row show when the hold ends, and "Lift the hold" ends it. A repository can set `Release hold: auto` to let fleetd start the hold itself at green CI on the release head.

<!-- Board impact: the release row gets "Hold merges, I am approving now" and "Lift the hold" with two new routes, and *Waiting on you*, the release row and a held PR's Status word show the hold (slice 1). No change to the plan format, the template or the docs/plans layout. -->

## Motivation

Changesets rebuilds the release PR after every push to main (`release.yml` runs on every push). On 2026-11-26 release PR #3719 got 14 new heads between 14:33:17 and 20:37:05 UTC. 5 of them follow a PR merge by `app/plot-merger` (#3733, #3711, #3695, #3737, #3738). 9 follow a direct push to main. Most of these are deliveries and board artifact builds, which follow merges, and a defer and a sprint edit. 4 follow no merge: dispatch's `book the brief and plan start` (19:16, 19:40 UTC) and `plot-open-pr.sh`'s `record PR` (19:21, 19:46 UTC).

Each new head needs a CI run and a `plot/review` before `releaseApprovable` (`packages/domain/src/rules/release-approvable.ts:65`) enables the passkey button. On `e150fd7c1`, `validate` passed at 20:30:57, #3738 merged at 20:33:37, and `a232b0959` replaced the head at 20:34:34, the second in which the review on `e150fd7c1` went `pending`. It went `success` at 20:36:00 on a head that was no longer the release head.

Main got no push after `6c639d891` (20:36:09 UTC). `8e1373e0f` read `validate` success from 20:55:50, and its `plot/review` went `pending` at 22:31:41, 15 s after the fleet stop (`.plot/state/fleet-stopped.json` reads `at: 2026-11-26T22:31:26Z`), and `success` at 22:31:49. #3719 merged at 07:52 UTC on 2026-11-27 as `a55df0f41`. The last fleet merge was #3738 at 20:33:37, so the fleet merged nothing for 11 h 18 min.

The measured wait had three parts: a moving head (14:33 to 20:37), a review that did not start on a stable green head (20:55 to 22:31), and an approval that the tailnet board could not complete (22:31 to 07:52). #3754 (merged 2026-11-27) fixed the second part: `releasePrepareNext` now starts a review in `waiting-scope` for a green head through `releaseReviewStep` (`packages/domain/src/rules/release-prepare.ts:268`). The third part is issue #3750: `RP_ID` is `'localhost'` and the board verifies only the origin `http://localhost:<port>` (`packages/board/src/server/passkey.ts:110`). This plan fixes the first part.

`releaseStage` answers `waiting-scope` (`release-prepare.ts:228-229`) before it reads checks or the review, and on 2026-11-26 both `e150fd7c1` and `8e1373e0f` read `waiting-scope`. `releaseApprovable` does not read the stage, and #3719 was approved in `waiting-scope`. A hold that reads the stage therefore holds nothing in the measured case.

fleetd's merge arm, `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:481`), holds a merge for a red, stale or unsettled default branch, and `HoldReason` (`slice-pr-next.ts:162`) is an open set. No hold reads the release PR.

## Design

### Approach

- **Readiness is what the approve button reads.** `release-prepare.ts` exports `releaseHoldable(row, headChanges)` beside `releaseReviewStep`, the review check #3754 shares between `preparing` and `waiting-scope`. It answers `holdable` for an OPEN `changeset-release/` row into the default branch with a `headSha`, `ciChecks` counted on `checksSha === headSha` (`ciCounted`, the criterion `releaseApprovable` reads), a trusted `plot/review` on the head that is absent, `pending` or `success`, and a head whose changes read clean or are unread. Otherwise it names the first unmet criterion. It reads no scope, so `waiting-scope` holds like `preparing` and `ready`.
- **Five stages end a hold.** A hold ends only on `merged`, `publishing`, `released`, `failed` or `release-head-foreign`, on the person's lift, or at its bound. `publishing`, `released` and `failed` follow a merge, so a MERGED row ends the hold before them. The merge arm reads no head changes; there `release-head-foreign` cannot end a hold, and the lift and the bound end it.
- **A person starts the hold.** "Hold merges, I am approving now" (`POST /api/release-hold`) and `plot-ask.mjs release-hold <sha>` record `{ pr, act: hold, head, at, by }` in `.plot/state/release-hold-person.json`, where `releaseHoldable` answers `holdable` for that head. The hold holds merges into the default branch from `at` until `at + boundMs` (`Checks wait`, 3600 s here), across new heads of the same release PR. "Lift the hold" (`POST /api/release-hold-lift`) and `plot-ask.mjs release-hold-lift <sha>` record `act: lift` naming the head. The controllers are the one writer of the file, each act is one whole-file write, and fleetd only reads it.
- **The merge arm reads the PR index row.** The merge pass runs apart from the release tick (`packages/fleet/src/shared/auto-writes.ts:127`), and `releaseTick` keeps its readings in its own pass (`release-tick.ts:129-144`). `mergeArm` therefore reads the release PR's index row and the person file. This is a decision from a non-terminal answer, and slice 1 adds its paragraph under "A Decision Reads The Index" in `CLAUDE.md`: the hold is reversible, bounded by `boundMs`, and an absent or non-OPEN row holds nothing, so the index never says no.
- **The merge arm holds as `release-waiting`.** `mergeArm` gains the hold for a PR whose `base` is the default branch that `holdsApply` names, after `default-branch-red`, `default-branch-stale`, `default-branch-unsettled` and `merge-in-flight`, and before `conflicting` and the merger-app holds. A PR into a `sprint/` base, the release PR itself, and a PR that `repairAdmitted` admits (the repair or revert PR the repair record names) are not held.
- **`plot-ask.mjs merge` honours the hold.** `mergeAt` (`workflows/merge.ts`) refuses `release-waiting` for a PR into the default branch while the hold holds, so a master agent's merge does not move the release head either. A person's merge on the host is out of scope.
- **The board shows the hold.** *Waiting on you* lists `release #<n> holds merges until <end>`, the release row reads `holds merges since <since> · ends <end>`, and a held slice PR's Status word reads `release-waiting`. "Hold merges, I am approving now" and "Lift the hold" always show, disabled with their reason. All of these are domain properties.
- **The passkey's `localhost` limit shows at both buttons.** On a board origin other than `localhost`, "Approve release" and "Hold merges, I am approving now" are disabled with the reason that the passkey works only on `http://localhost:<port>` (#3750), and name the local board as the route. A hold on such a board holds merges for an approval that cannot complete there.
- **The automatic hold is off by default.** `Release hold: off|auto` is a `## Plot Config` key read through `plot-config.sh get "Release hold" off`. With `auto`, fleetd starts a hold at the first pass that sees `releaseHoldable` answer `holdable` on a head, and `advanceReleaseHold(record, reading, now, boundMs)` answers the next `.plot/state/release-hold.json` (`{ pr, head, since, spentMs }`) for no record, the same head, a new head, a spent budget, a closed PR and a merged PR. fleetd is the one writer and decides nothing beyond what the rule answers.
- **`spentMs` counts time held while fleetd runs.** Each pass adds the time since the previous pass, capped at the merge pass's own interval, so a stopped fleetd spends nothing. One budget belongs to one release PR, and a new PR number starts at 0. Once `spentMs` reaches `boundMs`, no automatic hold starts for that PR; a person hold still holds. During a sprint the 14 afternoon heads of 2026-11-26 would spend the budget while nobody approves, which is why the key is off by default.
- **The automatic hold needs a review that can start.** It holds nothing where `Auto-review` is false or `reviewStartAllowed` refuses the head, because no review can then reach `success`.
- **The direct pushes stay.** Dispatch's brief bookings and `plot-open-pr.sh`'s PR records still move the release head during a hold. Each moves it once per slice start or PR open; a person hold covers the new head, and an automatic hold restarts at green CI on it within the same budget.

### Open Questions

- [ ] `[question-bound-value]` Recommendation: `Checks wait` as both the person hold's length and the automatic budget, with no new duration key, until a measurement shows they need different values.
- [x] `[question-stage-on-2026-11-26]` Answered in round 2: both heads read `waiting-scope` (`release-prepare.ts:228-229`), so readiness reads `releaseHoldable` and no scope.
- [ ] `[question-direct-pushes]` Recommendation: accept the 4 non-merge pushes for now; hold dispatch bookings during a hold only if a replay shows they keep a head from reaching review.
- [ ] `[question-ready-notice]` `releasePrepareNext` notifies only past `waiting-scope` (`release-prepare.ts:343-345`), so an operator gets no notice that a release in `waiting-scope` can be approved. Recommendation: notify once per head in `waiting-scope` where `releaseApprovable`'s CI and review criteria hold, naming the scope plans not yet Delivered, in slice 1; otherwise *Waiting on you* stays the only signal.

## Slices

### Person Hold

- `bug/a-person-holds-merges-for-a-release` — `releaseHoldable` exported from `release-prepare.ts`; the person hold and the lift through `POST /api/release-hold`, `POST /api/release-hold-lift`, `plot-ask.mjs release-hold <sha>` and `release-hold-lift <sha>`, with the controllers as the one writer of `release-hold-person.json`; the `release-waiting` hold in `mergeArm` over the index row and in `mergeAt`; the hold in *Waiting on you*, on the release row and as the Status word; both buttons shown at all times with their disabled reasons, including #3750's `localhost` limit at "Approve release" and "Hold merges"; the "A Decision Reads The Index" paragraph in `CLAUDE.md` <!-- builds: releaseHoldable, the person-hold controllers and buttons, the release-waiting rule in mergeArm and mergeAt, its board texts, the CLAUDE.md paragraph --> <!-- tests: a replay of 2026-11-26 20:30:57–20:34:34 UTC with a scope plan not Delivered (waiting-scope), the index row with ciChecks counted on e150fd7c1 and no review, and a person hold taken at 20:31 holds #3738 as release-waiting at 20:33:37; a waiting-scope release with a green, unreviewed head is holdable; each of merged, publishing, released, failed and release-head-foreign ends a hold; a hold pressed at T holds at T + boundMs − 1 and not at T + boundMs; the cap: a new head at T + 10 min does not extend the hold past T + boundMs; a lift names its head, a lift for another head lifts nothing, and a lift for a head the file does not name refuses; on a red main the repair PR and the revert PR merge while the hold holds; a sprint/x PR and the release PR are not held; two release rows pick the one into main; mergeArm order against each default-branch hold, merge-in-flight and conflicting; plot-ask.mjs merge refuses release-waiting for a PR into main and merges a PR into sprint/x; both commands refuse PLOT_UNATTENDED=1; the gate refuses curl POST /api/release-hold and /api/release-hold-lift; each button's disabled reason, the non-localhost reason, the Waiting on you row, the release row text and the Status word are unit-tested domain properties with one browser test that the row shows --> → #3768

### Automatic Hold

- `bug/a-release-holds-merges-on-its-own` — the `Release hold: off|auto` key, off by default; `advanceReleaseHold` and the per-PR `spentMs` budget; fleetd as the one writer of `release-hold.json`; the automatic hold in `mergeArm` and `mergeAt` <!-- waits: bug/a-person-holds-merges-for-a-release --> <!-- builds: advanceReleaseHold, the Release hold key and fleetd's write of release-hold.json --> <!-- tests: with the key absent or off, a holdable head holds nothing; with auto, the first holdable pass starts the hold at that pass; advanceReleaseHold covers no record, same head, new head, spent budget, merged and closed PR; three heads of one PR held 25 min each with boundMs 3600 s hold until spentMs reaches 3600 s and not one pass later; a new PR number starts at 0; a fleet stop during a hold spends nothing; a person hold holds after spentMs is spent; Auto-review false or a refused review start holds nothing; a lift ends the automatic hold for its head, and a new head starts it again within the budget -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.

2026-11-27: amended from panel round 1 (unanimous amend); see `.plot/panels/2026-11-27-a-release-holds-merges-while-it-waits/panel.md`.

2026-11-28: amended from panel round 2 (unanimous amend); the operator chose the person-started hold for slice 1 and the automatic hold behind a config key, off by default; see `.plot/panels/2026-11-27-a-release-holds-merges-while-it-waits/r2-panel.md`.

2026-11-28: #3746 merged the pre-round-1 design on `bug/a-waiting-release-holds-merges`, and #3766 reverted it. Slice 1 moves to `bug/a-person-holds-merges-for-a-release`, because the wave gate reads the old branch as merged.
