# A release holds merges while it waits

> From the moment the release PR's head reads green CI until the release can be approved, fleetd's merge arm holds every merge into the default branch under the named hold `release-waiting`, for at most `Checks wait` summed over all heads of one release PR, and a person can start or lift a hold of their own on the board.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-waiting-release-holds-merges`

## Changelog

- A release PR that is ready to approve no longer goes stale under the fleet's merges. From green CI on the release head, fleetd holds merges into main as `release-waiting`, and *Waiting on you* and the Delivery tab's release row show when the hold ends. The automatic hold lasts at most `Checks wait` over all heads of one release PR. A person can start a hold of `Checks wait` before approving, and lift any hold.

<!-- Board impact: *Waiting on you* and the release row show the hold (slice 1); the release row gets "Hold merges" and "Lift the hold" buttons with two new routes (slice 2). No change to the plan format, the template or the docs/plans layout. -->

## Motivation

Changesets rebuilds the release PR after every push to main (`release.yml` runs on every push). On 2026-11-26 release PR #3719 got 14 new heads between 14:33:17 and 20:37:05 UTC. 5 of them follow a PR merge by `app/plot-merger` (#3733, #3711, #3695, #3737, #3738). 9 follow a direct push to main. Most of these are deliveries and board artifact builds, which follow merges, and a defer and a sprint edit. 4 follow no merge: dispatch's `book the brief and plan start` (19:16, 19:40 UTC) and `plot-open-pr.sh`'s `record PR` (19:21, 19:46 UTC).

Each new head needs a CI run and a `plot/review` before `releaseApprovable` (`packages/domain/src/rules/release-approvable.ts:65`) enables the passkey button. On `e150fd7c1`, `validate` passed at 20:30:57, #3738 merged at 20:33:37, and `a232b0959` replaced the head at 20:34:34, the second in which the review on `e150fd7c1` went `pending`. A hold that starts at a `pending` or `success` review never fires in that window; only a hold that starts at green CI does.

Main got no push after `6c639d891` (20:36:09 UTC). `8e1373e0f` read `validate` success from 20:55:50, and its `plot/review` went `pending` at 22:31:41, 15 s after the fleet stop (`.plot/state/fleet-stopped.json` reads `at: 2026-11-26T22:31:26Z`), and `success` at 22:31:49. #3719 merged at 07:52 UTC on 2026-11-27 as `a55df0f41`. The last fleet merge was #3738 at 20:33:37, so the fleet merged nothing for 11 h 18 min.

The measured wait had three parts: a moving head (14:33 to 20:37), a review that did not start on a stable green head (20:55 to 22:31), and an approval that the tailnet board could not complete (22:31 to 07:52). This plan fixes the first part, and its person-started hold covers the first part when a person is present. The review that did not start belongs to `a-stale-pending-review-is-asked-again`, which bounds a held review run. The passkey's `localhost` limit is issue #3750.

fleetd's merge arm, `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:481`), holds a merge for a red, stale or unsettled default branch, and `HoldReason` (`slice-pr-next.ts:162`) is an open set. No hold reads the release PR.

## Design

### Approach

- **Readiness comes from `releaseStage`.** `releaseHold(readings, record, person, now, boundMs)` reads the release readings that fleetd's release tick already passes to `releaseStage` (`packages/fleet/src/shared/release-tick.ts:143`). It holds where the stage is `ready`, or `preparing` only because the review has not passed yet: the required workflow reads green on the head (`requiredChecks`) and `plot/review` on the head is absent, `pending` or `success`. Every other stage (`waiting-scope`, `release-head-foreign`, `merged`, `publishing`, `released`, `failed`) holds nothing.
- **The hold starts at green CI.** The first pass that sees the required workflow green on a head starts that head's hold, and that time is the head's `since`.
- **The automatic hold has one budget per release PR.** The record sums the time held over every head of one release PR as `spentMs`. Once `spentMs` reaches `boundMs` (`Checks wait`, 3600 s here), no automatic hold starts for that PR again; only a person-started hold holds. An unattended night therefore costs at most one `Checks wait` of held merges per release PR.
- **One domain rule advances the record.** `advanceReleaseHold(record, reading, now, boundMs)` answers the next record: no record, the same head, a new head, an expired budget, and a closed or merged release PR. fleetd's merge tick writes what it answers and decides nothing itself.
- **One writer per file.** fleetd is the one writer of `.plot/state/release-hold.json` (`{ pr, head, since, spentMs }`). The board's controllers are the one writer of `.plot/state/release-hold-person.json` (`{ pr, act: hold | lift, head, at, by }`), and fleetd only reads it. The record holds observations and a person's act, never a verdict; the hold is derived each pass.
- **A person starts or lifts a hold.** A person hold holds merges into main for `boundMs` from the press, across heads, until the release PR merges or closes. A lift names the head it lifts and ends both the person hold and the automatic hold for that head.
- **The merge arm holds as `release-waiting`.** `mergeArm` gains the hold for a PR whose `base` is the default branch that `holdsApply` names, after `default-branch-red`, `default-branch-stale`, `default-branch-unsettled` and `merge-in-flight`, and before `conflicting` and the merger-app holds. A PR into a `sprint/` base, the release PR itself, and the repair or revert PR the repair record names are not held.
- **`plot-ask.mjs merge` honours the hold.** `mergeAt` (`workflows/merge.ts`) refuses `release-waiting` for a PR into the default branch while `releaseHold` holds, so a master agent's merge does not move the release head either. A person's merge on the host is out of scope.
- **The direct pushes stay.** Dispatch's brief bookings and `plot-open-pr.sh`'s PR records still move the release head during a hold. Each moves it once per slice start or PR open, and the hold restarts at green CI on the new head within the same budget.
- **The board shows the hold.** *Waiting on you* lists `release #<n> holds merges until <end>`, the release row reads `holds merges since <since> · ends <end>`, and a held slice PR's Status word reads `release-waiting`. All three are domain properties.

### Open Questions

- [ ] `[question-bound-value]` Recommendation: `Checks wait` as both the per-PR budget and the person hold's length, with no new config key, until a measurement shows they need different values.
- [ ] `[question-stage-on-2026-11-26]` The release tick's scope is the active sprint (`sprintScopeRef`), and `releaseStage` answers `waiting-scope` while any sprint plan is not Delivered. Recommendation: build the replay test from the readings of 2026-11-26; if they read `waiting-scope`, the release-holds-nothing answer for that stage conflicts with the start at green CI, and the plan takes a second round before slice 2.
- [ ] `[question-direct-pushes]` Recommendation: accept the 4 non-merge pushes for now; hold dispatch bookings during a hold only if a replay shows they keep a head from reaching review.

## Slices

### Hold

- `bug/a-waiting-release-holds-merges` — `releaseHold` over `releaseStage`'s predicates with the start at green CI, `advanceReleaseHold` and the per-PR budget, the `release-waiting` hold in `mergeArm`, fleetd as the one writer of `release-hold.json`, and the hold in *Waiting on you*, on the release row and as the Status word <!-- builds: releaseHold, advanceReleaseHold, the release-waiting rule and its board texts --> <!-- tests: a replay of 2026-11-26 20:30:57–20:34:34 UTC (CI green on e150fd7c1, no review, #3738 ready) holds #3738; one test per non-ready stage holds nothing; the hold holds at since + boundMs − 1 and not at since + boundMs; spentMs summed over three heads stops the automatic hold at boundMs; advanceReleaseHold covers no record, same head, new head, spent budget, merged and closed PR; mergeArm order against each default-branch hold, merge-in-flight and conflicting; a sprint/x PR, the release PR, the repair PR and the revert PR are not held; two release rows pick the one into main; the Waiting on you row, the release row text and the Status word are unit-tested domain properties with one browser test that the row shows --> → #3746

### Person Hold

- `bug/the-board-shows-the-release-hold` — the person hold and the lift: `POST /api/release-hold` and `POST /api/release-hold-lift`, `plot-ask.mjs release-hold <sha>` and `release-hold-lift <sha>`, the controllers as the one writer of `release-hold-person.json`, the "Hold merges" and "Lift the hold" buttons shown at all times and disabled with their reason, `mergeAt`'s `release-waiting` refusal, and the gate's refusal of both HTTP calls from a shell <!-- waits: bug/a-waiting-release-holds-merges --> <!-- builds: the release-hold controllers, their board buttons and mergeAt's hold --> <!-- tests: a person hold holds for boundMs from the press across a new head; a lift names its head and a lift for another head lifts nothing; a lift for a head the record does not name refuses; fleetd's write of release-hold.json between a controller's read and write loses no lift; each button's disabled reason is a domain property; both commands refuse PLOT_UNATTENDED=1; plot-ask.mjs merge refuses release-waiting for a PR into main and merges a PR into sprint/x; the gate refuses curl POST /api/release-hold and /api/release-hold-lift -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.

2026-11-27: amended from panel round 1 (unanimous amend); see `.plot/panels/2026-11-27-a-release-holds-merges-while-it-waits/panel.md`.
