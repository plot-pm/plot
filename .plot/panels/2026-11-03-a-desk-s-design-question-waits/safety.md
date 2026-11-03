# Safety juror: a desk's design question waits for a person

Position: amend

Lens: what an agent that answers a design question alone may do wrong (widen a slice's scope, weaken a test, decide what belongs to a person, loop), and what bounds and records each answer.

## Summary

The plan's premise is false. On origin/main the fleetd unblocker never runs: `applyUnblockDecisions` has no production caller, and every answer in `answers.tsv` marked `author=unblocker` came through `continue` with an author that defaults to `unblocker`. So Part 1 does not change "an unblocker that skipped a question class". It turns on, for the first time, an unattended Sonnet agent whose answers reach a desk. The safety questions of this lens apply to that first start, and the plan answers none of them. The record of the motivating case also shows the exact harm the lens names: a recorded answer on the scan-script desk says "This widens the scope guard". Part 2 places a check where its subject does not exist yet.

## Findings

### F1. The unblocker has no production caller (rubric 1, 2)

- `packages/fleet/src/server/entry/registryd.ts:1575` defines `applyUnblockDecisions`. `git grep "applyUnblockDecisions"` over `packages/*/src` on origin/main returns only its definition and two doc references (`:1511`, `:1630`). `unblockLines` has no caller either.
- `registryd.ts:388-394` adds `unblock` writes only when `options.unblock` is defined. `packages/fleet/src/server/entry/registryd-main.ts` contains the word `unblock` zero times, so the option is never passed and no write is ever applied.
- `.plot/logs/fleetd.log`, `fleetd.log.1` and `fleetd.err` (the paths in `~/Library/LaunchAgents/com.plot-pm.fleetd.plist`) contain zero lines matching `unblock`, case-insensitive.
- `.git/.plot/state/answers.tsv`: 1501 rows, every one `outcome=answered`, zero `started`. `applyUnblockDecisions` writes `started` in `beforeStart` (`registryd.ts:1593-1602`); a real unblocker run leaves a `started` row. None exists.
- `packages/fleet/src/shared/continuation.ts:1502` writes `author: input.author ?? 'unblocker'`. A `continue` call with no author is recorded as the unblocker.

Consequence: the plan's Motivation ("The unblocker (#2901) answers `PLOT-BLOCKED` questions, but it did not answer this one") and gap 1 ("no stated rule for which questions it answers alone") misdiagnose the defect. The defect is that the role is not wired. A Sonnet agent that builds Part 1 as written adds a class rule to code that never executes, and the sprint gains nothing.

### F2. The motivating record shows scope widening by an answer (lens: widen scope)

`answers.tsv` rows for `desk-c34ea6fb` (the `feature/the-scan-script-is-a-launcher` desk, PR #3048):

- row 1311, askedAt `2026-11-01T23:41:01.634Z`: "Go ahead with your proposed fix inside this slice … This widens the scope guard".
- rows 1447 and 1483, same key `2026-11-01T23:57:12.513Z`: "Option (a), in this slice … Touching plan-walk-branches.ts and scan-walk.ts is in scope."

The brief's scope guard (`.plot/briefs/the-scan-script-is-a-launcher.md:54-60` on origin/main) lists the files the branch owns and says "report it rather than improvising outside scope". The recorded answers enlarged that list. These rows carry `author=unblocker` but, per F1, came from `continue` (row 1448 for another desk even says "a fix agent of the master agent"). Whoever wrote them, it is exactly the decision this plan proposes to hand to an unattended agent. The plan names no bound on it.

### F3. The same key holds two answer rows (lens: loop, record)

Rows 1447 and 1483 share `(desk-c34ea6fb, 2026-11-01T23:57:12.513Z)`. The unblocker's own guard (`packages/domain/src/rules/unblocker-due.ts:50`, "ANY RECORDED OUTCOME REFUSES") would refuse a second run on that key, but `continue` appends regardless. Once the unblocker is wired, a person or master agent and the unblocker can both answer one question, and the record does not say which answer the desk acted on.

### F4. The charter forbids escalation (lens: decide what belongs to a person)

`.claude/agents/unblocker.md:35` says "Never answer 'wait for a person.' … still answer the question asked". Part 1 requires an escalation outcome. The plan does not name this line, so a builder can add escalation code while the charter still instructs the model never to escalate. The model then answers scope and cost questions alone, which is the harm the issue describes.

### F5. The outcome has no parseable shape (rubric 4, 5)

`UnblockPorts.run` returns `{ ok: true; answer: string }` (`registryd.ts:1524`). Any text the model returns, including "I could not determine…", goes straight to `continueOnDesk` as an answer. The plan states two outcomes but does not say how code tells them apart. Without a structured first line (for example `ANSWER:` or `ESCALATE: <reason>`) parsed in the domain, "escalate" is a prose rule the model may ignore and the code cannot check. Per *Gates Over Rules*, the class decision needs an objective check where one is possible.

### F6. A failed run retries every tick without bound (lens: loop)

`registryd.ts:1559`: "A FAILED RUN RECORDS NOTHING … the next tick's `unblockerDue` finds the same untagged marker and tries again." Once wired, a run that fails (timeout, maxTurns 20, model error) spends a Sonnet run on every tick for the life of the marker. The plan says "a run that produces neither is a defect, not a third outcome" but does not say what is recorded or what stops the retry. Also unbounded: answer, desk re-blocks with a new marker, new `askedAt`, new run. Nothing caps unblocker runs per desk or per slice.

### F7. Escalation already has a mechanism the plan does not name (rubric 3)

`questionEscalation`, `.plot/state/escalations.tsv` (`packages/fleet/src/shared/escalations.ts:16`) and the `Notifier` port already notify a person by question age (`Question escalation`, default `15m, 1h, 4h`). Open question 2 ("whom does an escalation reach") ignores this. A second escalation record risks two channels that disagree. The unblocker's escalation needs only a reason and a link to the existing rungs.

### F8. Nothing forbids weakening a test (lens: weaken a test)

The charter forbids editing gates, CI and the shell-lines ratchet, not tests. The scan-script question was literally "the callers' tests do not move" versus changing them. An unattended answer "update the test to match" passes every hard rule. The plan does not add a rule or a check.

### F9. Part 2 checks a brief that does not exist at approval (rubric 1, 5, 6)

The plan's own open question 4 says "A brief is written after approval today". `/plot-approve` therefore has no brief to read. The slice line ("`/plot-approve` refuses a plan whose brief claims the code refutes") cannot be built as stated. A claim like "the tests do not move" is about a diff that does not exist yet; no grep refutes it before implementation. Extracting claims from prose is Frontier-tier judgement, not a gate. A false positive blocks approval and adds an intervention, against the sprint goal. Part 2 also adds a refusal on the approval controller with no named reason word and no override.

### F10. Open questions are all design decisions (rubric 5)

All five open questions are unanswered, and each one decides what a slice builds. An unattended Sonnet agent cannot build either slice from this plan. The plan is Draft, so this is expected, but it must not reach Approved in this form.

## Required amendments

1. Restate the defect: the unblocker is not wired (F1). Slice 1 first passes `unblock` options in `registryd-main.ts` and applies `unblock` writes through `applyUnblockDecisions`, with a test that a tick with an untagged marker on a waiting desk produces a `started` row and a `plot-fleetd unblock` log line.
2. Record the true author. `continue` with no author must record the caller (a person's handle or `master`), never default to `unblocker` (`continuation.ts:1502`). Test: a `continue` with no author does not write `author=unblocker`.
3. Give the run a parseable outcome: the first line is `ANSWER` or `ESCALATE: <reason>`, parsed by a domain rule. Anything else is recorded as `refused unparseable` and is not passed to `continue`.
4. Bound the class mechanically where the brief allows it: an answer that names a path outside the brief's `### Scope guard` owned list, or that tells the desk to change or delete a test file, is not applied. It is recorded as an escalation with reason `scope` or `test`. State this as a domain rule with tests for each arm, and say what happens when a brief has no scope guard (escalate, never answer).
5. Change `.claude/agents/unblocker.md`: remove "Never answer 'wait for a person'", add the escalate format, and add "never widen the scope guard; never tell the desk to weaken, skip or delete a test" to the hard rules.
6. Bound retries: a failed run writes a `failed` row (so `already-recorded` holds), or the plan names a retry count and records each attempt. Cap unblocker answers per slice (for example the `Correction budget`) and escalate past the cap.
7. Escalation reuses `escalations.tsv` / `Notifier` / the *Waiting on you* list, and adds only the reason. Name the record fields.
8. Make `continue` refuse a second answer on a key that already holds an `answered` row, or record why it supersedes (F3).
9. Move Part 2 out of `/plot-approve`, or drop it. If kept, run it at `plot-brief-book` against the brief, limit it to claims a read can refute (file exists, caller list, test file named), name the refusal word, and name who overrides it. Otherwise file it as its own plan.

## Decisions for a person

- Which question classes the unblocker may answer alone at all. Proposed line: it may answer only within the brief's scope guard and without changing a test; scope, cost and test-contract choices escalate. This is the trust boundary of the fleet and belongs to a person, not to the builder.
- Whether to turn the unblocker on at all in this sprint, given that it has never run in production (F1) and its first start changes every `PLOT-BLOCKED` desk.
- Whether Part 2 stays in this plan.

## What I ran versus what I read

Ran (read-only): `gh issue view 3064`, `gh pr view 3048 --json …`, `git show origin/main:<file>` for `unblocker-due.ts`, `registryd.ts` (lines 380-400, 1500-1660), `continuation.ts` (1480-1510), `continue-command.ts`, `answer-record.ts`, `.claude/agents/unblocker.md`, `.claude/settings/unblocker.json`, the scan-script brief; `git grep` for `applyUnblockDecisions`, `unblockLines`, `unblock` in `registryd-main.ts`, `author: 'unblocker'`, `escalations.tsv`; `git log -S applyUnblockDecisions`; `git log -1 0974e8956`; awk/grep over `.git/.plot/state/answers.tsv` (outcome counts, rows per desk, duplicate keys); grep over `.plot/logs/fleetd.log`, `fleetd.log.1`, `fleetd.err`.

Read only, not executed: the behaviour of `continueOnDesk` beyond the record write; whether the 2026-11-03 marker on PR #3048 is a separate marker from the 2026-11-01 rows (answers.tsv holds no row after 2026-11-02, so it was either answered with no record or not answered). I ran no test and no fleet or board command.

Side observation, outside this plan: about 1486 of the 1501 `answers.tsv` rows name `/var/folders/.../T/plot-continue-*` desks, so a test suite writes into the operator's real answer record.
