# A red default branch is repaired or reverted

> When the default branch turns red, fleetd starts a main-repair agent that fixes forward through a PR, and reverts the merge that broke main if main is still red after a configured bound.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2904
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- fleetd repairs a red default branch: it starts a main-repair agent on the failing run, and opens and merges a revert PR when main is still red after `Main repair bound`.

Board impact: a new `## Plot Config` key and a new reading of the default-branch state; the board shows the repair and the revert as steps of the run log. Plan format and helper scripts are unchanged.

## Motivation

`default-branch-red` holds the merge queue and does nothing else (`DESIGN-delivery-loop.md`, *What exists today*: "Repair a red main — none"). Main stays red until a person acts. The story's anti-goal is exactly this: a run that delivers every plan but leaves the default branch red has failed.

Measured state today: `packages/fleet/src/shared/default-branch-refresh.ts` already records the settled reading and the failing runs (`failingRuns`) in `.plot/state/default-branch.json`, and `registryd-main.ts:2863` maps `default-branch-red` to the `queue` hold. The inputs to a repair exist; no caller acts on them.

## Design

### Approach

Binding source: [DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), section *A red main*, and its *Decided* and *Calls made* lists (approved by jwloka, 2026-10-29). The plan follows the layering rule: the decision is a domain rule that reads recorded state, and an agent start or a PR open is an adapter call.

1. **The rule.** A domain rule reads the default-branch reading (`red`, `askedAt`, failing runs, the merge that turned it red) and the repair record, and answers one of `hold`, `start-repair`, `await-repair`, `revert`, `none`. It spawns nothing and awaits nothing, like the other rules that take readings as values.
2. **Fix forward.** On `start-repair`, fleetd starts the `main-repair` role in its own worktree on the default branch, with the failing run and the merge that turned main red. The role writes a fix PR or nothing, and never pushes to main directly. The PR goes through the same loop as a slice PR and jumps the merge queue. The role runs through the existing `agent-run` port; its definition is `.claude/agents/main-repair.md` (opus, `worktree` isolation, the fixer's hard rules).
3. **Revert.** When main is still red after `Main repair bound` (proposed 60 minutes, a `## Plot Config` key), fleetd opens a revert PR of the merge that turned main red and merges it when its CI is green. The merge goes through `workflows/merge.ts`, which re-asks the host and pins the head; the `plot/review` ruleset is not bypassed.
4. **The reverted work comes back.** The plan gets a new slice heading with its own branch. `plot-host` reads the old PR as merged and that answer is never overridden. A Delivered plan stays Delivered, and the revert gets a ticket naming the plan (`ai-generated`, assigned to the plan's author, linked from the plan's issue comment). No lifecycle step runs backwards.
5. **One repair at a time.** The repair record (a state file, shape left to the builder) holds the attempt, its start time and the PR. A second red reading while a repair is in flight starts nothing new.

Anti-goal check: the rule's bound is measured from the first red reading that settled, so a main that stays red is reverted within `Main repair bound` plus one merge round.

### Open Questions

- [ ] Dependencies named by the issue: #2902 (one merge in flight) must deliver first, because a revert is a merge into main and counts against that mark. Does this plan need a `waits:` annotation on slice 2 and 3, or only the issue link?
- [ ] The `main-repair` definition belongs to the role-agents work in the same story. Does this plan add `.claude/agents/main-repair.md` itself, or wait for the plan that creates the directory?
- [ ] Which merge "turned main red" when several merged between two readings? Proposal: the earliest merge whose head commit is at or after the last green reading.
- [ ] Does a revert PR that conflicts (a later merge touched the same lines) stop at a notification, or does the repair agent resolve it?
- [ ] The red reading is a verdict (`default-branch.json`); the rule must treat a reading older than `Checks wait` as no reading, as `defaultBranchRed` does today.

## Slices

### Rule

- `feature/a-red-default-branch-is-repaired-rule` — the domain rule that chooses hold, start-repair, await-repair or revert from the default-branch reading and the repair record; the `Main repair bound` config key <!-- builds: redMainStep, a domain rule over the default-branch reading -->

### Repair

- `feature/a-red-default-branch-is-repaired-fix-forward` — fleetd starts main-repair in its own worktree on a red reading; the fix PR jumps the queue <!-- builds: main-repair start, an adapter call through agent-run -->

### Revert

- `feature/a-red-default-branch-is-repaired-revert` — revert PR of the breaking merge, merged on green; new slice heading on the plan; a ticket naming the plan when it is Delivered <!-- builds: revert PR step, a fleetd action over the merge controller -->

## Notes

- Created from tracker issue #2904 by an unattended `/plot-idea` run on 2026-10-29. Deliverable search for "main-repair role" and "revert PR of the merge that turned main red" found no existing artifact.
- Ceremony answers (`Review: pr`, `Impl: own branches`) follow `Plan PRs: required` and a multi-slice plan; the design question was unanswered, so the plan starts in Draft.
