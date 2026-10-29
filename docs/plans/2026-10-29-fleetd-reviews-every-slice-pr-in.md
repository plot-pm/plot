# fleetd reviews every slice PR in the sprint

> fleetd starts the reviewer on every green slice PR of the sprint's frozen scope, and `plot-review` stops opening a ticket for MEDIUM and LOW findings.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2900
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd starts the reviewer role on every open slice PR of the active sprint whose CI is green and which has no review on its head.
- `plot-review` puts MEDIUM and LOW findings into one PR comment and opens no follow-up issue for them. The 22 findings issues open on 2026-10-29 stay open.

<!-- Board impact: none for the plan format. The scope reader reads the sprint file, which the board already parses. -->

## Motivation

No slice PR merges without a `plot/review` status (ruleset since 2026-10-15), and only a master agent runs `plot-review` today. In the session of 2026-10-16 to 2026-10-29 the master agent ran every review from a watcher script. When that session ends, no PR gets a review and delivery stops. [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka, 2026-10-29) assigns this to fleetd as a domain rule that starts a named role agent. Sections: *The scope*, *The loop*, *Tickets*.

This plan needs #2898 and #2899 to merge first.

## Design

### Approach

The spec's *Decided* and *Calls made* lists bind this plan.

- **`rules/slice-pr-next.ts`** reads the PR index row, the review record and the default-branch reading, and answers exactly one next step. This plan adds the review arm: CI green and no review on this head → start the reviewer role on this head. The other rows of the spec's table belong to later plans.
- **The scope reader** returns the active sprint's plans, frozen when the sprint starts. A plan approved during the run is dispatched as today and does not join the scope.
- **`review.ts:58-66`** stops opening a follow-up issue for MEDIUM and LOW findings. They go into one PR comment. The 22 open findings issues stay open.
- The reviewer starts through the existing `agent-run` port and `agentRunCommand`, with its charter `.plot/charters/reviewer.json`. The layering rule holds: the tick calls the domain rule, and the agent start is an adapter call.
- The decision reads the index (*A Decision Reads The Index*): the rule takes a `MERGED`-free open row and the review record's head SHA, so a new push makes the old review irrelevant.

### Open Questions

- [ ] Where the scope reader takes its freeze point: the sprint file's `State:` transition record, or a state file written at sprint start.
- [ ] Whether the review comment for MEDIUM and LOW findings edits one marked comment in place per head, or adds one comment per head.

## Slices

### Rule

- `feature/fleetd-reviews-slice-pr-next` — add `rules/slice-pr-next.ts` with the review arm, and wire fleetd's tick to start the reviewer on its answer <!-- builds: slicePrNext, the one-next-step rule for a slice PR -->

### Scope

- `feature/fleetd-reviews-sprint-scope` — add the scope reader for the active sprint's plans, frozen at sprint start, and restrict the tick to that scope <!-- builds: the sprint scope reader -->

### Tickets

- `feature/fleetd-reviews-findings-comment` — `plot-review` writes MEDIUM and LOW findings into one PR comment and opens no issue for them <!-- builds: the MEDIUM/LOW findings PR comment -->

## Notes

- Raised from tracker issue #2900. The plan's `Issue:` field is the only link; nothing was written to the tracker.
- Needs #2898 and #2899.
- Created unattended: `Review: pr` and `Impl: own branches` follow from `Plan PRs: required` and three independently reviewable slices; design question defaulted to Draft.
