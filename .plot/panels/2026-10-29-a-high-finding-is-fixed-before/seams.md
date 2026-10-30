# Juror verdict: seams against the nine sibling plans and the story design

Position: amend

Evidence: read the plan (PR #2912), issue #2903 (`gh issue view`), `DESIGN-delivery-loop.md`, and all nine sibling plans (#2908/#2898, #2909/#2899, #2910/#2904, #2911/#2907, #2913/#2901, #2914/#2902, #2915/#2906, #2916/#2905, #2917/#2900). Read `packages/board/src/server/entry/review.ts` (40-80, 470-520), `packages/board/src/server/entry/approve.ts:60-100`, `packages/domain/src/ports/tracker.ts:44-145`, `packages/domain/src/entities/pr-index.ts:30-100`, `packages/domain/src/rules/fresh-agent.ts`, `packages/domain/src/adapters/host/host-shell.ts:75,110`, `packages/domain/src/ports/desk.ts:111-136`. Ran: a grep matrix over the ten plan files for every shared interface (`slice-pr-next`, attempts file, run log, caller identity, fixer runner/start, review record, cross-issue references); `grep -rn REVIEW_CONTEXT packages/*/src`; `grep -rn 'slice-pr-next|slicePrNext|fixer' packages/*/src` (zero hits: none of these exist yet). No test was run: the worktree has no `node_modules`, and every interface under judgement is unbuilt, so no unit test can exercise it yet.

## (a) Problem statement

- `review.ts:494` is correct: `const state = counts.high === 0 ? 'success' : 'failure';`. `openFollowUp` opens one issue for any finding (`review.ts:486-492`, doc at `:58-66`). Correct.
- **False: "the review entry (`review.ts`) holds the only writer today"** (Open Question 1). `approve.ts:71` declares the same `REVIEW_CONTEXT = 'plot/review'` and `writeApprovalStatus` (`approve.ts:86-95`) writes `state: 'success'` with `description: approved by <who>` on a head. That is a second writer, and it is the precedent for Q1: a controller, not an agent, writes `success` on a pinned head.
- **False: "Prerequisites #2900 and #2902 name no plan yet"** (Open Question 5). Both have plans: PR #2917 (`fleetd-reviews-every-slice-pr-in`) and PR #2914 (`fleetd-merges-slice-prs-one-at`). The plan should read their contracts from them, not from the design.
- Missing cause: the plan names #2900 and #2902 only. It also depends on #2898 (the `fixer` role definition, the role-aware `agentRunCommand`, fleetd's caller identity) and #2899 (the run log every loop step writes). The grep matrix shows #2903 mentions neither number.

## (b) Approach — seam by seam

**1. `rules/slice-pr-next.ts` and its input type.** Owner: #2900 (PR #2917, slice `feature/fleetd-reviews-slice-pr-next`), which creates the file. #2902 (PR #2914) adds the merge and hold arms. This plan adds four arms. #2917 defines the input as "the PR index row, the review record and the default-branch reading". The HIGH and CI-red arms also need **desk liveness**, **corrections spent**, **fresh-session outcome** and **fixer attempts**, and none of these is in #2917's input. This plan widens the input type that #2917 owns, and must say so. **Arm precedence** across three plans is unowned: CI red must precede the review arm, a red main must hold before the merge arm, and "attempts spent" must precede the merge arm. #2917 should own one ordered table in the rule's TSDoc, and each later plan should add its rows to that table.

**2. The review record (HIGH on this head).** Nobody builds a reader. `PrIndexRow` has no `plot/review` field: `review` (`pr-index.ts:41`) holds GitHub's `reviewDecision` (`host-shell.ts:75`: `APPROVED`, `CHANGES_REQUESTED`, `REVIEW_REQUIRED`, `''`). The HIGH count exists only in the status description (`N HIGH findings`, `review.ts:495`) and in the verdict file under the git common directory. #2917 and #2914 both name "the review record" and leave the reader unbuilt. This plan needs HIGH count and findings text per head. Owner: #2900, as part of the rule's input. This plan should name it as a prerequisite and not build a second reader.

**3. The merge after the ticket (arm 3) overlaps #2902.** Arm 3 ends in "merge". #2914's merge row is "Review on this head has no HIGH → merge". A ticketed head still has a HIGH, so #2914's predicate as written never merges it. Arm 3 should end at "write `plot/review=success` naming the ticket". The merge must belong to #2914 alone, and #2914's predicate must read "the `plot/review` status on this head is `success`", not "no HIGH". One of the two plans has to change, and the change belongs in #2914. This plan should name it.

**4. HIGH still opens an issue on the first review.** #2917 slice 3 stops `review.ts` opening an issue for MEDIUM and LOW only. After #2917 and this plan, a HIGH still opens a follow-up issue on the first review through `openFollowUp`, before any fix. That contradicts *Decided*: "a ticket only if the fix fails". Neither plan removes the HIGH issue-open. Owner: this plan, slice 2, ordered after #2917's `feature/fleetd-reviews-findings-comment` because both edit `review.ts:486-520`.

**5. The ticket write breaks a port contract.** `Tracker.issueOpen` takes `IssueOpen { title, body, labels }` (`tracker.ts:123-130`). It has no assignee. `tracker.ts:52` says that widening a write to "a body, a label or an assignee is the mirror this port exists to refuse". "Assigned to the plan's author" therefore needs a port change that the plan does not name. Either widen `IssueOpen` with an argued exception, or drop the assignee and name the author in the body.

**6. HIGH ticket record and plan-issue line overlap #2905.** This plan writes "a line in the plan issue's marked comment". #2905 (PR #2916) slice `feature/the-plan-issue-names-its-tickets` builds exactly that list and says that "the HIGH line names the ticket #2903 opens". This is a duplicate. Ownership: **this plan writes a ticket record** (ticket id per PR and head; `review.ts` already records an issue id per PR and head in `issueFile`, `review.ts:261-280`, so reuse that shape). **#2905 renders that record** into the comment. Delete the comment line from this plan, and name the record as the interface that #2905 reads. #2904 (PR #2910) also opens "a HIGH-style ticket naming the plan" for a revert. This plan's ticket opener should be the one that #2904 calls, and #2904 should name it.

**7. Fixer attempts file.** Owner: this plan (#2906 says "#2903 decides the file shape; this plan reads it and adds no second store"). Two consumers constrain its shape, and the plan names neither:
   - #2899 (PR #2909) stall rule: "a slice that spent both fixer attempts on the same finding". The file must record which finding (head SHA plus finding text or hash) each attempt answered.
   - The one-writer rule: a running fixer is a live writer on the branch. If the file records only completed attempts, the next pulse sees "desk dead, attempts left" and starts attempt 2 beside attempt 1. The file must record an in-flight attempt (pid or start time), and arm 2 must read it as "desk alive".

**8. Fixer start overlaps #2906.** Arm 4 ("CI red, desk dead or corrections spent → fixer") and #2906's `freshSessionFailedFixer` ("fresh session failed, attempts < 2 → fixer") are two rules that answer "start the fixer" for overlapping states. "Corrections spent" in arm 4 also skips the one fresh session that `rules/fresh-agent.ts` gives today, while the design (*A dead or stuck desk*) starts the fixer only "when the fresh session … has also failed". If both rules ship, fleetd can start two fixers on one branch. One owner: put the CI-red arm in `slice-pr-next.ts` (this plan), with the condition "desk dead, or corrections spent **and** fresh session failed". #2906 then keeps only its restart slice, or turns its rule into the fresh-session input of this arm.

**9. Nobody wires the fixer start or the correction write into fleetd.** This plan's slices build a rule and a ticket. No slice makes fleetd's tick act on "correction" or "start fixer". #2917 and #2914 each have a tick slice for their arms. #2906 assumes that "#2903 (the fixer runner …)" exists, but #2898 builds only the role-aware runner. The tick action that calls `agent-run` with role `fixer` and the HIGH findings, and the action that writes a correction through `Desk.writeCorrection` (`desk.ts:111-136`), are unowned. Owner: this plan, in a new slice. The plan should also answer whether a HIGH correction spends the desk's CI correction budget: `writeCorrection` takes `attempt` and `budget` (`desk.ts:122-123`).

**10. Caller identity.** #2914 says that it takes the identity from #2900. That is wrong: #2898 (PR #2908, slice `feature/fleetd-caller-identity`) owns it. This plan does not need the identity for its own writes (`agent-run` and the tracker are not refusing controllers). The ticketed-success write (Q1) must not become a new unattended route: if it is a controller, it reads #2898's identity.

**11. Run log.** #2899 says that "every later loop plan writes its steps to this log". This plan writes none: correction, fixer start, ticket and success write each are a loop step. Name #2899, and log each step.

Layering and shell ratchet: both hold as written. Rule as a value, adapters for the writes, no `plot-*.sh` growth.

## (c) Slices

- The rule slice must wait for #2917's `feature/fleetd-reviews-slice-pr-next` (the file and the input type) and #2914's `feature/slice-pr-next-merge-arm` (the arm order and the merge predicate). The plan states "Needs #2900 and #2902" only in Notes. No slice carries a cross-plan `waits:`.
- Missing slice: **tick wiring** (seam 9), waiting for the rule slice and for #2898's runner and `fixer.md`.
- Slice 2 must wait for #2917's `feature/fleetd-reviews-findings-comment` (same lines in `review.ts`) and must also remove the first-review HIGH issue-open (seam 4).
- The CI-red arm moves here from #2906, or out of this plan. It must not exist in both.
- The plan-issue comment line leaves this plan for #2905 (seam 6).

## (d) Open questions

- **Q1 (who writes success):** a controller, not the reviewer agent. #2898's role table makes the reviewer "read-only" and gives it "the review record" (the verdict), not the status. `approve.ts:86-95` is the precedent for a controller that writes `success` on a pinned head. Build a `review.ts` mode (or a sibling entry) that takes the PR, head and recorded ticket id, re-reads the head, writes `success` with `HIGH accepted: <ticket>` and refuses where no ticket record exists for that head.
- **Q2 (live desk, corrections spent):** not the dead-desk arm while a worker lives. The one-writer rule forbids a fixer beside a live worker. Hold until the worker ends, then take arm 2. Name a stall bound so the hold reaches #2899's notifier.
- **Q3 (`trackerNone`):** hold, do not merge. CLAUDE.md says that `trackerNone` answers `unaskable` "on every operation including the write". *Decided* says that `success` is written "only when that HIGH's ticket exists". Merging unticketed breaks a Decided item. The hold must notify through #2899.
- **Q4 (two HIGHs):** one ticket per head listing every HIGH. `review.ts` already records one issue per PR and head (`issueFile`), the design names "the HIGH ticket" singular, and the status description has room for one reference.
- **Q5:** answered in (a). Read #2917 and #2914.
- New: does a HIGH correction to a live desk spend the CI correction budget, or the fixer attempts, or neither (seam 9)?
- New: after a fixer pushes a new head, the old review no longer applies (`headSha`). Does a new review on the new head that still holds the HIGH count as attempt 2 on "the same finding" for #2899?

## (e) Tests

- Rule slice: domain unit tests (vitest, `packages/domain/test/`), one per arm, each a table of readings. Include: a live fixer in the attempts file reads as alive; a corrections-spent desk with no failed fresh session does not start a fixer; attempts-spent answers "write ticketed success" and never "merge"; a missing or unparseable attempts file reads as zero.
- Ticket slice: board unit test with fake `Tracker` and `Host` ports. The success write refuses with no ticket record. `trackerNone` holds. The first review with a HIGH opens no issue (a regression test against `review.ts:486`).
- Tick-wiring slice: fleet unit test with a fake `agent-run` port: one fixer per PR across two consecutive pulses.
- Cross-plan: one test that feeds a ticketed-success head to #2914's merge arm and expects "merge".

## Amendments

1. Name #2898 (fixer role, runner) and #2899 (run log, stall rule) as prerequisites. Replace "name no plan yet" with PR #2917 and PR #2914.
2. Correct Q1's premise: `approve.ts:86-95` also writes `plot/review`. Answer Q1 as a controller write that refuses without a ticket record.
3. End arm 3 at the ticketed `success` write. Hand the merge to #2902, and ask #2914 to change its predicate from "no HIGH" to "`plot/review` is `success` on this head".
4. Add a slice, or a line in slice 2, that removes the HIGH issue-open on the first review. Order it after #2917's findings-comment slice.
5. State the tracker port change for the assignee (`tracker.ts:52`, `:123-130`), or drop the assignee.
6. Drop the plan-issue comment line. Define the HIGH ticket record (per PR and head) as the interface that #2905 renders and #2904 reuses.
7. Specify two fields of the attempts file: the finding each attempt answered (for #2899) and an in-flight marker (for the one-writer rule).
8. Settle the CI-red arm with #2906: one owner, with the condition "dead, or corrections spent and fresh session failed".
9. Add a tick-wiring slice for the correction write and the fixer start, waiting on #2898's runner and `fixer.md`.
10. Ask #2900 to own the review-record reader (HIGH count and findings per head) and the ordered arm table. This plan widens the input with desk, fresh-session and attempts readings.
