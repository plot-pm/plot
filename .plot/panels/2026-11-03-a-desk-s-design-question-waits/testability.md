# Testability juror: a desk's design question waits for a person

Position: amend

## Summary

The plan has no test plan. It names no test, no fixture and no failing-before assertion for either slice, and its five Open Questions leave the classification rule, the escalation record and the brief-claim extraction undecided. More important: the evidence on this machine says the unblocker never ran on #3048 at all, because no production caller passes `options.unblock` to the tick or calls `applyUnblockDecisions`. A class rule added to `unblockerDue` would pass its unit tests and still change nothing for the #3048 case. The plan must first prove which arm failed, and its tests must reach the production wiring, not only the rule.

## Findings

### F1. The unblocker is not wired in production (the #3048 root cause is not a missing class rule)

- `packages/fleet/src/server/entry/registryd.ts:313` declares `unblock?: UnblockWorld` and `:388-394` adds the unblock writes only when `options.unblock !== undefined`.
- `git grep -n "options.unblock\|unblock:" origin/main -- packages/fleet/src` finds only `registryd.ts:313,389,393`. `registryd-main.ts` names `unblock` zero times. No production code passes the option.
- `applyUnblockDecisions` (`registryd.ts:1575`) has no caller outside its own file and `packages/fleet/test/unit/registryd-tick.test.ts:1559-1620`.
- `.plot/state/answers.tsv` does not exist on this machine. `grep unblock` over `.plot/logs/registryd.*` and `fleetd.*` returns zero lines, so `unblockLines` (`registryd.ts:1632`) never wrote one.
- The #3048 marker reached `.plot/state/refusals.tsv:16` (2026-11-03T09:21:39Z), which `plot-reap` writes on `copy-then-reap`. The desk was reaped with its question; no unblocker row exists for it.
- Plan #2901 (`docs/plans/2026-10-29-the-fleet-answers-plot-blocked-questions.md`) reads `State: Released`. Its tests inject `unblock` into the tick (`registryd-tick.test.ts:1473-1546`), so every test passes while production never runs the pass. This is the exact test gap this plan repeats if its tests stay at `unblockerDue`.

Consequence for the plan's Motivation (line 24): "The unblocker (#2901) answers `PLOT-BLOCKED` questions, but it did not answer this one" is not proved. The record shows no unblocker run on any question. The plan attributes the miss to the question's class; the code shows a missing wire. Slice 1 as written does not fix #3048.

Caveat: `registryd.log` was last written 2026-10-10, so the fleet may log elsewhere now. The `answers.tsv` absence and the zero production callers do not depend on the log.

### F2. The classification is not yet a domain property, and the plan does not say it will be one

- The Approach (line 35) puts "the class rule" in "the `unblocker` charter and in `unblockerDue` / `applyUnblockDecisions`". A charter is prose read by a model; a test cannot assert it without an agent.
- `unblockerDue` (`packages/domain/src/rules/unblocker-due.ts:63`) decides only whether to START a run. It reads no question text, so it cannot classify a question. `applyUnblockDecisions` takes the run's free text and hands it to `continueOnDesk` (`registryd.ts:1586-1603`); no outcome `escalated` exists in `UnblockApplied.outcome` (`registryd.ts:1506`).
- So "answer or escalate" today is a model's choice inside the run, untestable without an agent. To be testable, the run must return a structured result (for example `{ kind: 'answer', text } | { kind: 'escalate', reason, recipient }`), and a domain rule must map that result, plus the run's failure modes, to exactly one recorded outcome. That mapping is testable with no agent; the model's choice is not, and the plan should say so.
- Open Question 1 ("answers when the plan or the code decides between the options") is a judgement a model makes. It cannot be a pure function of readings. The plan must state that the domain property is "every run ends in exactly one recorded outcome", not "this question is of class X".

### F3. "A run that produces neither is a defect" has no test and no named refusal

- Today `run-failed` records nothing and retries on the next tick (`registryd.ts:1561-1563`); `refused` from `continueOnDesk` writes no outcome row beyond `started` (the `started` row is written inside `beforeStart`, so a refused continue after the row exists leaves `started` as the last outcome). `threw` records nothing.
- The plan must list each of these paths and the outcome each records. A test per path must assert the `answers.tsv` row (or the escalation row) and fail on main, where the path records nothing or only `started`.

### F4. Slice 2 has no testable contract

- Open Question 4 states that a brief is written after approval, so "`/plot-approve` refuses a plan whose brief claims the code refutes" (line 55) has no brief to read at approval time. The slice title is untestable until this is decided.
- "What counts as a testable brief claim, and how does the check extract it from prose" (line 43) is undecided. Extraction from prose by a model is not a gate with an objective condition; extraction by pattern needs a named grammar.
- The #3048 claim, "the callers' tests do not move", is refutable only by running the callers' tests against the changed code. That needs the change. Before approval the change does not exist. The plan must say what evidence the check reads before the change exists (for example: a named test file that asserts the code path the slice deletes, found by grep over `PLOT_SCAN_WALK=shell`), and that is a narrower claim than the slice title.

### F5. No test reproduces #3048

The plan names no fixture built from the #3048 marker text (preserved at `.plot/state/refusals.tsv:16`) and no assertion that it now ends in an answer or a recorded escalation. Without it, a reader cannot verify the fix.

## Amendments required

1. Add a slice, ordered first, that wires the unblock pass into production: `registryd-main` passes an `UnblockWorld` to the tick and calls `applyUnblockDecisions` with real ports. Its test asserts that the production options builder (whatever `registryd-main` exports to assemble tick options) returns a defined `unblock` and that the applier is invoked for an `unblock` write. That test fails on main today. If the author shows the wire exists somewhere I did not find, replace this with a sentence naming the file and line.
2. Correct Motivation line 24 to state what the record shows: no unblocker run, no `answers.tsv`, the desk reaped with its marker copied to `refusals.tsv`.
3. Add a `## Tests` (or per-slice test list) that names, for slice 1: (a) a domain rule, for example `unblockOutcome(runResult)`, in `packages/domain/src/rules/`, with one vitest case per input (answer, escalate with reason and recipient, run failed, continue refused, threw), each asserting exactly one recorded outcome; (b) an `applyUnblockDecisions` test per path asserting the record row, each failing on main; (c) a fixture built from the #3048 marker text that drives the tick plus applier with a stub run returning `escalate` and asserts the escalation row and its notification.
4. State in the plan that the choice between answer and escalate is the model's and is not unit-tested; only the structured result's mapping is. Name the result schema (a zod schema in the domain, so a malformed run answer is a named refusal, for example `unparseable-answer`, not a silent `continue` with garbage).
5. For slice 2, decide Open Question 4 before approval. If the check runs at brief writing (`plot-brief-book`), retitle the slice; if at approval, say what it reads. Name the claim grammar the check accepts and one test per claim kind, including the #3048 claim with a fixture repo where a test file asserts the deleted path, so the test fails on main.
6. Decide Open Question 5. If `/plot-reslice` is the better answer, slice 2 changes shape, and its tests with it.

## Decisions that need a person

- Whom an escalation reaches (Open Question 2). The recipient is a product decision, not an agent's.
- Whether slice 2 is in scope at all for the sprint goal, given that slice 1's wire alone may have answered #3048.
- Whether #2901's Released state stands while its applier has no production caller. That is outside this plan, and it needs an issue.

## What I ran versus what I read

Ran (read-only): `gh issue view 3064`, `gh issue view 2901`; `git grep` over `origin/main` for `applyUnblockDecisions`, `unblockWrites`, `options.unblock`, `unblock:`, `answers.tsv`, `refusals.tsv`, `unblocker`; `git show` of `unblocker-due.ts`, `registryd.ts:370-400, 515-560, 1505-1660`, `registryd-main.ts:1065-1100`, the #2901 plan, the plan template; `ls .plot/state`; `grep` over `.plot/logs/*` and `.plot/state/{escalations,refusals}.tsv`.

Read only: `packages/fleet/test/unit/registryd-tick.test.ts` (grep of its unblock cases). I ran no test suite, no fleet or board command, and no host write.
