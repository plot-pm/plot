# The release waits for one approval

> When every plan in the sprint is Delivered, fleetd prepares the release PR and a person approves it with one action.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2907
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- When every plan of the active sprint is Delivered, fleetd approves the release PR's `action_required` CI run, waits for green, runs the reviewer on it and notifies the person. One approval action (`plot-ask.mjs release-approve <pr>` or a board button) merges the release PR, waits for the publish workflow, records the release in the sprint's plans and closes the sprint.

Board impact: adds a board button and a release-ready row; the release endpoint and the *The release* section read the new state.

## Motivation

The delivery loop in [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka, 2026-10-29) removes every stop except one: the release. Today a person or a master agent finds the release PR, approves its CI run, runs the review, merges, waits for publish, sweeps the plans to Released and closes the sprint by hand. The spec keeps one stop and makes it one action.

## Design

### Approach

The spec's *The release* section binds this plan. Its *Decided* and *Calls made* lists bind it too, in particular: `release` stays refused for every unattended caller, and fleetd may approve the release PR's `action_required` CI run and run the reviewer before asking the person.

1. **Prepare (fleetd).** A domain rule reads the sprint's plans and the PR index. When every plan in the frozen scope is Delivered, it selects the changesets release PR and answers one next step: approve the CI run, wait for green, run the reviewer on the head, notify. The rule reads recorded state and spawns nothing; the adapter calls the host.
2. **Notify.** One message: "Release X.Y.Z is ready: N plans, PR #n, green, reviewed." It is sent once per head of the release PR.
3. **Approve (one action).** `plot-ask.mjs release-approve <pr>` and a board button call one controller. It re-asks the host, refuses unless the PR is the prepared release PR with a green, reviewed head, and merges pinned to that head. No other route reaches `release`.
4. **Finish.** After the merge the controller waits for the publish workflow, runs the `/api/release` sweep over the sprint's Delivered plans, and closes the sprint through `plot-sprint-state.sh`.

The controller follows the layering rule: controller → domain → port ← adapter. New behaviour goes into TypeScript, not into `plot-*.sh`, because of the shell line ratchet.

### Open Questions

- [ ] What state records "prepared" (release PR, head SHA, review, notification sent) so the approval can be refused on a moved head? The spec leaves state file shapes to the builder.
- [ ] How long does the controller wait for the publish workflow, and what does it report when the workflow fails after the merge?
- [ ] Does the sweep run in the same controller call as the merge, or as a separate step the fleet resumes after a restart?
- [ ] How does the board show a release that is ready, merged, publishing and swept?

### Dependencies

Needs #2900 and #2902 (named in the issue). The plan does not restate them: confirm what each delivers before approving this plan.

## Slices

### Prepare

- `feature/the-release-is-prepared` — the rule and adapter calls that find the release PR, approve its CI run, wait for green, run the reviewer and notify the person <!-- builds: releasePrepare, a domain rule selecting the release step -->

### Approve

- `feature/the-release-approve-action` — `plot-ask.mjs release-approve <pr>` and the board button, merging pinned to the head and refusing by name <!-- builds: release-approve, the one action that reaches release --> <!-- waits: feature/the-release-is-prepared -->

### Finish

- `feature/the-release-is-swept-and-closed` — wait for the publish workflow, run the release sweep over the sprint's Delivered plans and close the sprint through `plot-sprint-state.sh` <!-- waits: feature/the-release-approve-action -->

## Notes

- Created from tracker issue #2907. The plan's `Issue:` field is the only link; nothing was written to the tracker.
- Overlap check: `done-holds-the-release-scope` and `the-release-pr-is-checked-before-it-merges` share title words; both are Released and answer other questions.
- Deliverable search for `release-approve` found no existing artifact.
