# Round 5 — Moderation

**Subject:** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `56c995c29`, after the split of `the-shell-loop-holds-unlanded-work`
**Lenses:** estate, contradiction, deliverable, cost
**Gate:** each verdict checked with `plot-panel.mjs check Position "proceed,amend,reject" <lens>`; all four exit 0
**Reconcile:** `unanimous	amend	estate,contradiction,deliverable,cost`

## What changed in the brief

This round checked decisions only. A missing or wrong line number was not a finding, and a finding that only an implementer acts on counted toward `proceed`. Two new questions: does the split hold, and is slice 2 one deliverable.

## Round-4 findings

| Lens | Answered | Partly answered |
|---|---|---|
| estate | 7 of 7 | none |
| contradiction | 5 of 7 | 2: the state cells (moved into the new column), `supervise`'s answer (stated for `holding-work` only) |
| deliverable | 4, and 1 settled by the move to briefs | 1: the `js` test switch (no shared helper in `test/reconcile/`) |
| cost | 4 | 1: the CI queue cost |

## New findings, by subject

**1. An ending that waits for a person writes no `blocked` declaration (estate 1, contradiction 1).** `supervise` reads the declaration file and never the marker. It answers `needs-a-person` only for `status: blocked`, and `correct` for an absent declaration. So every marker row and every `checks-unanswered` row would get a correction: the answer the rule's own comment forbids. Today an agent-written marker leaves the shell loop alive and free, so the supervisor never reads that desk. The JS loop ends there.

**2. "Who acts next" has no rule behind it (contradiction 2, deliverable 1, 3; estate 2).** No rule returns `loop` or `continue`. The column had no precedence for a row where `supervise` and `deskLifecycle` disagree, and two rows with the same pair of answers named different actors. A marker desk with no work reads `refused-empty`, whose exit is copy-then-reap, not continue. This was the third round in a row in which the table failed its own test.

**3. The write kinds duplicate existing kinds and do not fit the union (contradiction 3, 4, 5; deliverable 4, 5; estate 6).**
- `blocked-marker-write`, a correction as `prompt-run` and `claim-push` duplicated `blocked-marker`, `agent-resume` and `push`.
- No kind existed for the seal and the slice's spend.
- `Decision.writes` is the one `Write` union, and `perform-fs.ts` throws at run time on a kind it does not name.
- The plan did not say where `performLoopWrites` lives or which gate measures it.

**4. The JS loop never appends to `endings.jsonl` (estate 3, deliverable 8, cost 1).** Three lenses found it. Slice 5 counts from that file.

**5. Slice 5 compares a full count with a lower bound (cost 2, deliverable 8).** The shell's expired wait writes no ending. The JS `checks-unanswered` ending also covers a moved tip, which is not a failure. Kind 3, an exit with no reason, writes no ending line by definition.

**6. Slice 2 reaches into slices 3 and 4 (deliverable 5, 6; contradiction; estate).** `reexec` has no caller until slice 4. The process-group test starts "a loop" that only slice 3 builds. The slice had no done line.

**7. Smaller findings.**
- The restart and memory ceiling are decisions with no domain rule, and failure 5 had no table row (deliverable 7).
- Slice 6's `git grep` matches 35 tracked files under `.plot/` (deliverable 2).
- Three `plot-worker-state.sh` functions have only the loop as caller (estate 4).
- The CI peak was 21 concurrent jobs, not 14 runs, at the 20-job limit (cost 3).
- Only one of the two monitors goes, so slice 6 saves 6 MB, not 10 (cost 4).
- The rate readings of rounds 2 to 4 were wrong: `gh api rate_limit` read 0 while the header read 335 (cost 5).

**Disagreements:** none on position. On slice 2, cost would keep it whole and named a clean cut if an approver wants one (`boundedRun` with its group-stop test, then the rest). Deliverable, estate and contradiction would keep it whole once `reexec` moves out and it has a done line. The amendment takes that.

## What the amendment decided

- **Every ending that waits for a person also writes a `blocked` declaration.** `supervise` then answers `needs-a-person` through its existing rule. `holding-work` writes none, as the split plan decided.
- **The table's last column is `supervise`'s own verdict.** `deskLifecycle`'s exit is asserted per desk variant and changes nowhere. A marker on an empty desk is reaped as today: the question survives in the refusals log and the declaration.
- **The loop reuses the existing kinds where they exist.** New kinds join the union, `perform-fs.ts` names them in its skip set, and `performLoopWrites` sits beside `registryd-main.ts`'s applier with a `never` check. The board's coverage tool moves to slice 2.
- **`loop-end` appends to `endings.jsonl`.** `checks-unanswered` carries `no-answer` or `tip-moved`. Each failure kind has one named source. A kind with different sources on the two sides is reported and does not enter the comparison.
- **`reexec` and a new `restartAnswer` rule move to slice 4.** Slice 2's group-stop test uses a stand-in parent, and slice 2 has a done line.
- **`loop-js` takes a `paths` filter,** and its PR records run time and queue time.

## What the four lenses had in common

The split held. All four checked it, and none found a contradiction between the two plans. The convergence change from round 4 also held: no finding this round was a stale citation.

What remains is one shape of finding, found by three lenses: the plan described an outcome ("who acts next") in its own words instead of asking the rule that decides it. That is the same failure the state columns had in rounds 2 to 4. The amendment now names `supervise`'s verdicts, which are the rule's own words, and leaves `deskLifecycle` unchanged and asserted. If a sixth round finds the table wrong again, the table itself should go, and the test's fixture should be the record of it.

No lens asked about the `blocked` declaration's effect on the board. A declaration with `status: blocked` is something the board already reads for supervised agents. Whether it shows the same desk twice, once as a marker and once as a declaration, is a question for slice 1's brief.

## Outcome

Amend. The amended plan answers every finding above. Each answer is recorded in the plan.
