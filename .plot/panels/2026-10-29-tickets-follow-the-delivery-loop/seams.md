# Juror verdict: seams (this plan against its nine siblings and the design)

Position: amend

Evidence: Read the plan, DESIGN-delivery-loop.md, issue #2905 (`gh issue view`), and the Design and Slices sections of all nine sibling plans (#2908–#2917). Read `packages/domain/src/adapters/tracker/tracker-plan-state.ts`, `tracker-jira.ts:280-300`, `ports/tracker.ts:87-125`, `rules/issue-status.ts`, `rules/deliverable.ts:55-140`, `packages/board/src/server/entry/plan-state.ts`, `approve.ts:1160-1185`, `deliver.ts:525-560` and `:940-962`, `skills/plot/scripts/plot-issue-status.sh`, `packages/fleet/src/shared/escalations.ts`. Ran `vitest run test/tracker-plan-state.test.ts test/issue-status.test.ts` in the plan worktree (65 of 65 pass). Ran a throw-away probe test (moved out to `scratchpad/juror-2905-seams/` afterwards; worktree left clean) that asserts `planStateComment({phase:'delivered',…})` is exactly two lines, marker plus `Plan delivered: <link>` — it passed. Ran `git grep` for every caller of `plot-plan-state.sh` and `plot-issue-status.sh`.

## (a) Problem statement

- Correct: `planStateComment` writes one line under `<!-- plot:plan-link -->` (`tracker-plan-state.ts:35`, `:44-47`); the GitHub write edits that one comment in place (`:74-77`). `PlanStatePhase` has four members (`ports/tracker.ts:87`). `issueStatusWrites` owes a write at `approved`, `delivered`, `released` (`rules/issue-status.ts:46-57`).
- **Missing fact 1 — the approved Jira status is owed but never written.** `issueStatusWrites` owes `approved`, yet `plot-issue-status.sh` has exactly two callers: `deliver.ts:531` (deliver) and `deliver.ts:944` (release). `approve.ts:1174` calls only `plot-plan-state.sh`. The script's own header (`plot-issue-status.sh:14-15`) names the same two callers. So "the same three points" the design names (DESIGN, *Tickets* table, last row) are two points in code today. The plan's Approach item 3 and Open Question 1 state that `plot-issue-status.sh` "already covers" all three; it does not.
- **Missing fact 2 — Jira carries no comment.** `tracker-jira.ts:293` answers `unaskable` to `issueComment`, and `:297-300` answers `no-target` to `planStateWrite`. The progress line and the ticket list never reach a Jira issue. The plan should say so, so a reader does not expect slice 3 to carry them.
- **Missing fact 3 — the later phase writes erase what this plan adds.** Every phase write rebuilds the whole comment from `PlanStateWrite` alone (probe above: the delivered body is two lines). Five callers make that write with phase and link only: `plot-idea` (draft), `approve.ts:1174`, `deliver.ts:546`, `deliver.ts:955` (released), and `/plot-release`. Approach item 1 makes progress "a field of the Approved-phase write", so the Delivered write removes the progress line, the HIGH tickets and the unblocker answers — exactly when a person reads the issue.

## (b) Approach — the seams

| Shared piece | Who names it | Who should own it |
|---|---|---|
| The plan-issue Plot comment (renderer, input type, size cut) | this plan slices 1–2; #2912 slice 2 ("a line in the plan issue's marked comment"); #2913 slice 3 (`builds: the answers list in the plan issue's Plot comment`); #2910 slice 3 (revert ticket "linked from the plan's issue comment") | **this plan (#2905)**. One renderer; the siblings write records only |
| HIGH ticket record (ticket id, link, PR, plan, head) | #2912 opens the ticket; no plan names a record a renderer can read | **#2912 (#2903)**, beside its attempts file; this plan reads it |
| Unblocker answer record (question, answer, who, time) | #2913 keeps `escalations.tsv` "as a record"; this plan's OQ2 waits on it | **#2913 (#2901)** |
| Revert ticket of a Delivered plan | #2910 slice 3 only; this plan does not mention it | **#2910 (#2904)** writes the record; this plan renders it |
| Comment size cut | this plan OQ4 and #2913 OQ3, same question twice | **this plan** |
| Jira approved-status write at approve | no plan | **this plan, slice 3** |
| Sprint close | #2911 slice 3 (`plot-sprint-state.sh`) | #2911; this plan adds nothing |
| Run log | #2909 | #2909; not a source this plan can render answers from (fields: slice, PR, head, step, outcome, time — no question or answer text) |
| `rules/slice-pr-next.ts`, attempts file, caller identity | #2917/#2914/#2912, #2912, #2908 | not used by this plan, correctly |

Findings:

1. **Three plans write one comment.** `planStateComment` rebuilds the whole body on each write, and the GitHub write edits one comment in place. If #2912 and #2913 each add their own line by their own write, each write drops the other's line unless all of them go through one renderer that reads every record. The plan's "rebuilt from recorded state on every write" is the right shape, but only holds if the siblings stop writing the comment. #2912's slice 2 and #2913's slice 3 must change to "write the record", or this plan's slice 2 duplicates them.
2. **The records do not exist, and no sibling names their shape.** `escalations.tsv` (`escalations.ts:5-30`) holds worktree, `askedAt`, rung, `at`, status — no question text, no answer, no author — and is "append-only and machine-local" (`:10`). A comment rebuilt on machine B from a machine-local file written on machine A drops A's answers. #2913 proposes the run log for plans with no `Issue:`, but #2909's run log has no question or answer field either. The record must be shared state (committed, or an index under the common git dir like `issues.json`), and its shape must be agreed between #2913 and this plan before either slice 2/3 starts.
3. **Undeclared dependencies.** The plan names #2902 and #2903 only. Slice 2 also needs #2901 (the answer record) and #2904 (the revert ticket). Slice 1 needs #2902 less than it says: the design's *One merge in flight* counts "the fleet's or a person's" merge, so the progress write should be triggered by a new MERGED row in the PR index, not by #2902's merge step. Then a person's `plot-ask.mjs merge` updates progress too, and slice 1 does not wait on #2902.
4. **The count source.** Approach item 1 reads `plot-pr-merged.sh` per branch. In a fleetd tick that is one host call per slice per merge, and it is shell. *A Decision Reads The Index* allows a MERGED row from the index (a terminal answer). The count should also use the same arithmetic as delivery (`deliverable.ts:103-140`, `allSlicesConfirmed`: non-deferred slices, a slice may hold several branches, subject-only evidence is `unknown`), or the comment can say "3 of 3" while auto-deliver waits. Expose a count from `landed` instead of writing a second one.
5. **No caller-identity dependency.** `plot-plan-state.sh` and `entry/plan-state.ts` read no `PLOT_UNATTENDED` (grep: no match), and a tracker write is not a lifecycle action. This plan correctly does not wait on #2908's caller identity.
6. **The renderer sits in an adapter.** `planStateComment` is in `adapters/tracker/`. Once it chooses which tickets and answers to show and where to cut, it is a rendered state; per CLAUDE.md (*Every rendered state is a domain property*) the body belongs in a rule (for example `rules/plan-comment.ts`), and the adapter only posts it.

## (c) Slices

- Slice 1 (progress) is independently mergeable if it is triggered by the index and reads the count from `deliverable.ts`. It must also change `entry/plan-state.ts`'s `run` so every phase write (draft through released) renders the same records; otherwise slice 1 ships a line that the next Delivered write deletes.
- Slice 2 (tickets) should wait on three records: #2912's HIGH ticket record, #2913's answer record and #2910's revert-ticket record. Declare these as `waits:` on sibling branches or as plan-level Needs. Alternatively cut it in two: HIGH and revert tickets (waits on #2903, #2904), answers (waits on #2901).
- Slice 3 (Jira) has a real job, but not the one the plan names: wire `plot-issue-status.sh` (or its bundle) into `approve.ts` next to `:1174`, so the `approved` word is written. That is the design's "same three points". Nothing in the design asks for a per-merge Jira transition; issue #2905's "the same points" (as the comment) and the design's "same three points" disagree, and the design binds.

## (d) Open questions

- OQ1 (Jira points): the design says three points; two are wired (`deliver.ts:531`, `:944`), approve is not. New work = the approve call only. No transition on merge or progress.
- OQ2 (answer record): not answerable from the estate — no record with question/answer text exists. Owner: #2913. Requirement from this lens: shared, not machine-local; carries question, answer, who, time, plan, slice.
- OQ3 (sprint item): nothing to add. The tick at delivery exists (`rules/sprint-tick.ts`, per the design's *What exists today*), and the sprint close after release is #2911 slice 3.
- OQ4 (size): own it here and close #2913's OQ3 as a duplicate.
- New: does the progress write fire on a person's merge? (Recommend yes, index-triggered.)
- New: does the Delivered/Released write keep the ticket and answer lists? (Must, see (a) fact 3.)
- New: a plan with no `Issue:` — `planStateWrites` returns nothing, so tickets and answers have no home. Name where they go (the plan PR body, as #2913 proposes) and who writes it.

## (e) Tests

- Slice 1, domain unit: the comment rule over (phase, merged count, total, tickets, answers) — every phase keeps the lists; the count agrees with `allSlicesConfirmed` on deferred, multi-branch and subject-only fixtures. Board unit (`plan-state.test.ts`): `run` with phase `delivered` passes the records into the `issue-comment` host call (extend the assertion at `plan-state.test.ts:202`). Fleet unit: a new MERGED index row triggers one write; an unchanged index triggers none.
- Slice 2, domain unit: two writers' records render together in one body; the size cut keeps the last N and links the rest.
- Slice 3, board unit: approve with `Tracker approved status` set calls `plot-issue-status.sh` once and reports `tracker=` on the summary; a failed write leaves the approval standing.

## Amendments

1. State that `approve.ts` never calls `plot-issue-status.sh` today and make slice 3 that wiring; drop per-merge Jira transitions; state that Jira takes no comment (`tracker-jira.ts:293-300`).
2. Make every phase's plan-state write render the progress, ticket and answer lists (change `entry/plan-state.ts`), not only the Approved write.
3. Declare this plan the sole owner of the plan-issue comment renderer and size cut; ask #2912 (slice 2), #2913 (slice 3) and #2910 (slice 3) to write records instead of comment lines.
4. Add #2901 and #2904 to Needs; agree the HIGH-ticket, answer and revert-ticket record shapes with their owners, and require a shared (not machine-local) store.
5. Trigger the progress write from a new MERGED row in the PR index, so a person's merge counts, and drop the hard dependency of slice 1 on #2902.
6. Derive the count from `deliverable.ts`'s `landed` arithmetic, not from per-branch `plot-pr-merged.sh` calls.
7. Move the comment body into a domain rule; keep `tracker-plan-state.ts` as the poster.
