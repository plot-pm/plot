# Panel moderation: a-high-finding-is-fixed-before

Reconcile: **unanimous amend** (layering, safety, testability, seams). Executed evidence: three jurors ran `workflows-agent-loop.test.ts` row 13 (6/6) and confirmed the desk seals on green; testability ran 314 domain tests and board `review.test.ts` (56/56); probes over `reviewBypasses` and `deskLoopAlive`. `rules/slice-pr-next.ts` does not exist, so no arm of the plan could run.

## Agreed by all four

1. **"HIGH, desk alive → correction" has nothing to read.** On green the desk loop takes ROW 13 (`agent-loop.ts:455-478`), writes `declaration, slice-spend, assignment-clear` and releases the branch; the reviewer starts only on green, so no desk holds the branch when a HIGH exists. The loop resumes only on red checks, a dropped turn or a continuation (`worker-loop.ts:1848-1872`), and `correctionText` comes from CI evidence (`:1077`), never from a file fleetd appends. As written, the process still counts as alive, the fixer never fires, and the PR stays on `failure`. The design missed this.
2. **No slice wires the arms into fleetd's tick.** Nothing writes the correction, starts the fixer or counts the attempt, and #2906 expects "the fixer runner" from this plan. A tick slice is needed; it also owns the "CI red, corrections spent → fixer" start, which #2906's `freshSessionFailedFixer` duplicates (two rules could start two fixers on one branch).
3. **A HIGH still gets a ticket at review time** (`review.ts:486-492`), so one HIGH gets two tickets and the ticket step would adopt the review-time issue. #2900 removes the review-time issue for every severity.
4. **The ticket's assignee has no route.** `IssueOpen` has no assignee (`ports/tracker.ts:123-130`), `tracker.ts:52` refuses widening a write to one, and plans record no author. A port change across connectors, or drop the assignee.

## Executed or source findings on repeats

- **Two fixers on one PR** (safety, layering): a fixer runs in its own worktree, so `deskLoopAlive` answers `none` and the next tick, or a restarted fleetd, starts fixer 2 with one attempt left. Count the attempt and record "fixer in flight" BEFORE the start, so a crash spends an attempt rather than adding a writer. A person's `/plot-continue` and the unblocker answering the ROW-15 marker can also start a loop under a running fixer.
- **`Tracker.issueOpen` is not idempotent** (`ports/tracker.ts:400-417`); reuse `openFollowUp`'s `pending`-then-id record (`review.ts:251-340`), keyed per PR, with each head's findings posted to that one ticket (safety, layering).
- **"Attempts spent" is three states, one per tick**: ticket recorded → `success` written → merge handed to #2902's arm with its holds. Re-read PR state and head before each irreversible step (safety).

## Settled facts

- **Who writes the accepted-HIGH `success`**: `entry/approve.ts:72-95` already writes `plot/review=success` outside a review run. A domain rule `reviewStatus(counts, ticket)` decides; it refuses unless this head's review has a HIGH, two attempts are recorded and the tracker confirms the ticket. No reviewer re-run (layering, seams, safety; testability proposes `acceptHigh(pr, sha, ticket)` with the 140-character status cap tested).
- The board-impact note is wrong: reconcile §20a reads only the status state, so an accepted HIGH and a clean review read alike (probe, layering and safety).
- Missing prerequisites: #2898 (fixer role, runner), #2899 (run log); #2900 and #2902 have plans (#2917, #2914). The plan-issue line belongs to #2905; this plan owns a per-PR ticket record #2905 shows and #2904 reuses. The attempts file records which finding each attempt answered (seams, for #2899's moved stall arm).
- Q2: a desk whose corrections are spent ends with a `PLOT-BLOCKED` marker and is not live (ROW 15). Q3: with no tracker the PR holds and the stall rule notifies; it never merges. Q4: one ticket per PR (safety) rather than per head (layering) — moderator takes per PR.

## Shared blind spot

All four accept "two fixer attempts" as the right budget. None asked what a fixer costs against what it saves: an opus run per attempt per HIGH, and no measurement yet of how often a fixer clears a HIGH on the first try.

## For the person

- A desk is gone by review time. Either change ROW 13 so the desk waits on the branch for its review and fixes its own HIGH (one writer, more desk time held), or drop that arm and send every HIGH to the fixer (simpler, matches today's practice).
