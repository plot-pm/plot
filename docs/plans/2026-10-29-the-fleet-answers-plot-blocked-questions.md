# The fleet answers PLOT-BLOCKED questions

> When an agent writes a `PLOT-BLOCKED` marker, fleetd starts an unblocker role agent that answers the question through the `continue` controller and records question, answer and author on the plan issue.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2901
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- A `PLOT-BLOCKED` question gets an answer from the fleet. fleetd starts the unblocker role, which reads the question, the branch, its PR, the plan, the brief and the recent CI runs, and answers through the `continue` controller. A question the estate does not answer gets the most reversible answer the unblocker can name. Never no answer.
- The plan issue's Plot comment lists each question, its answer and who gave it. `escalations.tsv` stays as a record and no longer gates anything.

<!-- Board impact: the fleet payload and the board's WAITING ON YOU section change, because a blocked desk with an answer in flight is no longer waiting on a person. The Plot comment on the plan issue gains an answers list. No change to the plan format, the template or the docs/plans layout. -->

## Motivation

fleetd escalates a `PLOT-BLOCKED` question and waits for a person. From 2026-10-16 to 2026-10-29 a master agent answered 99 such questions by hand. When that session ends, every blocked desk stops. The design [`DESIGN-delivery-loop.md`](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka on 2026-10-29, section *A blocked agent*) makes the fleet answer.

This plan reverses one line of the archived story `the-supervisor-delivers-the-approved-scope`: *"The supervisor escalates a question; it never answers one."* The new rule: the fleet answers and records the answer where a person looks.

## Design

### Approach

The spec's *Decided* and *Calls made* lists bind this plan. Three calls apply here:

- The unblocker always answers. Where the estate gives no answer, it gives the most reversible one it can name, for example "keep the current behaviour and say so in the PR body". It never answers "wait for a person".
- Every answer is recorded on the plan issue.
- The unblocker runs through the existing `agent-run` port as `claude -p --agent unblocker`. There is one runner, and the role name is what changes. Its definition lives in the repo's `.claude/agents/unblocker.md` (model sonnet, read-only, one answer through `continue`).

The decision follows *A Decision Reads The Index*: a domain rule reads the recorded `PLOT-BLOCKED` marker and the desk state and decides whether to start the unblocker. The agent does the judgement work, an answer. It never decides what happens next. The rule answers once per question, so a restarted fleetd does not start a second unblocker for a question that has an answer in flight.

The unblocker calls the `continue` controller under `PLOT_UNATTENDED=1`. The controller lifts its unattended refusal only for a caller that declares itself as fleetd's. That caller identity comes from #2898 (role agents). The run log comes from #2899. Both are prerequisites, and this plan builds neither.

### Open Questions

- [ ] A question that the unblocker answers with a fallback ("keep the current behaviour") may come back as a second `PLOT-BLOCKED` on the same desk. What bounds the loop? Proposal: the correction budget (2) counts answers, and a third question on one slice notifies a person and keeps going. This is a stall notification, not a stop.
- [ ] The Plot comment on a plan with no `Issue:` has nowhere to record the answer. Proposal: record in the run log only, and say so in the PR body.
- [ ] The Plot comment is edited in place today. Ninety-nine answers in one list may exceed a tracker comment's size limit. Does the list keep the last N, or does it link to the run log?

## Slices

### Role

- `feature/the-unblocker-role-answers-from-the-estate` — define the unblocker role agent and the charter of what it reads and writes <!-- builds: .claude/agents/unblocker.md, the unblocker role definition -->

### Start

- `feature/fleetd-starts-the-unblocker-on-a-marker` — a domain rule decides when a `PLOT-BLOCKED` marker starts the unblocker, and fleetd starts it through `agent-run` <!-- builds: unblockerDue, the rule that starts the unblocker once per question --> <!-- waits: feature/the-unblocker-role-answers-from-the-estate -->

### Record

- `feature/an-answer-is-recorded-on-the-plan-issue` — the Plot comment lists each question, answer and author; `escalations.tsv` becomes a record only <!-- builds: the answers list in the plan issue's Plot comment --> <!-- waits: feature/fleetd-starts-the-unblocker-on-a-marker -->

## Notes

- Needs #2898 and #2899. Both are open on 2026-10-29.
- Created from issue #2901 by `/plot-idea`, unattended. Review and Impl answers follow the repo's `Plan PRs: required` and the multi-slice shape. No design answer was given, so the plan starts in Draft.
- Deliverable search for `unblocker` found nothing in the estate.
- Definition of Done: docs/definition-of-done.md
