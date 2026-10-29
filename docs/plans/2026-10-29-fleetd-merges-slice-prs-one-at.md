# fleetd merges slice PRs one at a time

> fleetd merges a slice PR whose review on the current head has no HIGH finding, one merge at a time, and holds while the default branch is red, stale or unsettled.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2902
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- fleetd merges a slice PR of the scope when the review on its head has no HIGH finding. It merges one PR at a time and waits for the default branch's CI to settle between merges.

<!-- Board impact: none. The plan format, the template and docs/plans are unchanged. The board may later show the loop's steps; the design leaves that to the builder. -->

## Motivation

fleetd merges nothing today. A master agent runs `plot-ask.mjs merge` for every slice PR, so delivery stops when that session ends. [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka on 2026-10-29) moves the merge into fleetd's tick as a domain rule.

Two PRs that are green on an old base can be red together on the new one. The design's anti-goal is a default branch that goes red and stays red, and one merge in flight is its main guard.

## Design

### Approach

The design's sections *The loop* and *One merge in flight* bind this plan, with its Decided and Calls-made lists. The plan builds the merge arm only. The reviewer, fixer and unblocker arms belong to other plans of the story.

The merge arm of `rules/slice-pr-next.ts` answers one next step per open slice PR of the scope. This plan implements the rows that end in a merge or a hold:

| Reading | Next step |
|---|---|
| Review on this head has no HIGH | merge, pinned to the head |
| Default branch red or stale | hold (today's `default-branch-red`) |
| A merge is in flight and the default branch has not settled since | hold |

- **The index selects, the controller re-asks.** The rule reads the PR index row, the review record and the default-branch reading. The merge goes through `workflows/merge.ts`, which re-asks the host and merges pinned to the head. A head that moved refuses as `head-moved` and ends that action.
- **The review record** is the `plot/review` commit status and the findings the reviewer writes. The rule reads the status's head SHA, so a new push makes an old review irrelevant.
- **One merge in flight.** After any merge into the default branch, by the fleet or by a person, the next fleet merge waits until the default branch's CI settles on the new head. The mark is derived from the default branch's head and its settled reading (`rules/default-branch.ts`). fleetd stores no mark.
- **A red or stale default branch holds the merge.** `default-branch-red` already does this, and a reading older than `Checks wait` counts as stale, as `plot-ask.mjs merge` already refuses.
- **The layering rule holds.** The rule is a synchronous function of readings. The tick is its only caller, and the merge reaches the host through the existing controller and port. No new `spawn` site appears outside `adapters/`.
- **The merge controller has no unattended caller today.** The design lifts the unattended refusal only for fleetd's declared caller identity. This plan depends on #2900 for that identity and does not lift the refusal itself.

### Open Questions

- [ ] Which reading of #2900 does this plan wait on: the caller identity alone, or the review record too?
- [ ] Does "settled" for the in-flight mark use the same `Default branch checks` list as `default-branch-red`? The plan assumes it does.
- [ ] Where does the tick read a merge by a person from: the PR index's newest MERGED row, or the default branch's head? The design says the head.

## Slices

### The rule

- `feature/slice-pr-next-merge-arm` — the merge and hold arms of `rules/slice-pr-next.ts`, with unit tests for each row and for the in-flight mark <!-- builds: slicePrNext, the merge and hold arms of the slice-PR next-step rule -->

### The tick

- `feature/fleetd-merges-one-at-a-time` — fleetd's tick calls the rule for each open slice PR of the scope and merges through `workflows/merge.ts`, pinned to the head <!-- waits: feature/slice-pr-next-merge-arm -->

## Notes

- Needs #2900, named by the issue. No plan for #2900 exists on `main` at 2026-10-29.
- Issue: https://github.com/plot-pm/plot/issues/2902. The plan writes nothing to the tracker.
