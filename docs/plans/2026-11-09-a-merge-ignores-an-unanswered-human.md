# A merge ignores an unanswered human comment on the PR

> `mergeAt` reads the PR's human conversation and refuses `human-comment-open` while a person's comment has no answer, and `human-comment-unread` when it cannot read the conversation.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** ship-2-32-0
- **Issue:** #3327
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3328 merged
- **Started:** 2026-11-09, Jan Wloka, `bug/the-host-reads-a-pr-conversation`

## Changelog

- A merge through `plot-ask.mjs merge` or fleetd's merge arm refuses `human-comment-open` while a PR holds a comment from a person that nobody has answered, and the refusal names the comment's author, time and first line. A conversation the host cannot read refuses `human-comment-unread`.

<!-- Board impact: none. No change to the plan format, the template, the helper scripts' plan contract or the docs/plans layout. `plot-host.sh` gains one read op and the `Host` port one method. -->

## Motivation

On 2026-11-09 at 15:18, #3304 (LICENSE says MIT) merged through `plot-ask.mjs merge` on green CI and a passing `plot/review`. Max Albrecht (eins78) had asked on that PR at 14:32: "why not the other way around, everything should be CC-0?". Nobody answered. The merge settled an open licensing decision between the maintainers by default, and the change needed a revert.

The rule "read human PR comments before merging" exists only as a master agent's memory. A rule depends on the agent choosing to follow it, and the same merge can happen again from any session or from fleetd's merge arm. `mergeAt` reads the head, the checks, `plot/review` and the default branch, and none of the PR's conversation. This plan turns the rule into a refusal in `mergeAt`, which both callers already go through (`packages/board/src/server/entry/main.ts:171`, `packages/fleet/src/shared/auto-merge.ts:200`, and `release-approve` through `mergeAt` at `packages/domain/src/workflows/release-approve.ts:215`).

## Design

### Approach

**One rule in the domain, one read through the host port.** `merge(readings, input)` takes a new reading, `conversation`, and a pure rule `humanCommentOpen(conversation)` in `packages/domain/src/rules/` decides it. `mergeAt` fills the reading through a new `Host` method, and the shell adapter reads it through a new `plot-host.sh` op. The reading is taken inside `mergeAt`, next to `prReview`, so it is as fresh as the checks and the review. It never comes from the PR index: the index decides only whether to try, and a merge cannot be undone (see *A Decision Reads The Index*).

**Reading of "open", settled 2026-11-09 (Jan Wloka and the plan review):**

- A **human comment** is an issue comment, an inline review comment or a review body written by an account of type `User`, whose body carries no Plot marker (`<!-- plot-… -->`). Accounts of type `Bot` never count. The comments Plot posts through `pr-comment` carry a marker, so they never count (today `review.ts:545` and `state-sync.ts:137` are its only callers, both with a marker). An empty review body with no inline comments is not a comment.
- A comment from the **PR author's account** opens nothing (Jan Wloka, 2026-11-09). Fleet PRs are opened under the operator's account, and GitHub does not let an author approve their own PR, so an author's note could otherwise only be cleared by another person. Only comments from other accounts can hold a merge.
- A human comment is **answered** when a later *human comment* (unmarked, from a `User` account) by a different account replies, or any account submits an `APPROVED` review after it. A marked comment never answers, so a review's findings comment posted under the operator's account cannot clear a person's question. A later commit alone does not answer a question.
- **The trade-off of a PR-wide answer:** an answer is not tied to its thread, so any later human comment by another account anywhere on the PR answers every earlier open comment. Threads are only readable through GraphQL; the REST-only read accepts that a remark on an unrelated thread clears an open question. A person who wants a question to hold replies to it. "Later" compares the host's `created_at`; an edit does not move it.
- The refusal names the **oldest** open comment's author, time and first line, and the count of the rest.
- The conversation is read over REST: `GET …/issues/<n>/comments`, `…/pulls/<n>/comments`, `…/pulls/<n>/reviews`, all pages. A failed or partial read refuses `human-comment-unread`. Absent is not "no comment" (the same invariant as the index's *never says no*).

**fleetd's merge arm needs a change.** `plot-ask.mjs merge` and fleetd's merge arm both call `mergeAt`, so the refusal reaches both. But `nextMerge` (`slice-pr-next.ts:399`) picks the lowest-numbered PR whose index step is `merge`, and `mergeTick` (`auto-merge.ts:198-201`) asks `mergeAt` for that one PR; only a `host-refused` outcome is skipped on later passes. `human-comment-open` is decided inside `mergeAt` and never reaches the PR index, so without a change every tick picks the same PR and no higher-numbered PR merges. So `mergeTick` records a `human-comment-open` or `human-comment-unread` refusal under (PR, head, the newest conversation time it read) and skips that PR while all three are unchanged, then asks the next candidate in the same pass. A new comment, a new review or a new head clears the record. `mergeTick` detects the change without a host call: the index row's `updatedAt` moves on any comment, review or push, so a skipped PR is asked again only when its row's `updatedAt` is newer than the recorded time or its head differs. The `human-comment-open` and `human-comment-unread` refusals carry the newest conversation time they read, which is the time the record keeps. A person answers the comment, and the merge then goes.

### Open Questions

- [x] **Who answers.** The issue says "a later comment by a different person". Does the PR's author answering their own reviewer count? A reviewer's question is answered by the author in the common case, so "different from the commenter" is the proposed reading. A comment by the author themselves (a note, not a question) is then open until somebody else replies. Should the PR author's own comments be exempt from counting as open? → Settled by Jan Wloka, 2026-11-09: a later reply by any account other than the commenter answers it, the PR's author included. A comment from the PR author's own account opens nothing (see *Reading of "open"*), so the author never needs to answer their own note.
- [x] **A resolved review thread.** GitHub marks inline threads resolved, but only through GraphQL, which has its own rate limit and was exhausted on 2026-11-09. Proposal: REST only, and a resolved thread still counts as open until a reply or an approval follows. A person resolves by replying. → REST only. A resolved thread still counts as open until a reply or an `APPROVED` review follows.
- [x] **Bitbucket.** `plot-host.sh` has no verified `pr-comment` write there (`plot-host.sh:6057`). Proposal: the Bitbucket arm answers `unaskable`, so `mergeAt` refuses `human-comment-unread` on that backend until a REST read is added and measured against ewz-kus-portal. Is a refusal on every Bitbucket merge acceptable, or does the read ship for both hosts together? → Settled by Jan Wloka, 2026-11-09: the Bitbucket read ships in this plan, so Bitbucket merges keep working. It reads the PR's comments and approvals over Bitbucket's REST API and is measured read-only against ewz-kus-portal before the slice opens its PR. Until that measurement passes, the Bitbucket arm answers `unaskable` and `mergeAt` refuses `human-comment-unread`. The Wave 1 slice opens its PR only after that measurement passes, and Wave 2 waits for Wave 1 by wave order, so Wave 2 never runs while the Bitbucket arm answers `unaskable`.
- [x] **Release and repair PRs.** `changeset-release/` PRs and the repair record's PR carry bot-authored text. Proposal: no exemption, since a person's comment on them is just as unanswered. Confirm. → No exemption: a person's comment on a release or repair PR is just as unanswered.
- [x] **A person who wants it anyway.** The rule says a refusal is the end of the action. Proposal: no override flag; the way through is a reply or an `APPROVED` review. Confirm that an `APPROVED` review by the commenter themselves counts as answering their own comment. → Settled by Jan Wloka, 2026-11-09: no override flag. A reply or an `APPROVED` review answers the comment, and the commenter's own `APPROVED` review counts.
- [x] **Does a review `COMMENTED` or `CHANGES_REQUESTED` body count as a comment?** Proposal: yes for both, and a later `APPROVED` review by anyone answers a `CHANGES_REQUESTED` one. → Yes for both, and a later `APPROVED` review by anyone answers a `CHANGES_REQUESTED` one.

## Slices

### Wave 1

- `bug/the-host-reads-a-pr-conversation` — `Host.prConversation(pr)` returns the PR author's login and every issue comment, inline comment and review of a PR with author, account type, time, body and review state, over REST with all pages; `plot-host.sh pr-conversation <n>` is its shell op, and the Bitbucket arm reads comments and approvals over Bitbucket's REST API, measured read-only against ewz-kus-portal (the slice opens its PR only once that read-only measurement passes; until then the arm answers `unaskable`) <!-- builds: prConversation, a host read of a PR's comments and reviews -->

### Wave 2

- `bug/a-merge-refuses-an-unanswered-human-comment` — the pure rule `humanCommentOpen`, the `conversation` reading on `MergeReadings`, the refusals `human-comment-open` and `human-comment-unread` in `MergeRefusal`, and `mergeAt` reading the conversation through the port. Tests: an unanswered comment refuses; a later reply by another person and a later `APPROVED` review merge; a Plot-marker comment and a `Bot` comment do not block; a failed read refuses `human-comment-unread`; a comment from the PR author's account does not block; a marked comment does not answer; `mergeTick` skips a PR refused `human-comment-open` and merges the next candidate in the same pass, and asks the skipped PR again once its conversation or head changes; `plot-ask.mjs merge` reaches the refusal <!-- builds: humanCommentOpen, the rule behind the human-comment-open refusal -->

## Notes

- 2026-11-09, Jan Wloka: Wave 1's GitHub arm (pushed at b04c6a089, no PR) grows `plot-host.sh` by 16 commands, which `scripts/check-shell-lines.sh pr` refuses. `pr-conversation` waits for the in-process GitHub adapter of plan `github-reads-in-process` (Seam slice PR #3338), and its Bitbucket arm for the matching in-process Bitbucket reads.
- 2026-11-09, Jan Wloka: the Bitbucket arm may ship with `user.type` unmeasured for app accounts (no app comment existed on the ewz-kus-portal PRs sampled, PR 3717). An unknown or unmeasured `user.type` counts as a person, the strict side.
- 2026-11-09: drafted from issue #3327. The master agent's memory entry "Read human PR comments before merging" is the rule this plan turns into a gate.
- Gate versus rule: the test "can you answer *did I complete this?* without doing the work" fails for the memory entry and passes for a refusal in `mergeAt`.
