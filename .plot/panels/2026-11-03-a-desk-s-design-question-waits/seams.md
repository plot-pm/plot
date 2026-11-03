# Seams juror: a-desk-s-design-question-waits

Position: amend

The defect is real and the sprint needs it closed. The plan misreads why the question waited: on `origin/main` the unblocker never runs, so no class rule could have helped. Part 1 must start by wiring the unblocker, and it must fix three seam defects that make the record lie. Part 2 targets the wrong step: the brief does not exist at approval.

## Findings

### F1. The unblocker has no production start (Motivation and Part 1 premise are false)

- `registryd.ts:389` adds `unblock` writes only when `options.unblock !== undefined`. The one production tick call, `registryd-main.ts:2930-2946`, passes `registry`, `world`, `queue`, `fleet`, `max`, `escalation` and `idle`, and no `unblock`. So `unblockWrites` (`registryd.ts:539`) never runs in fleetd.
- `applyUnblockDecisions` (`registryd.ts:1575`) has zero callers outside tests: `git grep applyUnblockDecisions origin/main -- packages` finds only its definition and doc references. No adapter implements `UnblockPorts.run` (`registryd.ts:1524`).
- `docs/plans/2026-11-01-fleetd-s-fixer-and-main-repair.md:44` already says: "The unblocker is in `ROLE_NAMES` but has no production start."
- #2901's plan (`2026-10-29-the-fleet-answers-plot-blocked-questions.md`) reads `State: Released`, and its slice line promised "the applier starts detached".
- Consequence: the plan's sentence "The unblocker (#2901) answers `PLOT-BLOCKED` questions, but it did not answer this one" is false. No unblocker answered any question. A class rule in the charter or in `unblockerDue` changes nothing while the pass is unwired. Per *Where a rule exists and nothing calls it, that is a defect to report*, the wiring is the first slice.

### F2. A person's answer is recorded as the unblocker's

- `continuation.ts:1502` writes `author: input.author ?? 'unblocker'`. `continue-command.ts:110` forwards `input.author`, but neither `board/src/server/continue.ts` nor `plot-continue-command.mjs` sets it.
- The live record shows the effect. `.plot/state/answers.tsv` under the common git dir holds rows with author `unblocker` and outcome `answered` for desks `desk-7d8c9620`, `desk-c34ea6fb` and others (2026-11-01). Their text ("Option 2. Commit 0974e8956 on main adds a new slice…") is a person's or the master agent's answer, because F1 shows no unblocker ran.
- These rows reach the slice PR body: `board/src/server/entry/slice-pr.ts:191-195` renders `answered` rows with their `author`. Any measurement of "unblocker answers" from this file is wrong today, and Part 1's "every unblocker run records an answer or an escalation" is unverifiable until a person's answer carries a person's handle.

### F3. A refused or failed apply leaves `started` as the last outcome, which silences the person ladder

- `applyUnblockDecisions` appends `started` inside `beforeStart` (`registryd.ts:1591-1602`). On `refused` or `failed` it only pushes a log entry (`registryd.ts:1607-1617`) and appends no row. #2901's plan promised "A refused `continue` is recorded as `refused <reason>`".
- `questionEscalation` returns no rung while the last outcome is `started` (`question-escalation.ts:57`). `escalationWorldForRepo.recordedOutcome` reads the last row (`registryd-main.ts:1109-1112`).
- So once F1 is wired, a spawn failure after `beforeStart` leaves the question with `started` forever: `unblockerDue` refuses `already-recorded`, and the ladder notifies no one. That is the silent outcome Part 1 says is a defect, and the plan does not name it.

### F4. The charter forbids the escalation Part 1 adds

- `.claude/agents/unblocker.md` says "Never answer 'wait for a person.'" and "still answer the question asked". Part 1 adds an escalation outcome. The plan names the charter as the place of the class rule, but does not say that its current text forbids the second outcome.
- `UnblockPorts.run` returns `{ ok: true; answer: string }` (`registryd.ts:1524`). There is no typed way to return "escalate". If the charter changes and the port does not, an escalation text goes through `continueOnDesk` as an answer and the desk resumes on it.
- The charter file belongs to #2898 and is loaded from the default branch. The plan must say this slice edits it, and that the role gate (`rules/role-gate.ts`) still applies.

### F5. An escalation has an existing channel; the plan invents a second one

- The question-escalation ladder (`question-escalation.ts`, `escalations.tsv`, `Question escalation` ages) already notifies a person for a marker that ages. Open Question 2 offers the approver, `People`, or *Waiting on you* as new recipients.
- The seam-consistent answer: the unblocker records `escalated <reason>` in `answers.tsv`, and `questionEscalation` treats it like `refused`/`failed` (falls through to the age rungs), with the reason in the notification. No new recipient field, no new file. `readAnswers` already filters to `answered`, so an escalation row does not reach the PR body as an answer; the plan should state whether the escalation reason appears in the PR body or only in the notification.

### F6. Part 2 checks a document that does not exist at approval

- The brief is a per-branch file `.plot/briefs/<branch-tail>.md` (`rules/brief-path.ts:18`) written by the Brief command after approval. For the motivating case: the plan `2026-10-31-the-plan-walk-moves-into-the.md` got its `State:` commit on 2026-10-31 (`380c5136d`), and the brief `.plot/briefs/the-scan-script-is-a-launcher.md` was booked on 2026-11-01 (`eeea594c6`).
- The plan's own Open Question 4 says so, and still names `/plot-approve` in the slice line and the Changelog. The slice title "`/plot-approve` refuses a plan whose brief claims the code refutes" cannot be built as written.
- The seams that exist after the brief: `plot-brief-book.mjs` (books the brief), and `auto-dispatch.ts:341-557` (`missingBriefs` keeps a briefless slice from starting). A refuted brief claim could hold the slice the same way `missingBriefs` does.
- The claim in the issue is a paraphrase. The brief text is "None of these move in this slice" (line 25) about callers that invoke `plot-fleet-scan.sh` by name, and line 60 tells the desk "report it rather than improvising outside scope". Together with the worker prompt (`.plot/worker-prompt.sh:194`, "If you must stop and ask a person something, write your question into a file named PLOT-BLOCKED.md"), the brief invited the question. A check that extracts "testable claims" from this prose needs a model, not a grep. The plan calls it "a gate with an objective condition"; that is not shown.
- The pre-approval panel (`/plot-panel`, this panel) is the existing pre-approval read of a plan. The plan does not say how Part 2 relates to it.

### F7. Scope questions repeat on the same plan

- The live record holds three scope questions from desks of the same plan (`2026-10-31-the-plan-walk-moves-into-the.md`) on 2026-11-01: `--stream`/`--loose` (answered "Option 2 … adds a new slice"), and the `listing:` stderr contract twice. The answer to the first was a reslice. This supports Open Question 5: a scope-choice question is a plan change, and its answer is a new slice line, which neither the unblocker (read-only, `tools: Read, Grep, Glob`) nor `continue` can write.

## Amendments required

1. Correct the Motivation: state that the unblock pass is unwired on `origin/main` (`registryd-main.ts:2930` passes no `unblock`; `applyUnblockDecisions` has no caller; `UnblockPorts.run` has no adapter), and file it against #2901 / #2964.
2. Add a first slice, before the class rule, that wires the unblock world into the production tick, implements `UnblockPorts.run` through the existing role start (`roleCommand`), and calls `applyUnblockDecisions` after the tick. Name its test: a tick with an untagged marker on a waiting desk produces an applied `unblock` outcome in fleetd's log, and fails on `origin/main` today.
3. In Part 1, require: (a) the board's continue route and `plot-continue-command.mjs` pass the caller's handle as `author`, and `continuation.ts:1502` refuses or records `unknown` instead of defaulting to `unblocker`; (b) the applier appends `refused <reason>` and `failed` rows, so `started` is never the last outcome of a finished apply; (c) a test that a refused apply lets `questionEscalation` reach a rung.
4. Make the escalation a typed result of `UnblockPorts.run` (`{ kind: 'answer' } | { kind: 'escalate', reason }`), recorded as `escalated <reason>` and read by `questionEscalation` like `refused`. Name the charter edit to `.claude/agents/unblocker.md` that replaces "Never answer 'wait for a person'" with the class rule and the escalate output format.
5. Move Part 2 off `/plot-approve`: check at brief booking or hold dispatch the way `missingBriefs` does, and rename the slice. Or drop Part 2 and route scope-choice questions to `/plot-reslice` (Open Question 5).
6. Fix the board-impact comment: no board view reads `answers.tsv`; only the slice PR opener (`board/src/server/entry/slice-pr.ts:191`) does.

## Decisions that need a person

- Open Question 1 (which classes the unblocker answers alone). The escalation threshold is a trust decision about unattended scope changes.
- Whether a scope-choice question escalates to a person or triggers `/plot-reslice` (which today needs a person to confirm, per its skill).
- Whether Part 2 stays in this plan at all, given F6.

## Rubric answers

1. The plan does not fix the issue as written: the unblocker it refines never runs (F1). With amendments 1–4 it moves the sprint toward zero interventions. A reader verifies by a tick test on an untagged marker and by `answers.tsv` rows whose author is `unblocker` only for fleetd's runs.
2. False claims: "The unblocker (#2901) answers `PLOT-BLOCKED` questions" (F1); the board "reads" `answers.tsv` (amendment 6); the check at `/plot-approve` sees a brief (F6). The quoted brief claim is a paraphrase (F6).
3. Half-done: the author default (F2), the missing `refused` row (F3), the charter text (F4), the ladder's `started` silence (F3). No shell, bash 3.2 or Bitbucket arm is touched by Part 1 as amended.
4. Failure modes not ending in a named refusal: spawn failure after `beforeStart` (F3); escalation text applied as an answer (F4).
5. An unattended Sonnet agent cannot build either slice from the plan: five open questions are unresolved, and slice 2's location contradicts Open Question 4.
6. The plan names no tests. Amendments 2 and 3 name tests that fail on `origin/main` today.

## What I ran versus read

Ran (read-only): `gh issue view 3064`; `gh pr view 3048` and `3067`; `git grep` over `origin/main` for `unblock`, `applyUnblockDecisions`, `author`, `briefPath`; `git show` of `registryd.ts`, `registryd-main.ts`, `unblocker-due.ts`, `answer-record.ts`, `question-escalation.ts`, `continuation.ts`, `slice-pr.ts`, `.claude/agents/unblocker.md`, `.plot/worker-prompt.sh`, the #2901 plan and the motivating brief; `git log` for the brief and plan dates; read the live `.plot/state/answers.tsv` under the common git dir. No test suite, host write, fleet or board command.

Only read, not executed: whether `beforeStart` runs before the `run-limit`/`spend-limit` refusals in `continueOnDesk` (F3 holds for the `failed` path regardless).

Side note: `answers.tsv` on this machine also holds rows for `/var/folders/.../T/plot-continue-*` desks, so a test writes into the operator's real record. That is outside this plan.
