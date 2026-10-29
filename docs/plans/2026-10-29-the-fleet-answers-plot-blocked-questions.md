# The fleet answers PLOT-BLOCKED questions

> When an agent writes a `PLOT-BLOCKED` question, fleetd starts the unblocker role, takes its answer back, and continues the desk through the `continue` engine. A per-question record holds each answer, its author and its outcome.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2901
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- fleetd answers a `PLOT-BLOCKED` question that an agent wrote. It starts the unblocker role detached, the unblocker hands back one answer, and fleetd continues the desk with it. Where the estate gives no answer, the unblocker gives the most reversible answer it can name.
- fleetd never answers a marker that the worker loop or fleetd wrote itself (checks failed after the correction budget, conflicts, a usage limit, refused writes, dropped work, `needs-a-person`). Those stay with a person, the fixer and the restart rules.
- Every answer to a desk, from the unblocker or from a person, goes into one per-question record under `.plot/state/` with its question, answer, author and outcome. Each answer the desk acted on also appears in its slice PR's body.
- `continue` takes the question it answers and refuses `question-moved` when the desk now holds a different question, so an answer never lands on a later question.
- A question that `continue` refuses (`run-limit`, `spend-limit`, `loop-alive`, `question-moved`) is recorded once. fleetd starts no second unblocker for it, and the question-escalation ladder notifies a person as it does today.
- While an unblocker answer is in flight, the question-escalation ladder sends no notification for that question.

<!-- Board impact: none in this plan. The fleet payload and the board's WAITING ON YOU section do not change: a blocked desk with an answer in flight still reads `waiting` (`skills/plot/scripts/plot-worker-state.sh:46`). The "answer in flight" board state has no owner yet; see Open Questions. The Plot comment's answers list belongs to #2905. No change to the plan format, the template or the docs/plans layout. -->

## Motivation

fleetd escalates a `PLOT-BLOCKED` question and waits for a person. The tick's escalation pass produces `notify` writes and nothing else (`packages/fleet/src/server/entry/registryd.ts:396-412`), built on the readings-as-values rule `questionEscalation` (`packages/domain/src/rules/question-escalation.ts:42`). From 2026-10-16 to 2026-10-29 a master agent answered 99 such markers by hand. That count does not separate an agent's questions from the markers the loop and fleetd write themselves. When the master session ends, every blocked desk stops. The design [`DESIGN-delivery-loop.md`](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md) (approved by jwloka on 2026-10-29, section *A blocked agent*) makes the fleet answer.

This plan reverses one line of the archived story `the-supervisor-delivers-the-approved-scope`: *"The supervisor escalates a question; it never answers one."* The new rule: the fleet answers an agent's question and records the answer.

Panel round 1 measured five facts that the first draft and the design got wrong:

- **`continue` has no unattended refusal today.** The `ContinueRefusal` member `unattended` is restart-only (`packages/fleet/src/shared/continuation.ts:162-163`). `ControllerAction` does not name `continue` (`packages/domain/src/rules/controller-gate.ts:12`). The only unattended refusal among the controllers is `restart` (`packages/domain/src/workflows/dispatch-verbs.ts:194`). Any unattended process, a desk worker included, can continue a desk today. #2898 adds the refusal (D1).
- **fleetd already calls the continue engine in process.** `registryd-main.ts:1927` passes `continueDesk: continueOnDesk` to the fresh-session step. The unblocker therefore hands its answer back, and fleetd applies it the same way.
- **Not every marker is an agent's question.** The loop writes terminal markers itself (`packages/domain/src/workflows/agent-loop.ts:505,549,784,807,907,962`), and fleetd writes one for `needs-a-person` (`askAPerson`, `registryd.ts:1208`; text from `needsPersonMarker`, `packages/domain/src/rules/ending-action.ts:536`). Answering those starts a second writer beside #2903's fixer and walks past the correction and fresh-agent budgets.
- **"Once per question" has no record.** `continueOnDesk` leaves the marker in place, so every tick sees the same `askedAt` while an answer is in flight, and `questionEscalation` still notifies a person at 15 minutes. `escalations.tsv` gates nothing today; it only deduplicates notification rungs, keyed by worktree and marker modification time (`packages/fleet/src/shared/escalations.ts:6-12`).
- **The plan issue comment cannot hold an answers list as built.** `planStateComment` rebuilds the whole body from phase and link at each phase write (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:44-47`). Jira answers `no-target` (`packages/domain/src/adapters/tracker/tracker-jira.ts:297-300`). One answer may be 8 KiB (`ANSWER_MAX`, `continuation.ts:84`), so about seven answers fill GitHub's 65,536-character comment limit.

## Design

### Approach

The design's *Decided* and *Calls made* lists bind this plan where the decisions below do not correct them.

**The answer record.** One record per question, keyed `(worktree, askedAt)`, where `askedAt` is the marker's modification time, the key `escalations.tsv` already uses. Each row carries the question's first line, the answer, the author (the accepted caller: `unblocker` or a person's handle) and an outcome: `started`, `answered`, `refused <reason>` or `failed`. The file lives in `.plot/state/` under the common git dir on the fleet's machine (D6), behind a domain port with a file adapter, as `fresh-agents.tsv` is (`packages/domain/src/adapters/fresh-agent-record/fresh-agent-record-file.ts:17`). `continueOnDesk` (`continuation.ts:815`) writes the `answered` row, so a person's answer through `/api/continue` or `plot-continue-command.mjs` and fleetd's answer share one source. `continue` takes the question key it answers and refuses `question-moved` on a mismatch, as `merge` pins to a head. A refused call writes nothing on the desk, the same no-trace contract the other refusals keep.

**The start.** A domain rule, `unblockerDue`, takes readings as values: the marker and its author, the recorded outcome for `(worktree, askedAt)`, the loop state and its free wait, the merge answer from the tick's memo, and a live fixer run on the slice. It answers `start` only for an agent's own question on a desk of this machine with no live loop, no live fixer, and no record for that key. The tick returns an `unblock` write beside `notify` and spawns nothing. The applier writes the `started` row before the start, as the fresh-agent step writes in `beforeStart` (`registryd.ts:1146-1160`), then starts the unblocker detached through #2898's role start. The unblocker hands back one answer. fleetd applies it through `continueOnDesk` in process with its typed caller (D1), pinned to the question key. A refused `continue` is recorded as `refused <reason>` and the rule starts nothing more for that key.

**Which markers.** The loop and fleetd mark the markers they write with a recognisable author. `unblockerDue` answers only a marker without that author. A marker the loop or fleetd wrote stays with a person, #2903's fixer and #2906's restart.

**The bound.** `continue` counts each continuation as a run and refuses past `Slice max runs` (default 12, `packages/domain/src/rules/run-limit.ts:13`; `continuation.ts:947-951`) and past `Slice max spend`. A recorded refusal stops the unblocker for that key, and the escalation ladder then notifies a person. No new counter, and `Correction budget` keeps its one meaning.

**The ladder.** `questionEscalation` reads the record. While the key reads `started`, it sends no new rung. After `answered` the marker goes, and after `refused` or `failed` the ladder notifies as it does today.

**The answer's limits.** The unblocker's answers obey the fixer's hard rules: never edit a gate or the CI ratchet, no bypass of `plot/review`, no release. The reversible answer to an exemption request is "no; keep the rule and say so in the PR body". The unblocker charter text (what it reads, the most reversible answer, never "wait for a person") is this plan's input to #2898's `.claude/agents/unblocker.md`.

**Layering.** The rule lives in `packages/domain/src/rules/`, the record behind a port with a file adapter, and the start in the applier through #2898's adapter. The plan adds no shell and no `spawn`/`execFile` site outside `adapters/`. The decision reads the marker, the record and the tick's merge memo as values, the shape of the escalation pass (`registryd.ts:396-412`).

### Acceptance

- `packages/domain` unit tests for `unblockerDue`: no marker, a merged desk, a live non-free loop, a live fixer run and a loop- or fleetd-written marker each start nothing; a `started` or `refused` record for the key starts nothing; a new `askedAt` starts one run.
- `packages/fleet` unit tests for `continueOnDesk`: a mismatched question key refuses `question-moved` and writes nothing on the desk; a person and fleetd at once start one run, and the record names the winner.
- `registryd-tick.test.ts`: a marker yields one `unblock` write and the tick spawns nothing; a second tick with the `started` row yields none.
- `question-escalation.test.ts`: a `started` record yields no new rung.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-the-fleet-answers-plot-blocked-questions/panel.md`):

- [x] D1: `continue` refuses every unattended caller; #2898 builds that refusal and the typed `caller` reading. fleetd applies the unblocker's answer through `continueOnDesk` in process with its typed caller, which `continue` accepts. The unblocker never calls `continue` itself.
- [x] D5: the unblocker role is `.claude/agents/unblocker.md` plus a per-role settings file, built by #2898 and loaded from the default branch. fleetd creates any worktree itself. This plan supplies the charter text only.
- [x] D6: the answer record lives in `.plot/state/` under the common git dir on the fleet's machine. Its one consumer is this plan's PR-body write; the plan issue's comment does not render answers (#2905, challenge 2026-10-29).
- [x] "Once per question": a durable record keyed `(worktree, askedAt)` with an outcome, written before the start; the controller records the author.
- [x] `continue` takes the question key and refuses `question-moved`.
- [x] The tick returns an `unblock` write; the applier starts the role detached.
- [x] Only an agent's own question is answered, never a loop- or fleetd-written terminal marker.
- [x] The loop bound is `Slice max runs` and `Slice max spend`, with the refusal recorded; `Correction budget` is not reused.
- [x] No `Issue:`, or a Jira tracker that answers `no-target`: the record under `.plot/state/` is the durable home in every case.
- [x] Every agent question gets an answer (jwloka, challenge 2026-10-29). An answer that rests on no estate evidence carries a `guessed` mark in the record and in the notification the person receives; the mark is a pointer, never a stop.
- [x] The answer travels with its change (jwloka, challenge 2026-10-29): each answer the desk acted on is written into its slice PR's body, beside the change it caused, so the reviewer reads it with the diff and a wrong answer surfaces as a review finding on that head. The answer record stays the durable home; the PR body is where a person checks it.

### Open Questions

- [ ] The board's "answer in flight" state. The design names it, `waiting` is decided in shell today (`plot-worker-state.sh:46`), and growing that script breaks the shell line ratchet. It must be a domain property that reads the answer record. The slice map gives it to no plan. Who builds it?

## Slices

### Answer record

- `feature/the-answer-record` — D6: a per-question record keyed `(worktree, askedAt)` with outcome and author, written inside `continueOnDesk`; a `question-moved` refusal on `continue` <!-- builds: the answer record port and file adapter, and the question-moved refusal -->

### Question answering

- `feature/fleetd-answers-a-question` — an `unblock` write; a `guessed` mark on an answer with no estate evidence, carried into the notification; each acted-on answer written into the slice PR body; the applier starts detached; only an agent's own question (never a fleet- or loop-written terminal marker); a refused `continue` is recorded <!-- builds: unblockerDue, the unblock write, the marker author, the escalation ladder's in-flight silence --> <!-- waits: feature/role-agents-start-detached --> <!-- waits: feature/unattended-callers-are-refused -->

`unblocker.md` belongs to #2898 (`feature/role-agent-definitions`); this plan supplies its charter text.

## Notes

- Depends on #2898 (`feature/unattended-callers-are-refused`, `feature/role-agents-start-detached`, and `feature/role-agent-definitions` for `unblocker.md`).
- #2900's `feature/fleetd-reviews-slice-prs` treats a desk that holds a `PLOT-BLOCKED` marker as not dead, so #2903's fixer arms never fire on a desk this plan answers.
#2906's restart refuses a desk with a marker (`blocked-marker`, `continuation.ts:160-161`).
- This plan writes no #2899 run-log line, so #2899 is not a prerequisite.
- Created from issue #2901 by `/plot-idea`, unattended. Review and Impl answers follow the repo's `Plan PRs: required` and the multi-slice shape.
- Deliverable search for `unblocker` found nothing in the estate.
- Definition of Done: docs/definition-of-done.md
