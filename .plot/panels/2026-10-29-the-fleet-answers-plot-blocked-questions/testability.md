# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2901 (`gh issue view`), `DESIGN-delivery-loop.md` (Constraints, What exists today, A blocked agent, Role agents, Tickets, Decided, Calls made), sibling plans #2898 and #2899, and in the plan's tree: `packages/domain/src/rules/question-escalation.ts`, `rules/continue-target.ts`, `rules/ending-action.ts:570-595`, `ports/agent-run.ts`, `adapters/agent-run/agent-run-command.ts`, `ports/tracker.ts:85-110`, `adapters/tracker/tracker-plan-state.ts`, `adapters/tracker/tracker-jira.ts:290-300`, `packages/fleet/src/shared/escalations.ts`, `shared/continuation.ts`, `shared/continue-command.ts`, `server/entry/continue-command.ts`, `server/entry/registryd.ts:180-440`, `server/entry/registryd-main.ts:1510-1570`, `packages/board/src/server/entry/gate.ts:620-700`. Ran (after `pnpm install` in the worktree): domain vitest `question-escalation`, `continue-target`, `tracker-plan-state` (3 files, 57 passed); fleet vitest `escalations`, `continue-command`, `worker-question` (3 files, 51 passed); fleet vitest `registryd-tick` (92 passed). Ran a node probe (scratch dir, a `.js`→`.ts` resolve hook) calling `continueTarget`, `needsPersonMarker` and `planStateComment` directly; its output is quoted below.

## (a) Problem statement

- The motivation is correct: fleetd only notifies. `escalationWrites` (`registryd.ts:397-428`) produces `notify` writes and nothing else. `notifyEscalations` (`registryd-main.ts:1527-1569`) sends them and appends to `escalations.tsv`.
- **The plan names a refusal that does not exist.** The Approach says *"The controller lifts its unattended refusal only for a caller that declares itself as fleetd's"* and makes #2898's caller identity a prerequisite. The `continue` controller has no unattended refusal. `ContinueRefusal` (`continuation.ts:96-163`) marks `unattended` as *"`restart`: the caller runs unattended"*. `continueOnDesk` (`continuation.ts:815ff`) and `plot-continue-command.ts` never read `PLOT_UNATTENDED`. The controller gate covers `dispatch`, `approve`, `deliver` and `release` (`gate.ts:621-623`), not `continue`. Today an unattended unblocker can already run `plot-continue-command.mjs <branch> -`. The design makes the same mistake (`DESIGN-delivery-loop.md:144`). Per the brief, a fact the design missed overrides it. So the plan does not need #2898's caller-identity slice. It needs #2898's runner slice (`--agent <role>`).
- **Not every `PLOT-BLOCKED` marker is an agent's question.** fleetd writes system markers through `needsPersonMarker` (`registryd.ts:970`, `ending-action.ts:582-592`). The probe printed: for `corrections-spent`, *"The slice on `feature/x` already had its one fresh session (corrections-spent) and reached it again. Decide how it should proceed."* `registryd-tick.test.ts:1265` uses the marker *"The worker on `feature/two` stopped on a run limit"*. `continue` refuses `run-limit` and `spend-limit` unconditionally (`continuation.ts:135-151`: *"The limit wins over a person's answer"*). So the claim *"the unblocker always answers"* cannot hold for those markers, and the plan does not say what happens then.
- **The Plot comment cannot hold a list as built.** `planStateComment` (`tracker-plan-state.ts:44-47`) rebuilds the whole body from `{phase, planLink, version}`. The probe printed `"<!-- plot:plan-link -->\nPlan approved: docs/plans/x.md"`. `PlanStateWrite` is *"one-way … no Plot code reads either back"* (`ports/tracker.ts:91-92`). It is written only at phase transitions (callers: board `approve.ts`, `deliver.ts`, `plan-state.ts`). An answers list therefore needs a durable answer record to rebuild from, and a caller that writes mid-phase. The Jira tracker answers `no-target` for every plan-state write (`tracker-jira.ts:294-300`). On a Jira estate, such as ewz-kus-portal, there is nowhere to record answers, not only on a plan with no `Issue:`.
- **"Who gave it" has no source.** `continueOnDesk` writes `.plot-continuation.md` (`continuation.ts:1056-1058`) and a log line (`:738`). Neither records an author. The answer itself is not kept outside the desk.

## (b) Approach

- The layering is right in outline: a pure domain rule (`unblockerDue`), a fleet-side write, and an adapter that starts the agent. It mirrors `questionEscalation` + `escalationWrites` + `notifyEscalations`, which is the precedent to copy. The key `worktree + askedAt` (marker mtime) already exists (`escalations.ts:83-96`, `recordedRungsFor`). "Once per question" should reuse it.
- **`agent-run` blocks until the run ends.** `AgentRun.run` *"Runs one agent turn to its end"* (`ports/agent-run.ts:15-24`), and `agentRunCommand` awaits `boundedRun.run` (`agent-run-command.ts:63`). If the tick calls it inline, a sonnet run of minutes stops the 60 s tick (`TICK_INTERVAL_MS`, asserted at `registryd-tick.test.ts:1168`) and every other desk's supervision. The plan must say the start is detached, the way `startFreeAgent` is (`registryd-main.ts:1491`), and a test must prove the tick returns while a run is in flight.
- **A live, non-free loop refuses.** Probe output: `alive, not free -> {"kind":"refused","reason":"loop-alive"}`, `alive, free wait -> {"kind":"continue",…,"stop":{"pid":41}}`, `dead loop -> {"kind":"continue",…}`. The 2026-10-05 case (`registryd-tick.test.ts:1186-1190`) has a marker on a live loop. `unblockerDue` must read the loop state and the free-wait record, and stay quiet on a live mid-turn loop. Otherwise it spends a sonnet run on an answer the controller refuses.
- **A refused or failed start must not count as "answered".** If the record is written at start (as `escalations.tsv` records a rung even when the send failed), a refused `continue` leaves the same marker with the same mtime. The rule then never retries and never notifies. The record needs an outcome column (`started`, `answered`, `refused <reason>`, `failed`), and the rule must branch on it.
- **The board is not covered.** The Board-impact comment says WAITING ON YOU changes, and *Every rendered state is a domain property* (CLAUDE.md) requires a domain property such as `answerInFlight` on the desk/agent row. No slice builds it.
- **Escalation rungs.** The plan does not say whether `notified-1` at 15 m still fires while an answer is in flight. The design says the ladder stays *"as a record, not a wait"*. Today `escalations.tsv` gates nothing (it only dedupes rungs), so *"no longer gates anything"* changes nothing as written.
- Shell ratchet: nothing in the plan needs shell. Good.

## (c) Slices

- **Slice 1 duplicates #2898.** #2898's `feature/role-agent-definitions` builds *"reviewer.md, fixer.md, unblocker.md, main-repair.md"*. This plan's `feature/the-unblocker-role-answers-from-the-estate` builds `.claude/agents/unblocker.md`. Two branches writing one file conflict, and the *builds:* marker is claimed twice. Drop slice 1 and wait on #2898's definitions slice. Alternatively, rescope slice 1 to the unblocker's prompt/charter content, wait on #2898's slice, and edit only the body.
- Slice 2 (`unblockerDue` + start) is the right core. It is too large for one branch if the detached start and the outcome record land with it. Splitting it into rule + write, then adapter, is optional.
- Slice 3 needs an answer record before it can render anything. Either slice 2 writes it (a `.plot/state/answers.tsv`, or a run-log line from #2899), or slice 3 must wait on #2899's run log and name it as its source.
- A board slice is missing (see (b)).
- The order is right: rule/start before record. Slice 3 also waits on #2899's `feature/the-delivery-loop-keeps-a-run-log`, if the run log is the record.

## (d) Open questions

1. *Loop bound.* The continued prompt itself invites a new marker (`continuation.ts:337`: *"write a fresh PLOT-BLOCKED: line"*), so the loop is real. The proposal to count answers against the correction budget is testable as a domain rule over the answer record: count rows per `(branch)` with `answered`, and `unblockerDue` answers `notify` at > 2. That gives a pure unit test. The stall notification belongs to #2899's stall rule. Reuse it rather than add a second notifier path.
2. *No `Issue:`.* Same answer for a Jira tracker (`no-target`, `tracker-jira.ts:297`). Record it in the answer record and the run log. "Say so in the PR body" needs a host write that no slice owns. Drop it or give it an owner.
3. *Comment size.* `ANSWER_MAX` is 8 KiB (`continuation.ts:84`). 99 answers can reach about 800 KB, far past GitHub's 65,536-character comment body. Keep the last N with the question's first line and a 200-character answer excerpt, and link the record. A domain unit test can prove the bound (see (e)).

New questions the plan should carry:
- Which marker sources does the unblocker answer? It should answer the agent's own `blocked` and system markers that `continue` will accept. It should skip `run-limit` and `spend-limit`, which `continue` refuses.
- Where is the answer and its author recorded durably, and in what shape?
- Is the unblocker started detached, and what bounds it (`maxTurns`, `boundSeconds`)?
- Do escalation notifications still fire while an answer is in flight?

## (e) Tests per slice, and whether they run offline

All of the below run without a live fleet, host or browser. The existing fixtures cover them: the `escalation()` world in `registryd-tick.test.ts:1175-1181`, the pulse value in `continue-command.test.ts:15-31`, `trackerFixture` in `tracker-plan-state.test.ts:8`, and a fake `BoundedRun`.

- **Slice 1 (role definition), reconcile `node --test`:** parse `.claude/agents/unblocker.md` frontmatter. Assert `model: sonnet`, a tool list with no `Write`/`Edit`/`NotebookEdit`, a set `maxTurns`, and a body that names `plot-continue-command.mjs`. The rule *"never answers 'wait for a person'"* is not checkable offline as prose. It becomes checkable only as a `Stop` hook that reads the run's transcript for a `plot-continue-command` call. A hook test with a fixture transcript, with and without the call, proves that gate. Without it, the acceptance criterion depends on a live model.
- **Slice 2 rule, domain unit `packages/domain/test/unblocker-due.test.ts`:** readings as values `{marker: {askedAt, firstLine} | null, ending reason, loop: alive|none, loopWaitsFree, merged, recorded: outcome | null, answersOnSlice}`. Assertions:
  - no marker → not due
  - merged → not due
  - live non-free loop → not due
  - free wait → due
  - same `askedAt` with outcome `started` → not due (restart-safe)
  - outcome `refused loop-alive` → due again
  - ending `run-limit`/`spend-limit` → not due, reason named
  - new `askedAt` → due
  - answers > 2 → notify, not start
- **Slice 2 tick, fleet unit in `registryd-tick.test.ts`:** an `unblocker` world beside `escalation`. One tick yields exactly one `unblocker-start` write for a marker. A second tick, with that write recorded through a temp-dir answers file and a fresh in-memory record, yields none. That proves *"a restarted fleetd does not start a second unblocker"*. Model the test on the escalations memory/file tests in `escalations.test.ts`.
- **Slice 2 adapter, fleet unit:** a fake `BoundedRun` captures argv and env. Assert `--agent unblocker` in the command, `PLOT_UNATTENDED=1`, and `cwd` the repo root, not the desk. Give the fake a promise that never resolves and assert the tick still returns (detached start).
- **Slice 2 controller path, fleet unit:** `continueBranch` with the pulse fixture and an answer from the unblocker. This already exists in shape (`continue-command.test.ts:72ff`, which builds a real git desk in tmp). Add the case that the start record moves to `answered` only on `kind: 'started'`.
- **Slice 3, domain unit in `tracker-plan-state.test.ts`:**
  - `planStateComment` with an `answers` list shows each question, answer and author.
  - 99 answers of `ANSWER_MAX` length give a body ≤ 65,536 characters, with the last N answers and a link to the record.
  - A phase write after answers keeps the list. This is the rebuild-from-record property.
  - Through `trackerFixture`, assert `planStates[n]` carries the body.
  - `trackerJira(...).planStateWrite` stays `no-target`, and the record still holds the answer.
- **Board (missing slice), domain unit plus one board unit:** a pure property on the agent row, e.g. `waitingOn: 'person' | 'unblocker'`, asserted in the domain. One `packages/board` vitest (`--project parallel`) proves that WAITING ON YOU omits the row.

## Amendments

1. Remove the claim that `continue` refuses unattended callers, and drop #2898's caller-identity slice as a prerequisite. Keep #2898's runner slice (`--agent <role>`). Cite `continuation.ts:162-163` and `gate.ts:621-623`.
2. Drop slice 1, or rescope it to wait on #2898's `feature/role-agent-definitions` and edit only the unblocker's body. Two plans must not both *build* `unblocker.md`.
3. Define `unblockerDue`'s readings: marker, ending reason, loop state and free wait, merged, the recorded outcome per `worktree + askedAt`, and the answer count per slice. Name the system markers it skips (`run-limit`, `spend-limit`), and what it does instead (notify).
4. State that the unblocker starts detached, with a `maxTurns` and a `boundSeconds`, so the 60 s tick never waits on it.
5. Add a durable answer record (question first line, answer, author = `unblocker` or a person's handle, outcome, time) written by slice 2. Slice 3 renders the comment from that record.
6. Make `planStateComment` compose from the record, bounded below GitHub's 65,536-character limit. Coordinate with #2899 and the design's progress line, which change the same function. Name Jira `no-target` beside "no `Issue:`".
7. Add a slice for the board's domain property for "answer in flight" and the WAITING ON YOU change. Without it, the Board-impact note has no owner.
8. Say whether escalation rungs still notify while an answer is in flight.
9. Add per-slice acceptance criteria that name the tests in (e). Each one runs at domain or fleet unit tier, with no live fleet, host or browser.
