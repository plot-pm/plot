# Panel: a-desk-s-design-question-waits, round 1

Plan: `docs/plans/2026-11-03-a-desk-s-design-question-waits.md` (Draft, PR #3067, issue #3064). Jurors: layering, safety, seams, testability. Moderated 2026-11-03.

## Positions

| Juror | Position |
|---|---|
| layering | amend |
| safety | amend |
| seams | amend |
| testability | amend |

Unanimous `amend`. No juror chose `proceed` or `reject`.

## Shared false premise

All four jurors found the plan's Motivation false. The plan said the unblocker (#2901) answers `PLOT-BLOCKED` questions and declined the #3048 question because of its class. On `origin/main` the unblocker never runs:

- `registryd-main.ts:2930-2950`, the one production tick call, passes no `unblock` option, and `registryd.ts:389` adds unblock writes only when that option is defined.
- `applyUnblockDecisions` (`registryd.ts:1575`) has no production caller, and no adapter implements `UnblockPorts.run`.
- The operator's `answers.tsv` holds 1501 rows, all `answered`, none `started`; fleetd's logs hold no `unblock` line.

The moderator checked each of these on `origin/main` `abedcfb49` and on this machine's state files before the amendment. A class rule added to `unblockerDue` or the charter changes code that never runs, so the amended plan makes the wiring its first slice.

## Agreements beyond the premise

- The charter (`.claude/agents/unblocker.md:35`, "Never answer 'wait for a person.'") forbids the escalation the plan asks for. Layering, safety and seams named it.
- `UnblockPorts.run` returns free text, so an escalation would reach the desk as an answer. All four asked for a typed result parsed by a domain rule.
- The escalation recipient exists: `questionEscalation`, `escalations.tsv` and the `Notify command`. Layering, safety and seams asked for an `escalated <reason>` row that the ladder reads, and no new store.
- A failed run records nothing and retries on every tick; a refused `continue` leaves `started` last, which silences the ladder. Layering, safety, seams and testability named one or both.
- `continuation.ts:1502` defaults the author to `unblocker`, so a person's answer reads as the unblocker's. Layering, safety and seams named it.
- Part 2 checks a brief at `/plot-approve`, where no brief exists yet; the claim it targets is a prediction about an unwritten diff, and extracting claims from prose is judgement, not a gate. All four.
- Side finding, all four: test runs write `plot-continue-*` temp-desk rows into the operator's real `answers.tsv` (measured by the moderator: 1465 of 1501 rows).

## Differences

- **Where the class rule lives.** Layering and testability place the answer-or-escalate judgement in the charter and say the domain can only own the mapping from a typed result to a record row; the model's choice is not unit-testable. Safety wants a mechanical bound as well: an `ANSWER` naming a path outside the scope guard or a test file is not applied and records an escalation. The amended plan adopts the charter line and the typed mapping, and lists safety's mechanical bound under Notes as a follow-up, not adopted in this round.
- **Retry bound.** Layering cites the fixer precedent (one failed start per head, then hold). Safety offers a `failed` row or a counted retry, plus a per-slice answer cap. The plan takes one run per question key (a `failed` row makes `already-recorded` hold) and a per-branch cap at `Correction budget`.
- **Duplicate answers on one key.** Only safety named the two rows on `(desk-c34ea6fb, 2026-11-01T23:57:12.513Z)` and asked `continue` to refuse a second answer. The moderator confirmed rows 1447 and 1483; the plan adopts `already-answered`.
- **Board impact.** Only seams found the plan's board-impact comment false: no board view reads `answers.tsv`; `slice-pr.ts:191-195` does, and only for `answered` rows. Layering added that the `outcome` column is already a free string, so no new column is needed.
- **Part 2's home.** Layering offers a code-claims lens on the existing panel or a brief-writer self-check. Safety and seams offer `plot-brief-book` or a dispatch hold beside `missingBriefs`. Testability asks only that the timing be decided. The person deferred Part 2; the Notes record the brief-time and dispatch-time homes.
- **#2901's Released state.** Seams and testability named it; testability asked for an issue. Listed as a follow-up.

## Ran versus read

All four ran only read-only commands: `git show` and `git grep` over `origin/main`, `gh issue view` and `gh pr view`, and `grep`/`awk` over `.plot/logs` and the state files. No juror ran a test suite, a fleet or board command, or a host write. Each juror's file separates what it ran from what it only read:

- Safety did not execute `continueOnDesk` beyond the record write, and could not tell whether the 2026-11-03 #3048 marker was answered without a record.
- Seams did not confirm whether `beforeStart` runs before the `run-limit` and `spend-limit` refusals in `continueOnDesk`.
- Testability read `registryd-tick.test.ts` by grep only, and found `registryd.log` last written 2026-10-10; its claims do not depend on that log.
- Layering read the 2026-11-01 fixer panel's seams verdict without re-running it.

The moderator re-ran the premise checks above, the duplicate-key rows, the `continuation.ts:1502` default, the charter line and the `slice-pr.ts` reader. No test ran.

## Shared blind spot

No juror asked what turning the unblocker on does on its first tick. Every waiting desk with an untagged marker and no recorded outcome becomes due at once, and each starts a Sonnet run. The per-branch cap bounds the loop on one branch, not the burst across branches on the first tick. The tick's existing `max` and the run's own limits are the only bound named today; the slice-1 brief must name what limits that burst.

No juror ran a test either, so every "fails on `origin/main`" claim in the amended test list is read from the code, not observed.

## Decisions by the person

jwloka decided on 2026-11-03:

1. An escalated question is posted on the plan's issue as a comment through the tracker port, `PLOT-BLOCKED` stays in place, and the board's *Waiting on you* row shows it. The existing ladder (`questionEscalation`, `escalations.tsv`, `Notify command`) reads an `escalated <reason>` row in `answers.tsv` like `refused`; no new store.
2. Part 2, catching a brief whose claims the code refutes, is deferred out of this plan and listed under Notes as a follow-up.

The jurors' open person-decisions that these settle: the escalation recipient (all four), whether Part 2 stays (all four), and which classes the unblocker answers alone (safety, seams), now stated in the plan's charter line with scope, test-contract and plan-silent choices always escalated.

## Outcome

The plan is amended in round 1 to three slices: `feature/fleetd-starts-the-unblocker`, `bug/an-answer-records-its-true-author`, `feature/an-escalated-question-reaches-the-issue`.
