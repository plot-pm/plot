# Juror verdict: layering

Position: amend

Evidence: Read the plan, issue #2901 (`gh issue view`), `DESIGN-delivery-loop.md`, sibling plans #2908, #2899 (run log), #2916 (tickets), and in the worktree at `4de186a03`: `packages/domain/src/rules/question-escalation.ts`, `packages/fleet/src/server/entry/registryd.ts:178-450`, `registryd-main.ts:1512-1560`, `packages/fleet/src/shared/escalations.ts`, `packages/fleet/src/shared/continuation.ts` (refusal union :100-163, `ANSWER_MAX` :84, `continueOnDesk` :815-), `packages/fleet/src/server/entry/continue-command.ts`, `packages/fleet/src/shared/continue-command.ts`, `packages/domain/src/rules/controller-gate.ts:12`, `packages/domain/src/ports/agent-run.ts`, `adapters/agent-run/agent-run-command.ts`, `adapters/tracker/tracker-plan-state.ts`, `adapters/tracker/tracker-jira.ts:293-300`, `rules/issue-status.ts:64-95`, `skills/plot/scripts/plot-worker-state.sh:40-50`. Ran: (1) `plot-continue-command.mjs some/branch "…"` under `PLOT_UNATTENDED=1` (read-only: it refused `unknown-branch` from the bridged pulse, exit 1 — no unattended refusal fired); (2) `vitest run test/question-escalation.test.ts test/controller-gate.test.ts` (121 passed); (3) a scratch vitest probe calling `questionEscalation` and `planStateComment` directly (output quoted below).

## (a) Problem statement

- Correct: fleetd only escalates. The tick's escalation pass emits `notify` writes and nothing else (`registryd.ts:396-430`), built on the readings-as-values rule `questionEscalation` (`question-escalation.ts:42`).
- **Wrong: "The controller lifts its unattended refusal only for a caller that declares itself as fleetd's."** The `continue` controller has no unattended refusal. The refusal union in `continuation.ts:100-163` holds `unattended` only for `restart` (comment at :162). `continue-command.ts` (entry) reads no `PLOT_UNATTENDED`. `ControllerAction` in `controller-gate.ts:12` is `'dispatch' | 'approve' | 'deliver' | 'release' | 'restart'` — `continue` is not gated. Executed: the bundle under `PLOT_UNATTENDED=1` went straight to the pulse lookup and refused `unknown-branch`. The design's *Role agents* paragraph makes the same mistake for `continue`; the plan inherits it. Consequence: today ANY unattended agent can already continue a desk, and the plan's dependency on #2908's caller identity is, for this plan, not a prerequisite but a NEW refusal someone has to add. The plan must say which: add an unattended refusal to `continue` with a fleetd exception (a behaviour change for existing unattended callers), or drop the claim.
- Misleading: "`escalations.tsv` stays as a record and no longer gates anything." It gates nothing today. It is the dedupe record for notification rungs keyed by worktree and marker mtime (`escalations.ts:6-12`, `registryd-main.ts:1512-1516`). What the plan means to change is the notification itself: probe output — a marker 20 minutes old with an unblocker in flight still yields `{"rung":"notified-1","isNew":true}`. The rule has no reading for "answer in flight", so a person is paged at 15 m for a question the fleet is answering. The plan must say whether `questionEscalation` gains that reading.
- "The decision follows *A Decision Reads The Index*" names the wrong rule. The marker is a desk file, not the PR index. The relevant precedent is the escalation pass: marker, merge memo and a record as values (`registryd.ts:396-412`). Say that.

## (b) Approach, against the layering rule

1. **The start decision is placeable correctly, and the plan should pin where.** The existing shape is: `tick` performs nothing and returns writes (`registryd.ts:257-260`); `escalationWrites` reads the world and calls a pure rule; `registryd-main.ts` applies. `unblockerDue` belongs in `packages/domain/src/rules/` taking `{ marker, merged, unblockerRecord, deskState, now }` as values, the tick emits an `unblock` write beside `notify`, and the applier starts the role through the `agent-run` adapter. The plan says "fleetd starts it through `agent-run`" but not that the tick returns a write; without that, the start lands in the tick (a spawn inside the decision), which breaks the tick's dry-run property.
2. **"Once per question" needs a persisted record the plan never builds.** `continueOnDesk` does not remove the marker; the new run is told to clear it (`continuation.ts:317-330`). So between the unblocker's start and the new worker clearing the marker, every tick sees the same marker with the same `askedAt`. Desk state alone cannot tell "unblocker running" from "nothing started". A restart-safe "once" needs a record keyed `(worktree, askedAt)` — the same key `escalations.tsv` uses. No slice's `builds:` names it. It should be an adapter behind a domain port (not another reader in `fleet/src/shared/`, which is where `escalations.ts` sits today).
3. **"Once" with no retry is a silent stall.** An unblocker that exits without calling `continue` (bound, crash, refusal such as `run-limit` or `spend-limit` at `continuation.ts:135-151`) leaves the question unanswered forever, because the rule never fires again for that key. The rule needs an outcome on the record (`started`, `answered`, `failed`) and a bound after which a second attempt or a stall notification (#2899's stall rule) fires.
4. **The record of the answer is written in the wrong place for "who gave it".** If the unblocker calls `continue` itself, fleetd never sees the answer text, and a person's answer through the board's `/api/continue` or the CLI leaves no record either. The one place every answer passes is `continueOnDesk`. Recording `(branch, askedAt, question first line, answer, caller)` there — a tool call writing the index — gives the comment renderer one source for unblocker and human answers alike. The plan's Record slice names no writer.
5. **The comment is a full overwrite.** `planStateComment` (`tracker-plan-state.ts:44`) rebuilds the whole body from one `PlanStateWrite`; probe output: `"<!-- plot:plan-link -->\nPlan delivered: docs/plans/x.md"`. Every phase write (`board/src/server/entry/plan-state.ts:138`) would erase an answers list unless the body is a pure domain render of phase + progress + tickets + answers from recorded state. #2916's approach already says exactly this ("rebuilt from recorded state on every write"). Two plans writing one comment is the defect to avoid.
6. **Jira has no comment.** `tracker-jira.ts:297-300` answers `no-target` for `planStateWrite`, and `issueComment` is `unaskable` (:293). On a Jira-tracked estate (ewz-kus-portal) every answer has no tracker home. Open question 2 covers "no `Issue:`" only; it must also cover "a tracker that holds no comment".
7. **The board's WAITING ON YOU change is a domain property the plan does not build.** `waiting` is decided in shell (`plot-worker-state.sh:46`, a marker in the tree). Refining it to "answer in flight" in that script grows the shell against `check-shell-lines.sh`. It must be a domain rule reading the unblocker record, with a unit test, per "every rendered state is a domain property". No slice builds it; the Board-impact comment only mentions it.
8. **Shell ratchet and spawn ratchet:** the plan adds no `plot-*.sh` lines, good. The start must go through the `agent-run` adapter, so the `spawn`/`execFile` count outside `adapters/` does not move. State this as an acceptance line.
9. **Host re-ask:** no step here is destructive. Starting an unblocker is reversible; the `continue` controller re-reads the marker (`continuation.ts:829`) and refuses `loop-alive`, so it confirms freshly. Reading the tick's merge memo, as `escalationWrites` does (`registryd.ts:404-407`), is sufficient; skip a merged desk the same way.

## (c) Slices

- **Role slice duplicates #2908.** #2908's `feature/role-agent-definitions` builds `unblocker.md` among the four definitions. Drop this plan's Role slice, or move the unblocker charter's *content* here and leave the file to #2908 — one owner.
- **Record slice duplicates #2916.** #2916's `feature/the-plan-issue-names-its-tickets` builds "each unblocker answer (question, answer, who answered)" in the same comment, and its open question asks this plan for the record's shape. Resolve: this plan builds the answer RECORD (written in `continueOnDesk`), #2916 builds the RENDER. Rename the Record slice accordingly.
- **Missing:** the answer-in-flight board state (b7) and the escalation-rung change (a) — either in the Start slice or a slice of their own.
- Order: record before start is better than start before record. The start rule's "once" reads the record, and the record must exist before the first unblocker answers, or the first answers are lost.

## (d) Open questions

- Q1 (loop bound): do not reuse the correction budget. Corrections are CI-red counts on the desk (`worker-loop.ts`, design table); answers are a different counter. A domain rule reading the answer record's count per slice answers it, and the notification goes through #2899's stall rule and `Notifier`, which already says "a notification is not a stop".
- Q2 (no `Issue:`): record in the answer record; also cover Jira (`no-target`, b6).
- Q3 (size): a hard bound is required. One answer may be 8 KiB (`ANSWER_MAX`, `continuation.ts:84`); GitHub's comment body limit is 65,536 characters, so about seven full-length answers fill it. The render must carry the first line of each question and answer, a per-entry cap, and a link to the record for the rest.
- New: does `continue` gain an unattended refusal at all (a)? Which existing unattended callers would that break?
- New: what does the rule do when the desk is on another machine (`elsewhere`)? The record and `escalations.tsv` are machine-local.

## (e) Tests

- `unblockerDue` — domain unit test from readings: no marker → none; marker, no record → start; marker with `started` record → none; `failed` or past bound → retry or stall; merged desk → none. Tier: `packages/domain` vitest.
- Tick — `registryd-tick.test.ts`: a marker produces an `unblock` write and the tick spawns nothing (fixture `AgentRun` records zero calls during `tick`).
- `continueOnDesk` writes one answer record with the caller identity — `packages/fleet` unit test with a fixture desk.
- Comment render — domain unit test: phase change keeps answers and progress lines; size cap holds at N × `ANSWER_MAX`.
- Answer-in-flight board state — domain unit test plus one browser assertion that the row leaves WAITING ON YOU.
- `questionEscalation` with an in-flight reading returns no new notified rung — extend `question-escalation.test.ts`.

## Amendments

1. Correct the claim that `continue` has an unattended refusal (`continuation.ts:100-163`, `controller-gate.ts:12`); decide whether to add one.
2. Name the persisted unblocker record keyed `(worktree, askedAt)` with an outcome, behind a domain port, and add a retry or stall bound for a failed unblocker.
3. Have the tick return an `unblock` write; start the role in the applier through the `agent-run` adapter.
4. Write the answer record inside `continueOnDesk`, so human and unblocker answers share one source with the caller recorded.
5. Remove the Role slice (owned by #2908) and turn the Record slice into "the answer record", leaving the comment render to #2916.
6. Build the answer-in-flight state as a domain rule, and stop `questionEscalation` paging a person while an answer is in flight.
7. Answer Q3 with a cap derived from `ANSWER_MAX` and the 65,536-character limit; extend Q2 to Jira's `no-target`.
