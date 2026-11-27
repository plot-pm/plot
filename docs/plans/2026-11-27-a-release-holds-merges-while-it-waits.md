# A release holds merges while it waits

> While the release PR's head is green and reviewed and waits for the passkey, fleetd's merge arm holds every merge into the default branch under the named hold `release-waiting`, for at most `Checks wait`, and the board shows the hold on the release row.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged

## Changelog

- A release PR that is ready to approve no longer goes stale under the fleet's merges. While it waits for the passkey, fleetd holds merges into main as `release-waiting`, and the Delivery tab's release row shows when the hold ends. The hold ends when the release merges, when a person lifts it, or after `Checks wait`.

<!-- Board impact: the release row shows the hold and a "Lift the hold" button with a new route. No change to the plan format, the template or the docs/plans layout. -->

## Motivation

Changesets rebuilds the release PR after every push to main, so each fleet merge gives the release PR a new head. On 2026-11-26 release PR #3719 got 14 new heads between 14:33 and 20:37 UTC, among them `879e6d780` (17:55), `b967bc46b` (18:30), `e150fd7c1` (20:13), `a232b0959` (20:34) and `8e1373e0f` (20:37). Each new head needs a CI run and a `plot/review` before `releaseApprovable` (`packages/domain/src/rules/release-approvable.ts:65`) enables the passkey button. On `e150fd7c1`, `validate` passed at 20:30:57, the review started at 20:34:34 and passed at 20:36:00; `a232b0959` had replaced the head at 20:34:34, so the reviewed head was already old.

The operator stopped the fleet: `.plot/state/fleet-stopped.json` reads `at: 2026-11-26T22:31:26Z`. With no merges, `8e1373e0f` kept its head; `plot/review` passed on it at 22:31:49, and #3719 merged at 07:52 UTC on 2026-11-27 as `a55df0f41`. The fleet merged nothing for 9 hours.

fleetd's merge arm, `mergeArm` (`packages/domain/src/rules/slice-pr-next.ts:481`), holds a merge for a red, stale or unsettled default branch, and `HoldReason` (`slice-pr-next.ts:162`) is an open set. No hold reads the release PR.

## Design

### Approach

- **One rule decides the hold.** A new domain rule, `releaseHold(release, record, now, boundMs)`, reads the release PR's OPEN index row and the hold record. It answers `holds` where the row's head is under `changeset-release/`, `ciChecks` reads `green` on the head, `plotReview` reads a trusted `success` on the head (the same test as `releaseApprovable`), the record names no lift for this head, and the hold for this head began less than `boundMs` ago. It answers `none` with the reason otherwise.
- **The bound is `Checks wait`.** `boundMs` is the `Checks wait` config value (3600 s in this repository), the bound fleetd already gives a default-branch reading. The hold begins at the first pass that answers `holds` for a head, and that time is the record's `since`.
- **The merge arm holds as `release-waiting`.** `mergeArm` gains the hold for a PR whose `base` is the default branch that `holdsApply` names, after the default-branch holds. A PR into a `sprint/` base is not held, because it does not move the release PR. The repair PR that the repair record names is not held, so a red main still gets its repair.
- **fleetd keeps the record, not a verdict.** fleetd writes `.plot/state/release-hold.json` (`{ head, since, liftedBy? }`) when a hold begins for a new head, and nothing more. The hold itself is derived each pass from the index row and the record.
- **Three ends.** The hold ends when the release PR merges or closes, when a person lifts it, or when `boundMs` elapses since `since`. A head that the bound has expired is not held again; a new head starts a new hold only once it is green and reviewed.
- **A person lifts the hold through a controller.** `POST /api/release-hold-lift {"head":"<sha>"}` writes `liftedBy` for that head. The controller gate refuses it from a shell with no receipt escape, and `plot-ask.mjs release-hold-lift <sha>` refuses under `PLOT_UNATTENDED=1`.
- **The board shows the hold.** The Delivery tab's release row reads `holds merges since <since> · ends <since + Checks wait>` and carries the "Lift the hold" button. A held slice PR's Status word reads `release-waiting`. Both texts are domain properties.

### Open Questions

- [ ] `[question-bound-value]` Recommendation: `Checks wait`, with no new config key; a separate key is added only when a measurement shows the two need different values.
- [ ] `[question-hold-before-review]` A hold that starts once CI is green, before the review, would keep the head stable for the review too. Recommendation: start at green CI and a review that is `pending` or `success` on the head, so the review is not raced; keep the bound from that start.
- [ ] `[question-person-merge]` A person's merge on GitHub still moves the release head. Recommendation: out of scope; the hold binds fleetd and `plot-ask.mjs merge` only.

## Slices

### Hold

- `bug/a-waiting-release-holds-merges` — `releaseHold`, the `release-waiting` hold in `mergeArm`, and fleetd's `release-hold.json` record <!-- builds: releaseHold, the release-waiting rule --> <!-- tests: a green reviewed release head holds a slice PR into main; a PR into sprint/x is not held; the named repair PR is not held; the hold ends past Checks wait, on a lift for the head, and when the release row is MERGED; an expired head is not held again -->

### Board

- `bug/the-board-shows-the-release-hold` — the release row's hold text, the "Lift the hold" button, `POST /api/release-hold-lift`, `plot-ask.mjs release-hold-lift`, and the gate's refusal of the HTTP call from a shell <!-- waits: bug/a-waiting-release-holds-merges --> <!-- builds: the release-hold lift controller and its board button --> <!-- tests: the row text names since and end from the record; the route writes liftedBy for the head; the command refuses PLOT_UNATTENDED=1; the gate refuses curl POST /api/release-hold-lift -->

## Notes

Created on 2026-11-27 for the sprint fleet-runs-safely-alone.
