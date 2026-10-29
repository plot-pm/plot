# Panel moderation: the-fleet-answers-plot-blocked-questions

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: the `plot-continue-command.mjs` and `plot-restart-command.mjs` bundles under `PLOT_UNATTENDED=1` (all refused `unknown-branch` before any caller check, so the refusal finding rests on source reading); a probe calling `questionEscalation`, `continueTarget`, `needsPersonMarker` and `planStateComment`; 43–200 domain and fleet unit tests green as baselines.

## Agreed by all four

1. **`continue` has no unattended refusal.** `'unattended'` is a restart-only reason (`continuation.ts:162-163`); the controller gate does not cover `continue` (`gate.ts:621-623`, `ControllerAction` at `controller-gate.ts:12`). Today any unattended process, including a desk worker, can answer a desk. The plan's dependency on #2898's caller identity is void; it needs only the role runner. fleetd already calls the continue engine in process (`registryd-main.ts:1927`, `startFreshSession` → `continueOnDesk`), so the unblocker can hand its answer back and fleetd applies it.
2. **"Once per question" needs a durable record.** `continueOnDesk` leaves the marker, so every tick sees the same `askedAt` while an answer is in flight; the probe shows `questionEscalation` still notifies a person at 15 minutes. Write a per-question record keyed `(worktree, askedAt)` with an outcome before the start, as `fresh-agents.tsv` is written; the controller records who answered. Safety adds a `question-moved` refusal on `continue`, pinning the answer to the question as `merge` pins to a head.
3. **The tick returns an `unblock` write and the applier starts the role, detached.** `AgentRun.run` blocks to the end; a synchronous start stalls the tick.
4. **The issue comment cannot hold the answers as built.** `planStateComment` rebuilds the whole comment from phase and link at each phase write (`tracker-plan-state.ts:44`) and reads nothing back; Jira answers `no-target` (`tracker-jira.ts:297`); one answer may be 8 KiB, so about seven fill GitHub's 65,536-character limit, and a failed write blocks the issue from closing at `released`. This plan owns the answer record; #2905 owns rendering it, size-bounded.
5. **Slice 1 duplicates #2898**, which builds `unblocker.md`. This plan supplies the charter text only.

## Executed or source findings one juror raised that change behaviour

- **Not every marker is an agent's question** (safety, testability). The loop writes terminal markers itself — checks failed with the budget spent, conflicts, usage limit, refused writes, dropped work (`agent-loop.ts:503,548,807,907,962`) — and fleetd writes `needs-a-person` (`registryd.ts:1208`). Answering those starts a new worker beside #2903's fixer on the same branch and walks past the correction and fresh-agent budgets. `unblockerDue` answers only an agent's question.
- **A blocked desk reads as dead to #2903** (seams): its worker has exited, so "desk dead → fixer" fires while the unblocker answers. #2900's rule must treat a marker desk as not dead.
- **`continue` refuses `run-limit` and `spend-limit` with no exception** (testability, safety), so "always answers" cannot hold there; record the refusal so fleetd does not restart an unblocker every tick. Open question 1 already has its bound in `Slice max runs` (default 12) and `Slice max spend`; do not reuse `Correction budget`.
- The board's "answer in flight" state must be a domain rule; `plot-worker-state.sh:46` decides `waiting` today, and growing it breaks the line ratchet (layering). No slice here or in a sibling builds the WAITING ON YOU change the plan names (seams, testability).
- "Never answers 'wait for a person'" is checkable offline only as a Stop hook tested against a fixture transcript (testability) — and #2898's probe found frontmatter hooks did not fire under `--agent`.

## Shared blind spot

All four judged whether the answer reaches the desk. None judged the answer's quality: nothing compares an unblocker's answer against what a person later says, so a run of wrong-but-reversible answers is invisible until review findings pile up. The design's "every answer recorded where a person looks" is the only check, and it is after the fact.

## For the person

- None beyond the cross-plan question on the `continue` refusal (add one with a fleetd exception, or record that any unattended caller may continue).
