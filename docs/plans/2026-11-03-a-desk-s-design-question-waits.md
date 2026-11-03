# A desk's design question waits for a person

> A desk's `PLOT-BLOCKED` design question reaches a decision without a person: the unblocker answers it from the plan and the code, or records why it cannot. A check before approval catches a brief whose claims the code refutes.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3064
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches

## Changelog

- A desk's design question is answered by the unblocker or escalated with a recorded reason, and a plan whose brief contradicts the code it changes is flagged before approval.

<!-- Board impact: none expected for the plan format; a recorded escalation reason may add a field to the answer record (`.plot/state/answers.tsv`) that the board reads. -->

## Motivation

On 2026-11-03 the desk on `feature/the-scan-script-is-a-launcher` (PR #3048) wrote `PLOT-BLOCKED` with a design question: close the domain walk's gaps in this slice, or keep the shell arm until a follow-up slice. Its brief said the callers' tests "do not move", and the code made that claim false. No agent answered the question. A person sent a fix agent, which did the work in three pushes.

The unblocker (#2901) answers `PLOT-BLOCKED` questions, but it did not answer this one: a choice between two scopes of the slice, with tests on both sides. Two gaps follow:

1. The unblocker has no stated rule for which questions it answers alone and which it escalates. A question of this class produced neither an answer nor a recorded reason.
2. Nothing before approval compares a brief's claims with the code. The contradiction surfaced only when a desk hit it.

## Design

### Approach

Two parts, one slice each.

**Part 1: the unblocker decides or records.** Every unblocker run on a `PLOT-BLOCKED` question ends in exactly one of two recorded outcomes: an answer applied through `continueOnDesk`, or an escalation that names the reason and the recipient. A run that produces neither is a defect, not a third outcome. The class rule sits in the `unblocker` charter and in `unblockerDue` / `applyUnblockDecisions` (`packages/fleet/src/server/entry/registryd.ts`), and the domain rule stays in `packages/domain/src/rules/unblocker-due.ts`.

**Part 2: a brief check before approval.** A check reads the brief's testable claims (for example "the callers' tests do not move") and compares them with the code the slice touches. A refuted claim blocks `/plot-approve` with the claim and the evidence named. The check is a gate with an objective condition, per *Gates Over Rules*, and the domain owns the comparison (Layering Rule).

### Open Questions

- [ ] Which design questions does the unblocker answer alone? Candidate line: it answers when the plan or the code decides between the options, and escalates when the options differ in scope or cost and the plan is silent.
- [ ] Whom does an escalation reach: the plan's approver, the person named in `People`, or the board's *Waiting on you* list? What does the record store (reason, recipient, `askedAt` key)?
- [ ] What counts as a testable brief claim, and how does the check extract it from prose? Candidate: claims about tests, files or callers that a grep or a test run can refute; other prose is out of scope.
- [ ] Does the check run at `/plot-approve`, at brief writing (`plot-brief-book`), or at both? A brief is written after approval today, so a check at approval sees the plan, not the brief.
- [ ] Is a scope-choice question (this slice or a follow-up slice) better prevented by `/plot-reslice` than answered by the unblocker?

## Slices

### Unblocker

- `feature/the-unblocker-answers-or-escalates` — every unblocker run records an answer or a named escalation <!-- builds: unblocker escalation record -->

### Brief check

- `feature/a-brief-claim-is-checked-before-approval` — `/plot-approve` refuses a plan whose brief claims the code refutes <!-- builds: brief claim check -->

## Notes

- Source: issue #3064, refs #2901 and #3048.
