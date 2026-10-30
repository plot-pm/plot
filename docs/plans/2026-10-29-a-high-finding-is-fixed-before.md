# A HIGH finding is fixed before its PR merges, then ticketed

> fleetd answers a HIGH review finding on a slice PR with a fixer agent, up to two attempts per PR, and opens one ticket only after both attempts fail. A red CI run on a PR whose desk is dead or out of corrections starts the same fixer.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Issue:** #2903
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2912 merged
- **Started:** 2026-10-29, Jan Wloka, `feature/the-fixer-attempts-record`
- **Started:** 2026-10-30, Jan Wloka, `feature/fleetd-starts-the-fixer`

## Changelog

- A slice PR whose review on the current head holds a HIGH finding gets a fixer agent with the findings, up to two fixer attempts per PR. No second fixer starts on a PR while one runs, and a fleetd restart does not start one either.
- A red CI run on a slice PR whose desk is dead or out of corrections starts the same fixer, under the same two attempts.
- When both attempts are spent on a HIGH, fleetd opens one `ai-generated` ticket for the PR, links it from the PR, and writes `plot/review=success` on that head with the ticket named in the status description. The PR then merges through fleetd's ordinary merge with all its holds.
- A later head of the same PR with a HIGH adds its findings to the same ticket. No PR gets a second ticket.
- Where no ticket can be opened (no tracker that opens issues) or no status can be written (a host with no commit statuses), the PR holds and fleetd notifies. An unticketed HIGH never merges.
- When both fixer attempts answered the same finding, fleetd notifies once.

<!-- Board impact: none. No reader of `plot/review` reads its description: `reviewBypasses` (`packages/domain/src/rules/review-bypass.ts:44`) and reconcile §20a (`skills/plot/scripts/plot-reconcile-scan.sh:2647`) read the status state only, so an accepted HIGH and a clean review read alike there. The ticket record is new state under `.plot/state/`; #2905 renders it into the plan comment. -->

## Motivation

A HIGH finding waits for a master agent to start a fix agent. In the session of 2026-10-16 to 2026-10-29 the master agent started a fix agent for every HIGH finding and for every red PR whose desk was dead or out of corrections ([DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), *Intent*). When that session ends, the PR stays on `plot/review=failure`.

Today `packages/board/src/server/entry/review.ts:494` writes `failure` for any HIGH count above zero, and `openFollowUp` (`review.ts:269`) opens a follow-up issue for any finding of any severity (`review.ts:483-488`). Nothing reads a HIGH and starts a fix.

**A desk no longer holds its branch when a HIGH exists.** The reviewer starts only on green CI. On green CI the desk loop takes ROW 13 (`packages/domain/src/workflows/agent-loop.ts:461-477`): it seals the slice, writes `declaration`, `slice-spend` and `assignment-clear`, and the loop is free. The loop resumes an agent only on red checks, a dropped turn or a continuation (`packages/fleet/src/server/entry/worker-loop.ts:1848-1872`), and its `correctionText` comes from CI evidence only (`worker-loop.ts:1077`). A correction that fleetd writes to a sealed desk therefore reaches no agent. The design's arm "HIGH, desk alive → correction" has nothing to act on, so this plan drops it and sends every HIGH to a fixer (D2). Panel round 1 ran `workflows-agent-loop.test.ts` row 13 and confirmed the seal.

**A desk whose corrections are spent is not alive.** ROW 15 (`agent-loop.ts:503-509`) ends the loop with a `PLOT-BLOCKED` marker. Today `ending-action.ts:162` grants such a desk one fresh session.

**The fixer start has no owner today.** Nothing writes a fixer attempt or starts a fixer. A fixer runs in its own worktree, so `deskLoopAlive` (`packages/domain/src/rules/desk-loop-alive.ts:77`) answers `none` for the desk while the fixer runs. Without a record written before the start, the next tick or a restarted fleetd starts a second fixer on the same PR.

**The ticket write is not idempotent.** `Tracker.issueOpen` opens a second issue on a second call (`packages/domain/src/ports/tracker.ts:398-401`); the caller records what it opened. `openFollowUp` already holds the safe shape: a `pending` record before the ask, then the id (`review.ts:251-281`).

**A second writer of `plot/review` exists.** `writeApprovalStatus` (`packages/board/src/server/entry/approve.ts:87-95`) writes `success` on a plan PR's head with no review run. An accepted HIGH follows that precedent: a controller writes the status, the reviewer agent does not run again.

**The ticket port takes no assignee.** `IssueOpen` carries `title`, `body` and `labels` only (`tracker.ts:123-130`), and the port refuses a widening to an assignee (`tracker.ts:52-54`). Plans record no author field. This plan opens the ticket unassigned.

This plan depends on #2898 (the `fixer` role and its detached start), #2899 (the run log and its notifications), #2900 (the review arm of `rules/slice-pr-next.ts`, the `plot/review` reading in the PR index, and no review-time issue), #2902 (the merge arm) and #2905 (renders the ticket record). #2904 reuses this plan's ticket writer for its revert tickets (C5).

## Design

### Approach

The design's *The loop* table, *Tickets* table and *Decided* list bind this plan, as corrected by the decisions below. This plan adds the HIGH and CI-red arms to `rules/slice-pr-next.ts`, which #2900 creates. Each arm is an exported function with its own test file, so plans that add arms do not conflict in one `switch`.

**The arms.** Each pass answers exactly one next step for a slice PR, as a member of #2900's step union. #2900's composition order places arm 3 at step 4, arms 1, 4 and 5 at step 5, and arms 2 and 7 at step 6, all before the review and merge arms:

1. **HIGH on this head, no fixer in flight, attempts left** → `{ step: 'fixer', head, evidence: 'high' }`: start the `fixer` role with the findings of this head.
2. **CI red, desk dead or corrections spent, no fixer in flight, attempts left** → `{ step: 'fixer', head, evidence: 'ci-red' }`: start the `fixer` role with the CI evidence.
3. **Fixer in flight** → `{ step: 'hold', reason: 'fixer-in-flight' }`.
4. **HIGH on this head, attempts spent, no ticket recorded** → `{ step: 'ticket', head }`: open the ticket.
5. **HIGH on this head, attempts spent, ticket recorded, no accepted `success` on this head** → `{ step: 'write-status', head, state: 'success', description, why: 'ticket-accepted' }`: write the accepted `success`.
6. **Accepted `success` on this head** → `none` here; #2902's merge arm takes the PR.
7. **CI red, attempts spent** → `{ step: 'hold', reason: 'ci-red-attempts-spent' }`; #2899's idle-slice rule notifies.

A `fixer` or `ticket` field of the input record that reads `unread` answers `{ step: 'hold', reason: 'unread' }`.

**Readings.** The arms read #2900's input record to `slicePrNext` and define no reading of their own. "HIGH on this head" reads `row.plotReview` as `failure` with `row.plotReviewSha` equal to `row.headSha` (#2900, `feature/the-index-records-the-review`); `review.ts:494` writes `failure` only for a HIGH. "CI red" reads `row.ciChecks` as `failing` with `row.checksSha` equal to `row.headSha`. It never reads `checks`, which folds `plot/review` in and reads a HIGH as `failing`. "Desk dead" reads the `desk` field, #2900's `deskDead` answer (`rules/desk-dead.ts`). A row with no `plotReview` or `ciChecks` field (not asked) answers `none`. The findings text comes from the verdict file `reviews/<pr>-<sha>.md` (`review.ts:413-415`). A failed or partial read is `unread` and holds; it never reads as "no review" or "no HIGH".

**The attempts record** lives under `.plot/state/` in the common git dir, keyed per PR, written by one place. Each attempt records the head SHA it was started for, the finding it answered (the HIGH findings' hash, or `ci` with the run id), and an in-flight mark with pid and start time. The tick writes the attempt and its in-flight mark BEFORE it starts the fixer, and refuses the start when that write does not land. A crash between the write and the start spends an attempt and adds no writer. A fixer that ends without a push spends its attempt. A missing or unreadable record reads as zero attempts, and an unreadable in-flight mark holds.

**The fixer start** takes the per-desk continue lock, so a person's `/plot-continue` or the unblocker (#2901) refuses while a fixer runs on the branch. The fixer gets the head SHA it was started for and pushes without force, so a concurrent push makes it fail rather than overwrite. Before the start the tick re-asks the host for the PR's state and head and refuses by name (`pr-not-open`, `head-moved`).

**The CI-red condition** reads "desk dead" as `deskDead` answering `{ dead: true }`; `live`, `elsewhere` and `waiting` are not dead, and `unread` holds. "Corrections spent" reads the desk's ending: a desk ended with `corrections-spent` gets its fresh session from `ending-action.ts:161` first, and the fixer starts when that session has also ended. That desk holds the loop's own `PLOT-BLOCKED` marker (ROW 15, `agent-loop.ts:503-509`), so `deskDead` reads it `waiting`; the arm takes the ending, not `deskDead`, for this case. This plan owns every fixer start on a desk that has a PR. A dead desk with no PR is not this plan's, and no plan sends it a fixer: #2906 gives it the `unreadable` ending, so the existing bound arm starts one fresh session and then asks a person (C4).

**The ticket record** lives under `.plot/state/` in the common git dir, keyed per PR: `pending` before the tracker is asked, then the ticket id. A `pending` record holds and names the file to check, as `openFollowUp` does. Each later head whose review holds a HIGH comments its findings on the same ticket before its `success` is written. The ticket opens through the tracker resolution `reviewTracker` (`review.ts:576`) that `plot-review` uses today; this plan moves that resolution to an adapter export so fleetd reaches it. The ticket is labelled `ai-generated` and links the PR; the PR gets a comment that links the ticket.

**The accepted `success`.** It is #2900's `write-status` step with the reason `ticket-accepted`; the tick applies the step. A domain rule `reviewStatus(counts, ticket)` answers the state and description, and `review.ts` uses it for every write. It answers `success` for a HIGH only with a confirmed ticket, and the write refuses unless this head's review has a HIGH, the attempts record holds two attempts for this PR, and the tracker confirms the ticket on a fresh read. The description names the ticket and the run marker within the host's 140-character cap (`packages/board/test/unit/review.test.ts:171-177`). The write uses `REVIEW_CONTEXT` through `host.commitStatus`; where that answers `unaskable` (`packages/domain/src/ports/host.ts:359-373`), the PR holds and fleetd notifies.

**Every step is logged** to #2899's run log: fixer start, attempt spent, ticket opened, accepted `success` written.

**A HIGH on a repair PR is not this plan's.** #2904's main-repair PR skips the fixer and goes to the revert (C5, an exception to D2), so no arm here answers on the PR that #2904's repair record names. #2904 opens its revert ticket through this plan's ticket writer, for a Delivered and an Approved plan alike (C5).

**What stays as it is:** the ruleset keeps requiring `plot/review`; the fleet gets no bypass rights; a clean review merges as before; the desk loop is unchanged.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-a-high-finding-is-fixed-before/panel.md`):

- [x] D2: every HIGH goes to a fixer, two attempts per PR, then the ticket. The arm "HIGH, desk alive → correction" is dropped, because the desk seals and releases the branch on green (`agent-loop.ts:461-477`) before any review exists. The desk loop is unchanged.
- [x] D1: this plan calls none of the refusing controllers itself. The merge after the accepted `success` is #2902's in-process merge with fleetd's typed caller. The fixer start takes the per-desk continue lock, so an unattended or personal `continue` refuses while a fixer runs.
- [x] D4: the merge of a ticketed PR is #2902's merge and runs as the `Merger app` bot under the ruleset, never through the admin bypass.
- [x] D5: the `fixer` role is #2898's `.claude/agents/fixer.md`, loaded from the default branch's copy with its per-role settings file. fleetd creates the fixer's worktree itself.
- [x] D6: the attempts record and the ticket record live in `.plot/state/` under the common git dir on the fleet's machine. #2905 renders the ticket record into the plan comment and keeps its lines on a write from another machine.
- [x] One ticket per PR, not per head or per finding. Each later head's HIGH findings go to that ticket as a comment.
- [x] A controller writes the accepted `success`, gated by `reviewStatus(counts, ticket)`, with `approve.ts:87-95` as the precedent. The reviewer agent does not run again.
- [x] The attempt and its in-flight mark are written before the fixer starts, and the start refuses when the write does not land.
- [x] With no tracker that opens issues, or no host that writes statuses, the PR holds and fleetd notifies. An unticketed HIGH never merges.
- [x] The ticket opens unassigned. The tracker port refuses an assignee (`tracker.ts:52-54`) and plans record no author.
- [x] The plan-issue comment line belongs to #2905, which renders this plan's ticket record.
- [x] C5: #2904 reuses this plan's ticket writer for the ticket that returns reverted work. A HIGH on #2904's repair PR goes to the revert, not to this plan's fixer.
- [x] The arms use #2900's names (decisions map, #2900's interface names): they read `ciChecks`, `plotReview` and `plotReviewSha` from the index row and `deskDead` from the input record, and answer #2900's `fixer`, `ticket`, `write-status` and `hold` steps. The accepted `success` is a `write-status` step with the reason `ticket-accepted`.
- [x] The review-time follow-up issue for every severity is removed by #2900 (`feature/a-review-opens-no-issue`), so one HIGH yields at most one ticket.

### Open Questions

- [ ] Two fixer attempts per PR cost an opus run per attempt per HIGH, and no measurement yet shows how often the first attempt clears a HIGH. Is two the right budget? The run log (#2899) supplies the figure once this ships.
- [ ] Does the ticket need an assignee? That needs a port change across every tracker connector against `tracker.ts:52-54`, and a source for the plan's author.

## Slices

### Fixer attempts record

- `feature/the-fixer-attempts-record` — the per-PR attempts record under `.plot/state/`: the head SHA and the finding each attempt answered, and an in-flight mark written before the start; a decode in the domain where a missing or unreadable record reads as zero attempts and an unreadable in-flight mark holds <!-- builds: a per-PR fixer attempts record with an in-flight mark --> → #2930

### Fixer start

- `feature/fleetd-starts-the-fixer` — the HIGH and CI-red arms of `rules/slice-pr-next.ts`; fleetd owns every fixer start on a desk that has a PR: HIGH on this head, and CI red with the desk dead or corrections spent; writes the attempt first, takes the per-desk continue lock, re-asks the host before the start, logs each step <!-- waits: feature/role-agents-start-detached --> <!-- waits: feature/fleetd-reviews-slice-prs --> <!-- builds: the fixer arms and their tick -->

### HIGH ticket

- `feature/an-unfixed-high-is-ticketed` — the per-PR ticket record (`pending`, then the id) and the tracker resolution as an adapter export; `reviewStatus(counts, ticket)` gates the accepted `success` naming the ticket; the merge stays #2902's; the notification when both attempts answered the same finding <!-- builds: the HIGH ticket record, reviewStatus, the accepted plot/review success -->

## Notes

- Source: issue #2903 on plot-pm/plot, plan PR #2912. Section of the design: *The loop*.
- Owned elsewhere: the `fixer` role definition and its detached start (#2898, `feature/role-agent-definitions`, `feature/role-agents-start-detached`); the run log and the idle-slice notification (#2899, `feature/the-loop-keeps-a-run-log`, `feature/an-idle-slice-notifies`); the review arm, the `plot/review` index reading and the removal of the review-time issue (#2900, `feature/fleetd-reviews-slice-prs`, `feature/the-index-records-the-review`, `feature/a-review-opens-no-issue`); the merge arm that reads `plot/review=success` on this head (#2902, `feature/fleetd-merges-one-at-a-time`); the plan-comment rendering of tickets (#2905, `feature/the-plan-comment-renders-records`); the revert ticket that reuses this plan's ticket writer (#2904, `feature/a-red-main-is-reverted`). #2906 starts no fixer and no restart (C4).
- Out of scope: MEDIUM and LOW findings (a PR comment, no ticket, per #2900), the red-main path (#2904), and a HIGH on #2904's repair PR (C5).
