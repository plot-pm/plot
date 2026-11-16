## Implementation brief — a-merge-ignores-an-unanswered-human (wave 2: a merge refuses an unanswered human comment)

- **Plan (canonical):** `docs/plans/2026-11-09-a-merge-ignores-an-unanswered-human.md` on `main`
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3328 merged
- **Branch:** `bug/a-merge-refuses-an-unanswered-human-comment` (base: `sprint/idle-and-supersede`, see *Base* below)
- **Ends as:** one PR to the base, opened with `plot-open-pr.sh`
- **Review of the code:** `plot/review` required on `main`; issue #3327

Wave 1 (`bug/the-host-reads-a-pr-conversation`, PR #3455) merged on 2026-11-15 at 21:29Z. This slice builds the rule and the refusals on the reading Wave 1 added, and it is the last slice the plan holds.

### Base

**Cut from `origin/sprint/idle-and-supersede`, not from `main`.** #3455 merged into that sprint branch (merge commit `d83a91c4d`), and the integration PR #3460 into `main` was still open when this brief was written. Measured 2026-11-15: `git grep prConversation origin/main -- packages` finds nothing, and the same command on `origin/sprint/idle-and-supersede` finds `ports/host.ts`, `adapters/host/pr-conversation.ts`, `host-fixture.ts` and `host-shell.ts`. A branch cut from `main` has no `Host.prConversation` and cannot typecheck. If #3460 has merged when you start, `git merge-base --is-ancestor origin/sprint/idle-and-supersede origin/main` answers 0 and `main` is the base. Run it before you cut.

### What to build

On 2026-11-09 at 15:18, #3304 (LICENSE says MIT) merged through `plot-ask.mjs merge` on green CI and a passing `plot/review`. Max Albrecht had asked on that PR at 14:32 ("why not the other way around, everything should be CC-0?") and nobody answered. `mergeAt` read the head, the checks, `plot/review` and the default branch, and none of the conversation. Wave 1 added the read. This slice adds the refusal in three places:

1. **The rule.** `humanCommentOpen(conversation)` in a new `packages/domain/src/rules/human-comment-open.ts`, pure, taking the `PrConversationReading` (`{ prAuthor, rows }`, `ports/host.ts:252-275` on the sprint branch) and answering either no open comment, or the oldest open comment with its login, time, first line, the count of the others, and the newest time over all rows.
2. **The reading and the refusals.** `MergeReadings` gains `conversation: PrConversationReading | 'unaskable'`, and `MergeRefusal` gains `human-comment-open` and `human-comment-unread`. `mergeAt` reads `ports.host.prConversation(pr)` next to `prReview` (`merge.ts`, in the `Promise.all` with `prReview` and `reviewWriter`) and maps a `failed` or `unaskable` result to `'unaskable'`. `merge()` refuses `human-comment-unread` on it. Place the check after `review-not-passed` and before the default-branch block, so a PR with a green review and an open question reports the question. The conversation is read only after the cheaper refusals could not apply: a draft or red PR must not cost three REST pages. `mergeAt` calls the host for it only where `merge()` would reach the check, or reads it always and orders the check last; choose by reading the existing `prReview` call, which is always read.
3. **fleetd.** `mergeTick` (`packages/fleet/src/shared/auto-merge.ts`) skips a PR refused `human-comment-open` or `human-comment-unread` and asks the next candidate in the same pass. See *fleetd must not stall*.

`plot-ask.mjs merge` and `release-approve` (`release-approve.ts:215` calls `mergeAt`) reach the refusal through `mergeAt` with no change. `release-approve.ts` types its refusal as `ReleaseApproveRefusal | MergeRefusal | 'host-refused'`, so the new names flow through; run the typecheck to see it.

### The decisions the plan settles — do not re-derive them

**The reading of "open" is the plan's, settled 2026-11-09 by Jan Wloka and the plan review.** Read the plan's *Reading of "open"* list and implement it as written:

- A human comment is a row of kind `issue`, `inline` or `review` by an account whose `type` is not `Bot`, whose body carries no `<!-- plot-… -->` marker. `Bot` never counts; a marked comment never counts and never answers.
- A comment by `prAuthor` opens nothing.
- A comment is answered by a later unmarked non-`Bot` comment from a different login, or by any later `APPROVED` review from any login, the commenter's own included. A later commit does not answer. An answer is PR-wide, not per thread, and that is the accepted trade-off.
- "Later" compares `time` (`created_at`, `submitted_at` for a review), and an edit never moves it.
- The refusal names the oldest open comment's login, time and first line, and the count of the rest.

**An empty `type` is a person. This overrides a line in the Wave 1 brief.** The Wave 1 brief said "an empty type is not `User`, and wave 2 treats it as no human". The plan's Notes of 2026-11-09 say otherwise: *an unknown or unmeasured `user.type` counts as a person, the strict side.* The Bitbucket fold maps `user` to `User`, `app_user` to `Bot` and anything else to `''` (`rules/bitbucket-pr-reading.ts:169`), and no app comment existed on the ewz-kus-portal PRs sampled, so `''` is the only reading a Bitbucket person can get. Implement `type !== 'Bot'`, not `type === 'User'`. The test that catches it: a Bitbucket-shaped row with `type: ''` opens a hold. A rule written `type === 'User'` passes every GitHub test and silently exempts every Bitbucket person.

**Absent is not "no comment".** A `failed` or `unaskable` read refuses `human-comment-unread`, never an empty list and never a pass. Wave 1 never turns a failure into `[]`, and the refusal exists only if this slice never does either. The same invariant the PR index keeps, measured 2026-08-27 when an empty result read as "no PRs" and refused four fully merged plans.

**The conversation is never read from the PR index.** The index decides whether to try. A merge cannot be undone, so the reading is taken inside `mergeAt`, as fresh as the checks and the review (*A Decision Reads The Index* in `CLAUDE.md`).

**No override flag.** The way through is a reply or an `APPROVED` review. Do not add a `--force`, an env variable or a `viaReleaseApprove` exemption: a release PR and a repair PR are held the same as any other (settled in the plan's Open Questions).

**Where the plan is silent, take the strict side and write it into the plan's `## Notes`.** Strict means the merge holds, which a person undoes with one reply. Three cases:

- A tie in `time` between a comment and its candidate answer is not "later". A merge held on a same-second reply asks for one more reply; a merge released on it cannot be taken back.
- A `PENDING` review has `time: ''`, is not a comment and answers nothing. A time that does not parse answers nothing.
- A review in state `APPROVED` opens nothing, because it is the answer. `COMMENTED` and `CHANGES_REQUESTED` bodies open a hold, as the plan says. A `DISMISSED` review's non-empty body counts as a comment; an empty body on any review is not one.

**fleetd must not stall on one held PR.** `nextMerge` (`slice-pr-next.ts:399`) picks the lowest-numbered PR whose step is `merge`, and `mergeTick` asks `mergeAt` for that one. The refusal is decided inside `mergeAt` and never reaches the index, so with no change every tick picks the same PR and no higher-numbered PR ever merges. Only `host-refused` is skipped today, through `MergeRefusals = Map<number, string>` keyed by PR with the head as the value.

- Keep a second record, (PR, head, time), for `human-comment-open` and `human-comment-unread`. Add it as a trailing optional parameter of `mergeTick` so every existing caller and test keeps compiling, and keep it across passes the way the caller keeps `refused`.
- Skip a PR while its record's head equals the row's head and the row's `updatedAt` is not newer than the recorded time. Compare with `Date.parse`; a time that does not parse counts as changed. Skipping means mapping that PR's step to `{ step: 'none', why: … }` before `nextMerge`, as the `host-refused` skip does at `auto-merge.ts:183-187`, so the next candidate is tried in the same pass.
- **Record the later of the refusal's `conversationAt` and the row's own `updatedAt`, not `conversationAt` alone.** The plan says the record keeps the newest conversation time it read. `updatedAt` moves on a label, a title edit or a review request, none of which the conversation read sees. A record of `conversationAt` alone then re-asks every tick for as long as the row's `updatedAt` stays ahead of it, and the stall comes back at the cost of three REST calls per tick. `human-comment-unread` reads no time at all, so the row's `updatedAt` is the only value it has. `conversationAt` is the newest `time` over every row the read returned, marked and `Bot` rows included, so Plot's own marked comment moves it.
- `MergeResult`'s refused arm gains an optional `conversationAt?: string`, filled by the two new refusals.
- A new comment, a new review or a new head clears the record by the comparison above. Nothing deletes it.

**Shell collects and the domain decides** (Manifesto principle 3, `docs/shell-and-domain.md`). This slice touches no `.sh` file and adds no `jq`. The rule is TypeScript in `packages/domain/src/rules/`. A new function is an arrow (`export const f = (…) => …`), and a TSDoc block says what an export does and how it fails, without the history of the decision.

### Done when

The plan's slice line is the specification (it has no `## Done when` list). Its tests, and the assertions a naive implementation would pass without:

- **An unanswered comment refuses `human-comment-open`; a later reply by another person and a later `APPROVED` review each merge.** The reply fixture must be by a different login. A rule that compares only times lets a commenter answer themselves.
- **A comment by `prAuthor` does not block.** Fleet PRs are opened under the operator's account, and GitHub does not let an author approve their own PR, so without this exemption a note by the author can be cleared only by another person.
- **A marked comment does not block and does not answer.** The second half needs a fixture where a marked comment by the operator account follows a person's question: the merge must still refuse. A rule that drops marked rows from "open" but keeps them as answers passes the first half and fails this one.
- **A `Bot` comment does not block; a `type: ''` row does.** See *An empty `type` is a person*.
- **A `failed` read and an `unaskable` read each refuse `human-comment-unread`.** `host-fixture.ts` answers `failed` for a PR number not in `conversations`, which gives the first for free.
- **The refusal names the oldest open comment** when two are open, with the count of the other.
- **`mergeAt` makes no merge call on either refusal.** Assert that `scripts.hostSaid` is never asked `pr-merge`, as the existing `default-branch-unsettled` cases do (`workflows-merge.test.ts:461`).
- **`mergeTick` skips a PR refused `human-comment-open` and merges the next candidate in the same pass.** Two OPEN rows, the lower-numbered held, the higher one clean: the higher merges. Without the skip the lower one is picked on every pass.
- **A skipped PR is asked again once its row's `updatedAt` or head moves, and not before.** Three passes: unchanged (no `mergeAt` call for it), `updatedAt` newer (one call), head different (one call).
- **A held PR whose only change is a marked Plot comment is asked once, not on every tick.** This catches a record that keeps `conversationAt` alone.
- **`plot-ask.mjs merge` reaches the refusal.** A test through `packages/board` that runs the merge entry with a conversation holding an open comment, and expects `{ merged: false, reason: 'human-comment-open' }` with exit code 1.
- **A `release-approve` call reaches it too**, in `workflows-release-approve.test.ts` or the board's release test: a release PR with an open human comment refuses, and nothing merges.

Plus the repo's gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Run the domain, board and fleet typechecks, not only the domain's: `MergeRefusal` and `MergeReadings` are consumed by all three. Every existing `merge()` test builds a `MergeReadings`; the new `conversation` field makes each a type error unless the shared `readings()` helper in `workflows-merge.test.ts` supplies a clean conversation by default.

The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. A generated bundle under `skills/plot/scripts/board/` must not appear in the diff (`check-no-bundle-diff.sh`); run `pnpm build:board` only to test locally and restore the generated paths before you push.

A changeset is required, description first and the `bumps:` block last, package `plot`, with `plan: docs/plans/2026-11-09-a-merge-ignores-an-unanswered-human.md` inside the block. Model it on `.changeset/the-host-reads-a-pr-conversation.md` on the sprint branch. The plan carries its own `## Changelog` line; use it. Do not edit versions by hand.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Record the three strict-side readings above in the plan's `## Notes`.

### Scope guard

This branch owns: `packages/domain/src/rules/human-comment-open.ts` and its test, `packages/domain/src/workflows/merge.ts`, `packages/domain/test/workflows-merge.test.ts`, `packages/fleet/src/shared/auto-merge.ts` and `packages/fleet/test/unit/auto-merge.test.ts`, one board test for `plot-ask.mjs merge`, and the changeset.

It does not own `ports/host.ts`, `adapters/host/pr-conversation.ts`, `host-fixture.ts`, `host-shell.ts` or `rules/bitbucket-pr-reading.ts`: Wave 1 shipped them and the plan holds no other slice for them. If the reading lacks something the rule needs, report it rather than widening the reading here.

`bug/the-host-reads-a-pr-conversation` is merged and is the only other branch the plan holds. Sprints owned by other sessions (`card-alignment`, `desk-probes-and-liveness`, `the-board-reads-the-channel`, `triggers-and-connectors`) touch other files; `sprint/idle-and-supersede` itself carries 25 commits not on `main`, among them `auto-merge.ts` and `default-branch-refresh.test.ts` changes, so fetch before you cut and rebase onto the base, not onto `main`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
