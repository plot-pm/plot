# A merge ignores an unanswered human comment on the PR

> `mergeAt` reads the PR's human conversation and refuses `human-comment-open` while a person's comment has no answer, and `human-comment-unread` when it cannot read the conversation.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3327
- **Review:** pr
- **Impl:** own branches

## Changelog

- A merge through `plot-ask.mjs merge` or fleetd's merge arm refuses `human-comment-open` while a PR holds a comment from a person that nobody has answered, and the refusal names the comment's author, time and first line. A conversation the host cannot read refuses `human-comment-unread`.

<!-- Board impact: none. No change to the plan format, the template, the helper scripts' plan contract or the docs/plans layout. `plot-host.sh` gains one read op and the `Host` port one method. -->

## Motivation

On 2026-11-09 at 15:18, #3304 (LICENSE says MIT) merged through `plot-ask.mjs merge` on green CI and a passing `plot/review`. Max Albrecht (eins78) had asked on that PR at 14:32: "why not the other way around, everything should be CC-0?". Nobody answered. The merge settled an open licensing decision between the maintainers by default, and the change needed a revert.

The rule "read human PR comments before merging" exists only as a master agent's memory. A rule depends on the agent choosing to follow it, and the same merge can happen again from any session or from fleetd's merge arm. `mergeAt` reads the head, the checks, `plot/review` and the default branch, and none of the PR's conversation. This plan turns the rule into a refusal in `mergeAt`, which both callers already go through (`packages/board/src/server/entry/main.ts:171`, `packages/fleet/src/shared/auto-merge.ts:200`, and `release-approve` through `mergeAt` at `packages/domain/src/workflows/release-approve.ts:215`).

## Design

### Approach

**One rule in the domain, one read through the host port.** `merge(readings, input)` takes a new reading, `conversation`, and a pure rule `humanCommentOpen(conversation)` in `packages/domain/src/rules/` decides it. `mergeAt` fills the reading through a new `Host` method, and the shell adapter reads it through a new `plot-host.sh` op. The reading is taken inside `mergeAt`, next to `prReview`, so it is as fresh as the checks and the review. It never comes from the PR index: the index decides only whether to try, and a merge cannot be undone (see *A Decision Reads The Index*).

**Reading of "open", proposed for the reader to settle:**

- A **human comment** is an issue comment, an inline review comment or a review body written by an account of type `User`, whose body carries no Plot marker (`<!-- plot-… -->`). Accounts of type `Bot` never count. The comments Plot posts through `pr-comment` carry a marker, so they never count. An empty review body with no inline comments is not a comment.
- A human comment is **answered** when a later comment by a different person replies, or a person submits an `APPROVED` review after it. A later commit alone does not answer a question. "Later" compares the host's `created_at`; an edit does not move it.
- The refusal names the **oldest** open comment's author, time and first line, and the count of the rest.
- The conversation is read over REST: `GET …/issues/<n>/comments`, `…/pulls/<n>/comments`, `…/pulls/<n>/reviews`, all pages. A failed or partial read refuses `human-comment-unread`. Absent is not "no comment" (the same invariant as the index's *never says no*).

**Both callers need no second change.** `plot-ask.mjs merge` and fleetd's merge arm call `mergeAt`, so the refusal reaches both. fleetd treats a refusal as it treats `review-not-passed`: the PR waits and the next pass asks again. A person answers the comment, and the merge then goes.

### Open Questions

- [x] **Who answers.** The issue says "a later comment by a different person". Does the PR's author answering their own reviewer count? A reviewer's question is answered by the author in the common case, so "different from the commenter" is the proposed reading. A comment by the author themselves (a note, not a question) is then open until somebody else replies. Should the PR author's own comments be exempt from counting as open? → Settled by Jan Wloka, 2026-11-09: a later reply by any person other than the commenter answers it, the PR's author included. A comment by the author themselves stays open until another person replies or approves.
- [x] **A resolved review thread.** GitHub marks inline threads resolved, but only through GraphQL, which has its own rate limit and was exhausted on 2026-11-09. Proposal: REST only, and a resolved thread still counts as open until a reply or an approval follows. A person resolves by replying. → REST only. A resolved thread still counts as open until a reply or an `APPROVED` review follows.
- [x] **Bitbucket.** `plot-host.sh` has no verified `pr-comment` write there (`plot-host.sh:6057`). Proposal: the Bitbucket arm answers `unaskable`, so `mergeAt` refuses `human-comment-unread` on that backend until a REST read is added and measured against ewz-kus-portal. Is a refusal on every Bitbucket merge acceptable, or does the read ship for both hosts together? → Settled by Jan Wloka, 2026-11-09: the Bitbucket read ships in this plan, so Bitbucket merges keep working. It reads the PR's comments and approvals over Bitbucket's REST API and is measured read-only against ewz-kus-portal before the slice opens its PR. Until that measurement passes, the Bitbucket arm answers `unaskable` and `mergeAt` refuses `human-comment-unread`.
- [x] **Release and repair PRs.** `changeset-release/` PRs and the repair record's PR carry bot-authored text. Proposal: no exemption, since a person's comment on them is just as unanswered. Confirm. → No exemption: a person's comment on a release or repair PR is just as unanswered.
- [x] **A person who wants it anyway.** The rule says a refusal is the end of the action. Proposal: no override flag; the way through is a reply or an `APPROVED` review. Confirm that an `APPROVED` review by the commenter themselves counts as answering their own comment. → Settled by Jan Wloka, 2026-11-09: no override flag. A reply or an `APPROVED` review answers the comment, and the commenter's own `APPROVED` review counts.
- [x] **Does a review `COMMENTED` or `CHANGES_REQUESTED` body count as a comment?** Proposal: yes for both, and a later `APPROVED` review by anyone answers a `CHANGES_REQUESTED` one. → Yes for both, and a later `APPROVED` review by anyone answers a `CHANGES_REQUESTED` one.

## Slices

### Wave 1

- `bug/the-host-reads-a-pr-conversation` — `Host.prConversation(pr)` returns every issue comment, inline comment and review of a PR with author, account type, time, body and review state, over REST with all pages; `plot-host.sh pr-conversation <n>` is its shell op, and the Bitbucket arm reads comments and approvals over Bitbucket's REST API, measured read-only against ewz-kus-portal (`unaskable` until that measurement passes) <!-- builds: prConversation, a host read of a PR's comments and reviews -->

### Wave 2

- `bug/a-merge-refuses-an-unanswered-human-comment` — the pure rule `humanCommentOpen`, the `conversation` reading on `MergeReadings`, the refusals `human-comment-open` and `human-comment-unread` in `MergeRefusal`, and `mergeAt` reading the conversation through the port. Tests: an unanswered comment refuses; a later reply by another person and a later `APPROVED` review merge; a Plot-marker comment and a `Bot` comment do not block; a failed read refuses `human-comment-unread`; `plot-ask.mjs merge` and fleetd's `auto-merge.ts` both reach the refusal <!-- builds: humanCommentOpen, the rule behind the human-comment-open refusal -->

## Notes

- 2026-11-09: drafted from issue #3327. The master agent's memory entry "Read human PR comments before merging" is the rule this plan turns into a gate.
- Gate versus rule: the test "can you answer *did I complete this?* without doing the work" fails for the memory entry and passes for a refusal in `mergeAt`.
