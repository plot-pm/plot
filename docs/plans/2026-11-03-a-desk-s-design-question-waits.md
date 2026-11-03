# A desk's design question waits for a person

> fleetd starts the unblocker on a desk's `PLOT-BLOCKED` question for the first time. Every run ends in one recorded outcome: an answer applied through `continue`, or an escalation posted on the plan's issue while the marker stays. The answer record names who answered.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #3064
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3067 merged
- **Started:** 2026-11-03, Jan Wloka, `feature/fleetd-starts-the-unblocker`
- **Started:** 2026-11-04, Jan Wloka, `bug/an-answer-records-its-true-author`

## Changelog

- fleetd runs the unblocker on a desk's `PLOT-BLOCKED` question. The unblocker answers it, or escalates it with a named reason: the question is posted on the plan's issue, and the desk keeps waiting in *Waiting on you*. The answer record names the true author of every answer.

<!-- Board impact: no board view reads `.plot/state/answers.tsv` today; only the slice PR opener does (`packages/board/src/server/entry/slice-pr.ts:191-195`), and it renders `answered` rows only, so the new `escalated`, `refused` and `failed` rows do not reach a PR body. Slice 3 adds one board reading: the *Waiting on you* row of a desk with an escalated question shows the escalation reason, as a domain property. The `outcome` column is already a free string (`answer-record.ts:15`), so no column is added and the TSV shape is unchanged. -->

## Motivation

On 2026-11-03 the desk on `feature/the-scan-script-is-a-launcher` (PR #3048) wrote `PLOT-BLOCKED`: "CI fails 98 helper-contract tests, 2 e2e flows and 1 corpus test because they assert the SHELL walk, which this slice deletes — close the domain walk's gaps here, or pin those suites another way?" No agent answered. `plot-reap` copied the marker to `.plot/state/refusals.tsv` (row 16, 2026-11-03T09:21:39Z) and reaped the desk. A person sent a fix agent, which did the work in three pushes.

The unblocker did not decline this question. It never ran. Measured on `origin/main` (`abedcfb49`) on 2026-11-03:

- The one production tick call, `registryd-main.ts:2930-2950`, passes `registry`, `world`, `queue`, `fleet`, `max`, `escalation` and `idle`, and no `unblock`. `registryd.ts:389` adds unblock writes only when `options.unblock` is defined, so fleetd never decides an unblock.
- `applyUnblockDecisions` (`registryd.ts:1575`) has no production caller; `git grep` finds only its definition and two doc references. No adapter implements `UnblockPorts.run` (`registryd.ts:1524`).
- The operator's `.git/.plot/state/answers.tsv` holds 1501 rows, all `answered`, none `started`. The applier writes `started` before every start (`registryd.ts:1593-1602`), so no unblocker run ever reached a desk. fleetd's logs hold no `unblock` line.
- The rows that read `author=unblocker` came through `continue`: `continuation.ts:1502` writes `author: input.author ?? 'unblocker'`, and neither the board's continue route nor `plot-continue-command.mjs` passes an author. A person's or the master agent's answer is recorded as the unblocker's.

#2901 (`2026-10-29-the-fleet-answers-plot-blocked-questions.md`) is Released. Its tests inject `unblock` into the tick (`registryd-tick.test.ts`), so they pass while production never runs the pass.

Four further defects block a safe first start:

1. The charter forbids escalation. `.claude/agents/unblocker.md:35` says "Never answer 'wait for a person.'" and tells the agent to "still answer the question asked". An unattended agent then answers scope and test-contract choices alone.
2. The run result is free text. `UnblockPorts.run` returns `{ ok: true; answer: string }`, so any text, including "I could not determine", reaches the desk as an answer.
3. A failed run records nothing and retries on every tick (`registryd.ts:1559-1561`). A refused `continue` leaves `started` as the last row, and `questionEscalation` returns no rung while the last outcome is `started` (`question-escalation.ts:60`), so nobody is notified.
4. `continue` appends a second answer on a question key that already holds one. Rows 1447 and 1483 of `answers.tsv` share the key `(desk-c34ea6fb, 2026-11-01T23:57:12.513Z)`.

## Design

### Approach

**The unblocker runs in production.** fleetd's tick receives an `UnblockWorld`, and fleetd calls `applyUnblockDecisions` on the tick's `unblock` writes with real ports. `UnblockPorts.run` starts the `unblocker` role agent through `roleCommand` (`packages/domain/src/rules/role-command.ts:62`), the same role start the other role agents use; `start` is `continueOnDesk`; `record` is `AnswerRecordStore.append`. The role gate (`rules/role-gate.ts`) still applies.

**A run hands back a typed result.** The first line of the run's output is `ANSWER` or `ESCALATE: <reason>`. For `ANSWER`, the remaining lines are the answer text. A pure domain rule, `unblockOutcome` in `packages/domain/src/rules/unblock-outcome.ts`, parses the output against a zod schema into exactly one of `answer`, `escalate` or a refusal. Output whose first line is neither form, an `ANSWER` with no text, and an `ESCALATE:` with no reason are the refusal `unparseable-run`. The adapter reads the output; the domain owns the schema and the mapping.

**Every run ends in exactly one recorded outcome** in `answers.tsv`, written through `AnswerRecordStore.append`. The `outcome` column is already a free string:

| Path | Row written | `continue` called |
|---|---|---|
| `ANSWER` and `continue` started | `started` (before the start, as today) | yes |
| `ESCALATE: <reason>` | `escalated <reason>` | no |
| `unparseable-run` | `refused unparseable-run` | no |
| `continue` refused | `refused <reason>`, after `started` | yes, refused |
| run failed, spawn failed, or threw | `failed <detail>` | no, or failed |

So `started` is never the last row of a finished apply. `questionEscalation` reads `escalated`, `refused` and `failed` like any outcome other than `started`: it falls through to the age rungs (`listed`, then `notified-N` through the `Notify command`, recorded in `.plot/state/escalations.tsv`). No new store and no new recipient field.

**Retries are bounded.** `unblockerDue` already refuses `already-recorded` for any row on the question key (`unblocker-due.ts:68`). Because a failed run now records `failed`, the unblocker makes one attempt per question key, and the ladder takes the question after that. A desk that blocks again writes a new `askedAt`, which is a new key; the per-branch cap bounds that loop: `unblockerDue` refuses `answer-cap` once the branch holds `Correction budget` rows with outcome `started` (2 in this repository), and the applier records `escalated answer-cap` for that question.

**The charter states the class line.** `.claude/agents/unblocker.md` drops "Never answer 'wait for a person'" and "still answer the question asked", and requires the `ANSWER` / `ESCALATE: <reason>` first line. The unblocker answers alone when the plan, the brief or the code decides the question: which file or existing helper holds a behaviour, what a named test asserts, how to read a refusal, which of two reversible approaches the brief already prefers. It always escalates:

- a choice that adds a slice, or that names a file outside the brief's `### Scope guard` list; a brief with no scope guard escalates every scope choice (reason `scope`)
- anything that weakens, skips or deletes a test, or changes what a test asserts (reason `test`)
- a choice between options that differ in scope or cost where the plan is silent, or a question the plan lists under Open Questions (reason `plan`)
- anything a hard rule forbids (reason `rule`)

The charter adds "never widen the scope guard" and "never tell the desk to weaken, skip or delete a test" to its hard rules. The choice between answer and escalate is the model's and is not unit-tested; the tests cover the mapping from a typed result to one recorded outcome. The #3048 question is a `scope` and `test` escalation under this line. A person who receives it may answer it, or run `/plot-reslice` to add the slice.

**An escalation reaches the plan's issue.** For an `escalated <reason>` row, fleetd posts one comment on the issue named by the plan's `Issue:` line through `Tracker.issueComment` (`ports/tracker.ts:481`). The comment holds the question, the reason and the branch, and passes a marker keyed on the desk and `askedAt`, so a repeated post edits the comment rather than adding a second one. `PLOT-BLOCKED` stays on the desk. The board's *Waiting on you* row for that desk shows the reason. A plan with no `Issue:` line, or a tracker that answers `unaskable` or `failed`, posts nothing and logs one line naming why; the ladder still notifies.

**The record names the true author.** `continuation.ts:1502` no longer defaults to `'unblocker'`. The applier passes `unblocker`. The board's continue route passes the `author` its request names, and `plot-continue-command.mjs` takes `--who <handle>`. A call that names no author records `unknown`. `continueOnDesk` refuses `already-answered` when the question key already holds an `answered` or `started` row.

### Open Questions

- [x] What bounds the first tick after slice 1 merges? Decided 2026-11-03: at most one unblocker run is in flight across the fleet. A tick starts a run only when no `started` row is open, and it takes the waiting question with the oldest marker first. The rest stay due and start on later ticks. Test (slice 1): a tick with three waiting desks and no open run starts exactly one run, on the oldest marker; a second tick while that run is open starts none.

### Tests

Each test fails on `origin/main` before its slice.

Slice 1:

- A production-built tick: the options builder `registryd-main` uses (exported for the test) returns a defined `unblock`, and a tick with an untagged marker on a waiting desk produces one `unblock` write, one `run` call and a `started` row. On `origin/main` the builder passes no `unblock`.
- `unblockOutcome`, one vitest case per input: `ANSWER` with text; `ESCALATE: scope adds a slice`; `ESCALATE:` with no reason; `ANSWER` with no text; a first line of free prose; empty output. The module does not exist on `origin/main`.
- `applyUnblockDecisions`, one case per row of the outcome table, asserting the exact row appended and whether `start` was called. On `origin/main` the escalate, unparseable, failed and threw paths append no row, and the refused path leaves `started` last.
- Retry bound: after a `failed` row, the next tick starts no run for that key. On `origin/main` a failed run writes no row, so the next tick runs again.
- Answer cap: a branch with two `started` rows on earlier keys gets `answer-cap` from `unblockerDue` and an `escalated answer-cap` row. The refusal does not exist on `origin/main`.
- The #3048 fixture: the question text from `.plot/state/refusals.tsv` row 16 of the operator's checkout (2026-11-03T09:21:39Z, `feature/the-scan-script-is-a-launcher`), committed as a test fixture. A stub run returns `ESCALATE: scope test`; the tick plus applier writes `escalated scope test`, calls no `continue`, and the next tick's `questionEscalation` returns a new `notified-1` rung past the first age. On `origin/main` the applier passes the escalation text to `continue` as an answer.

Slice 2:

- A `continue` with no author writes `author=unknown`. On `origin/main` it writes `unblocker`.
- `plot-continue-command.mjs --who jwloka` and the board route with `author: "jwloka"` write `author=jwloka`.
- A second `continue` on a key that holds an `answered` row refuses `already-answered` and appends nothing. On `origin/main` it appends a second row.

Slice 3:

- An `escalated` row on a desk whose plan names `Issue: #N` makes one `issueComment('N', …, marker)` call; a second pass with the same key uses the same marker. A plan with no `Issue:` line and a tracker answering `unaskable` each make no call and log one line. On `origin/main` no call exists.
- The *Waiting on you* row's escalation reason is a domain property, asserted in a unit test for a desk with an `escalated test` row, plus one browser assertion that the row shows it.

## Slices

### The unblocker runs

- `feature/fleetd-starts-the-unblocker` — fleetd passes an `UnblockWorld` to the tick and applies `unblock` writes through `applyUnblockDecisions`, with `UnblockPorts.run` starting the unblocker role; the run hands back `ANSWER` or `ESCALATE: <reason>`, parsed by `unblockOutcome`; every path records one row; one run per question key and a per-branch answer cap; the charter states the class line <!-- builds: unblock wiring, unblock outcome rule, unblocker charter --> → #3084

### The record names its author

- `bug/an-answer-records-its-true-author` — `continue` records the caller's handle or `unknown`, never a default `unblocker`; the board route and `plot-continue-command.mjs --who` pass it; a second answer on one question key refuses `already-answered` <!-- builds: answer author, already-answered refusal -->

### An escalation reaches the issue

- `feature/an-escalated-question-reaches-the-issue` — an `escalated <reason>` row posts one comment on the plan's issue through `Tracker.issueComment`, and the desk's *Waiting on you* row shows the reason <!-- builds: escalation issue comment, waiting row reason -->

## Notes

- Source: issue #3064, refs #2901 and #3048.
- Decided by jwloka on 2026-11-03: an escalated question goes to the plan's issue as a comment through the tracker port, `PLOT-BLOCKED` stays in place, and the board's *Waiting on you* row shows it. The existing ladder (`questionEscalation`, `escalations.tsv`, `Notify command`) reads an `escalated <reason>` row like `refused`; no new store.
- Decided by jwloka on 2026-11-03: catching a brief whose claims the code refutes is deferred out of this plan. The panel found that a brief does not exist at approval (`plot-brief-book` books it at dispatch), that a claim such as "the callers' tests do not move" is a prediction about a diff not yet written, and that extracting claims from prose is a model's judgement rather than a gate. The jurors place a follow-up in `plot-brief-book` (a self-check before booking) or in a dispatch hold beside `missingBriefs` (`auto-dispatch.ts`), not in `/plot-approve`.
- Not adopted in this round: a mechanical check that refuses an `ANSWER` naming a path outside the scope guard or a test file (safety juror, amendment 4). The class line is a charter rule here; the check is a candidate follow-up once the unblocker has run in production.
- Follow-up, outside this plan: test runs write `plot-continue-*` temp-desk rows into the operator's real `.git/.plot/state/answers.tsv` (1465 of 1501 rows on 2026-11-03).
- Follow-up, outside this plan: #2901's plan is Released while its applier had no production caller. That record needs an issue.
- Panel round 1: `.plot/panels/2026-11-03-a-desk-s-design-question-waits/panel.md`.
