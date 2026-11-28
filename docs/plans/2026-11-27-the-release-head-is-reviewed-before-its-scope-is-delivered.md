# The release head is reviewed before its scope is delivered

> fleetd reviews a green release head while the sprint's scope is still unfinished, so the release PR carries a `plot/review` whenever a person may approve it, and `waiting-scope` holds only the notification.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Issue:** #3752
- **Approved:** 2026-11-27, jwloka, plan-PR #3753 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/the-release-head-is-reviewed-while-its-scope-waits`
- **Delivered:** 2026-11-27

## Changelog

- fleetd starts the review of a release PR whose required checks are green even while the active sprint holds a plan that is not Delivered. Until the scope is Delivered, it still sends no release notification.

<!-- Board impact: the release row reads `waiting-scope` as before; its review status now fills in while it waits. -->

## Motivation

`releasePrepareNext` (`packages/domain/src/rules/release-prepare.ts:260`) returns `{ step: 'hold', reason: 'waiting-scope' }` at line 266 whenever `releaseStage` answers `waiting-scope` (`:228-229`): the scope is unread, or one of its plans is not Delivered. The review branch (`:271-295`) runs only in the `preparing` stage. The slice-PR review arm leaves release heads out (`release-pr`, `packages/domain/src/rules/fleet-scope.ts:133`). So no pass reviews a release PR while its sprint is unfinished.

On 2026-11-26 the active sprint `plot-describes-itself` held five undelivered Must Haves. Release PR #3719 at `8e1373e0f` read `validate` success from 20:55:50 UTC, fleetd ran until 22:31:26 UTC (`.plot/state/fleet-stopped.json`), and no review started. Both reviews of #3719 that evening were run by hand (`e150fd7c1` pending at 20:34:34, `8e1373e0f` pending at 22:31:41). `.plot/logs/fleetd.log` holds 18581 lines `plot-fleetd: release waiting-scope: hold` against 21 lines `plot-fleetd: release preparing: review`.

A person may approve and publish a release in `waiting-scope`: 2.37.0 merged at 07:52 UTC on 2026-11-27 as `a55df0f41` while the five Musts were still in that sprint. The approval needs `plot/review` on the head, so the missing review was the part that waited for a person.

## Design

### Approach

- **The review step reads the head, not the scope.** In `releasePrepareNext`, a `waiting-scope` stage with a read scope and read phases runs the same review checks as `preparing`: the head's changes are clean, the required checks are green, the review writer is trusted, no live run holds the head, the review is absent, failed, on another head or a stale pending, and `reviewStartAllowed` admits the start. It answers `review` where they pass.
- **`waiting-scope` keeps everything else.** Where the review checks do not start a review, the step stays `{ step: 'hold', reason: 'waiting-scope' }`, and the notification never runs before the scope is Delivered. `releaseStage` does not change, so the board row and the approval button read the same stage as before.
- **An unread scope still holds.** Where the scope is unread or the phases are `unaskable`, the step stays `hold` with its present reason and no review starts.
- **The rule stays one rule.** Extract the `preparing` review checks into one function both stages call, so the two stages cannot drift.

### Open Questions

- [ ] `[question-review-budget]` Does a release reviewed in `waiting-scope` spend the same `reviewStartAllowed` budget per head? Recommended: yes; the budget bounds runs per head whatever the stage.
- [ ] `[question-notify-early]` Should the notification also go out in `waiting-scope` once the head is reviewed? Recommended: no in this plan. The notification names the scope's changesets, and an unfinished scope would name a partial set.

## Slices

### Review

- `bug/the-release-head-is-reviewed-while-its-scope-waits` — `releasePrepareNext` answers `review` for a green, unreviewed release head in `waiting-scope`, through one review-check function shared with `preparing` <!-- builds: the shared release review check --> <!-- tests: releasePrepareNext — waiting-scope with a green unreviewed head answers review; a reviewed head answers hold waiting-scope; red or pending checks answer hold waiting-scope; an unread scope answers hold unaskable; a foreign head answers hold release-head-foreign; waiting-scope never answers notify; the 2026-11-26 readings of #3719 at 8e1373e0f answer review --> → #3754

## Notes

Created on 2026-11-27 from issue #3752, for the sprint fleet-runs-safely-alone. Plan `a-release-holds-merges-while-it-waits` reads readiness from `releaseStage` (`[question-stage-on-2026-11-26]`) and takes its second round after this plan.
