# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2903 (`gh issue view`), DESIGN-delivery-loop.md, sibling plans #2900, #2902, #2906, #2898, #2899 and #2905, and the code at `packages/board/src/server/entry/review.ts`, `packages/domain/src/workflows/agent-loop.ts`, `packages/domain/src/rules/desk-loop-alive.ts`, `packages/domain/src/rules/review-bypass.ts`, `packages/domain/src/entities/pr-index.ts`, `packages/domain/src/ports/tracker.ts`, `packages/domain/src/ports/desk.ts` and `packages/fleet/src/server/entry/worker-loop.ts`. Ran `vitest run` on the domain tests `workflows-agent-loop`, `desk-loop-alive`, `review-verdict`, `review-issue`, `default-branch` and `fresh-agent` (6 files, 314 tests, all pass). Ran the board test `test/unit/review.test.ts --project parallel` (56 tests, all pass). Read their fixtures: `agentLoop({...freeLoop, ...})` readings and the board `rig()` with `hostFixture` and `trackerFixture`, which captures `statuses`, `issues` and `commented`.

## (a) Problem statement

- `review.ts:494` is correct: `const state = counts.high === 0 ? 'success' : 'failure'`. `openFollowUp` is at `review.ts:269` and is called for any finding at `review.ts:486-488` (`if (findings !== 0)`). The plan's description holds.
- The plan omits a cause that decides arm 1. **A desk whose CI is green holds no assignment for the branch any more.** `agent-loop.ts:459-478` (ROW 13) answers `seal(...)`, and `seal` (`agent-loop.ts:432-448`) writes `assignment-clear`. The executed test `workflows-agent-loop.test.ts:1166-1180` asserts the writes `['declaration', 'slice-spend', 'assignment-clear']`. #2900 starts the reviewer only on "CI green". So when a HIGH review exists, the desk's loop for that slice has already sealed and gone free. "Desk alive" in arm 1 has no reading that means "alive and still holding this branch". `desk-loop-alive.ts` answers whether a loop pid lives, and a free loop counts as alive. The design's call "a live desk gets HIGH findings as a correction" rests on a state that the loop does not keep after green CI. This is a fact the design missed.
- "The existing correction mechanism" (plan, *Approach* 1) is internal to the loop. `writeCorrection` is called only from the loop's own `agent-resume` decision (`worker-loop.ts:1863-1871`). `agent-loop.ts` has no reading for a review finding (`grep -ni review` finds none). If fleetd appends to `PLOT-CORRECTION.md` from outside, nothing resumes the agent.
- The board-impact comment says `plot-reconcile-scan.sh` reads the status description "as text today". The reader behind §20a, `rules/review-bypass.ts:10`, reads only `ReviewState` (`success|failure|pending|absent|unread`) and never reads the description. Today no reader can tell an accepted HIGH from a clean review.
- The PR index has no `plot/review` reading. `PrIndexRowSchema.review` (`entities/pr-index.ts:41`) holds GitHub's `reviewDecision` (`APPROVED|CHANGES_REQUESTED|REVIEW_REQUIRED|''`, `host-shell.ts:75`). The only per-head review record on disk is `<commonDir>/plot/state/reviews/<pr>-<sha>.md` (`review.ts:414-416`), which is the verdict text. The rule's "review on this head has a HIGH" input has no named source in this plan or in #2900.

## (b) Approach

- **Duplicate ticket.** #2900 removes follow-up issues only for MEDIUM and LOW findings. After #2900, a HIGH on the first review still opens an `ai-generated` follow-up issue through `openFollowUp` (`review.ts:486-488`). That issue exists before any fix attempt, which contradicts the Decided item "a ticket only if the fix fails". It also makes a second ticket when arm 3 opens "the HIGH ticket". This plan must stop `openFollowUp` for a HIGH, or reuse that issue as the HIGH ticket. The plan names neither.
- **Assignee is not on the port.** `IssueOpen` (`ports/tracker.ts:123-130`) carries `title`, `body` and `labels` only. "Assigned to the plan's author" needs a port widening, a change in every tracker connector, and a `trackerFixture` change. The plan template `.plot/templates/plan.md` has no author field (grep finds none), so "the plan's author" has no recorded source.
- **The success write.** A re-run of `reviewPr` reviews again and writes `failure` again for the same HIGH. The `success` write after the ticket must be a separate entry that takes `(pr, sha, ticket)` and runs no agent. The plan says "the reviewer writes", but `review.ts` has no such mode.
- **Unbounded fixer starts.** "A missing or unreadable file reads as zero attempts spent" lets an attempts write that keeps failing start a fixer on every pulse. Use the pattern from `openFollowUp` (`review.ts:281`, which writes `pending` before it asks): record the attempt before the start, and refuse the start when that record does not land.
- **Arm order against `fresh-agent`.** On `corrections-spent`, `ending-action.ts:162` sends the slice to `start-fresh` today. Arm 4 ("CI red, corrections spent → fixer") and #2906's "fresh session failed → fixer" must give exactly one step for one reading. Neither plan states the order.
- The layering rule holds for the rule slice as written. The plan has no tick slice, so it never calls the correction write, the fixer start or the attempts increment. #2906 states that it "needs #2903 (the fixer runner and the attempt count)", but this plan builds no fixer runner.

## (c) Slices

- **Missing: the tick slice.** Nothing executes arms 1, 2 and 4. No slice writes the correction, starts the `fixer` through `agent-run` with role `fixer` (#2898), or increments the attempts file. Without it, the Changelog sentence "gets ... a fixer agent when its desk is dead" is not true, and #2906's dependency on "the fixer runner" is not met. Add a slice `feature/a-high-finding-is-fixed-before-tick` that waits on `-rule`.
- **Missing: the arm-1 effect.** Arm 1 needs either a review reading in `agent-loop.ts` with an `agent-resume` arm, or a redefinition of arm 1 as "the desk still holds the branch", which ROW 13 makes rare. Settle this before the rule is built, or remove arm 1 and let every HIGH take the fixer path. That second choice amends a design call, so a person decides.
- **Remove from this plan:** "a line in the plan issue's marked comment". #2905's slice `feature/the-plan-issue-names-its-tickets` builds it from recorded state. Instead, this plan records the opened ticket in a readable state file, for example beside the attempts file, so that #2905 has a source.
- **Order:** the ticket slice ends in "merge", which is #2902's merge arm. Name `feature/slice-pr-next-merge-arm` as a wait of the ticket slice.
- One rule file, `rules/slice-pr-next.ts`, gets arms from four plans. Each arm needs its own exported function with its own test file, so that four branches do not conflict in one `switch`.

## (d) Open questions

- *Who writes `success`?* Evidence: `review.ts` is the only writer, through `deps.host.commitStatus` (`review.ts:517`), and the board rig captures every write in `r.statuses`. Recommendation: a new exported `acceptHigh(deps, pr, sha, ticket)` in `review.ts`. It has the same `REVIEW_CONTEXT`, runs no agent, and is called by the tick. That function is testable with the existing rig.
- *Desk alive with corrections spent?* After green CI the desk holds no assignment (ROW 13). After red CI with corrections spent, ROW 15 (`agent-loop.ts:504-510`) writes `PLOT-BLOCKED` and ends the slice, so the loop also stops holding it. In both cases the dead-desk arm is the reachable one. Evidence suggests arm 1 seldom fires.
- *`trackerNone`?* It answers `unaskable` on every write (CLAUDE.md, *The Layering Rule*). The plan must choose between a hold with a stall notification (#2899) and a merge with a PR comment that names the HIGH. A test pins each choice.
- *One ticket or one per finding?* `reviewVerdict` returns counts (`review-verdict.ts:27`), not a list of HIGH findings with identities. One ticket per PR head is the only shape the current verdict supports without a parser change.
- New question: does a fixer's push (new head) reset "attempts spent"? Attempts count per PR, so a third HIGH on a new head goes straight to the ticket. State this and test it.
- New question: what is the ticket-description format inside the 140-character status cap? The existing test `review.test.ts` asserts `description.length <= 140` for `99 HIGH findings; run <ts>`. A Jira URL plus a run marker can pass the cap.

## (e) Tests

| Slice | Tier | Fixture | Assertion | Needs live fleet/host/browser? |
|---|---|---|---|---|
| rule: each arm | domain unit (`packages/domain/test/slice-pr-next-high.test.ts`) | plain reading values: `checks`, `reviewHead`, `high`, `deskHolds` (or `deskAlive`), `correctionsSpent`, `attempts` | one test per row returns exactly one step kind; a review on an old head gives no HIGH step; `attempts: 2` gives `open-ticket`; corrections-spent plus a missing fresh-session record gives exactly one step (the order against `fresh-agent`) | no |
| attempts file | domain unit, decode plus an adapter test in a `mkdtempSync` dir | missing file, unparseable file, a `v` mismatch, two PRs | missing and unreadable read as 0; the counter is keyed per PR; a write that fails returns failure | no |
| attempts before start | fleet unit (tick) | fake `AgentRun` that records requests; attempts adapter whose write fails | no `run()` when the write fails; one `run()` with `role: 'fixer'` and the findings in the prompt when it lands | no |
| correction arm | domain unit on `agentLoop` (if arm 1 stays) | `freeLoop` plus a new review reading | gives `agent-resume` with the findings and `correction-count + 1`; a free loop gives no resume | no |
| no HIGH issue before attempts | board unit `review.test.ts` | `rig(FINDINGS)` | `r.issues` has length 0 for HIGH-only findings; the status is still `failure` | no |
| ticket then success | board unit `review.test.ts` | `rig()` with `trackerFixture` that is extended to record an assignee | one issue with `labels: ['ai-generated']` and the assignee set; then one status `success` whose description names the ticket id and has a length of 140 or less; a `prComment` links the ticket | no |
| no ticket, no success | board unit | `trackerFixture` with `issueOpen` failed, and one with `trackerNone` | `r.statuses` is empty (or holds no `success`); the output names why | no |
| end to end: the PR merges | e2e (CI only) | sandbox repository | after #2902 | yes; not a local gate |

Every acceptance criterion except "the PR merges" can be checked without a live fleet, a live host or a browser, if the plan names the readings as values. The merge needs #2902's tick and is CI-tier only.

## Amendments

1. Add a tick slice that executes arms 1, 2 and 4 (correction write, fixer start through `agent-run` with role `fixer`, attempts increment), so that #2906 has the "fixer runner" it waits on.
2. Name the rule's review input: the head SHA and HIGH count from `<commonDir>/plot/state/reviews/<pr>-<sha>.md` through `reviewVerdict`, or a new review record. The PR index's `review` field is GitHub's `reviewDecision` and cannot serve.
3. Resolve arm 1 against `agent-loop.ts` ROW 13: the desk has no assignment after green CI. Define "desk alive" as "holds this branch", or take the arm out and say so to the design's owner.
4. Stop `openFollowUp` for a HIGH (or reuse that issue as the ticket), so that no ticket exists before the attempts are spent.
5. Widen `IssueOpen` with an assignee and name the source of "the plan's author". The plan has no author field.
6. Name the success writer: an `acceptHigh(pr, sha, ticket)` entry in `review.ts` that runs no agent, and test the 140-character cap with a Jira-length ticket.
7. Record the attempt before the fixer starts, and refuse the start when the record does not land.
8. Drop the plan-issue comment line (it belongs to #2905), and record the opened ticket in a state file that #2905 reads.
9. Add `feature/slice-pr-next-merge-arm` (#2902) as a wait of the ticket slice, and state the arm order against `fresh-agent` and #2906.
10. Correct the board-impact note: `review-bypass.ts` reads the status state only, never its description.
