# Seams juror — pr-review accepts a plot/review status from any writer

Position: amend

The defect is real and the plan names the right reader for the merge. The plan is not buildable unattended as written: it covers one of three `plot/review` read paths, it states a false claim about the slice-PR rule, it leaves four open questions that change the port shape, and it says nothing about the existing contract tests whose fixtures carry no `creator`. Each gap below has a concrete amendment.

## Findings

### 1. The slice-PR rule does not read `pr-review` (claim is false)

- The plan's Motivation says `mergeAt` "and the slice-PR rule read the answer of `pr-review`". Only `mergeAt` (`packages/domain/src/workflows/merge.ts:366`), `releaseApproveAt` (`release-approve.ts:132`), the reviewer (`packages/board/src/server/entry/review.ts:303`, `:498`) and the bypass audit (`packages/board/src/server/entry/review-bypass.ts:62`) call `host.prReview`.
- `slicePrNext` (`packages/domain/src/rules/slice-pr-next.ts:181`, `:226`, `:284`, `:324`) and `releasePrepare` (`release-prepare.ts:199`, `:260-267`) read `plotReview`/`plotReviewSha` from the PR index. fleetd fills those from `pr-list --rich` (`skills/plot/scripts/plot-host.sh:4803`) over `gh pr list --json statusCheckRollup`.
- Ran: `gh pr view 3067 --json statusCheckRollup` returns `{"__typename":"StatusContext","context":"plot/review","startedAt":…,"state":"SUCCESS","targetUrl":…}` — no creator field. The rollup also holds one status per context (the newest), so after a forged `success` the index reads `success` and the App's `failure` is gone from that reading.
- Consequence after the planned change: the index says `success`, so the review arm finds nothing to do (`slice-pr-next.ts:290-292`), the HIGH/fixer arm reads `no-high` (`:227`), and the merge arm selects the PR (`:324`). `mergeAt` then refuses `review-not-passed` and `mergeTick` records the (PR, head) as refused. The PR stays parked with no fixer and no named hold on the board. The merge is safe; the sprint goal (zero interventions) is not served, and the board shows a lie.

### 2. Three readers, three shapes, and the plan names one

- GitHub REST `/statuses` (the `pr-review` arm, `plot-host.sh:4394-4396`) carries `creator.login`, `creator.type`, `creator.id`. Ran: on PR #3067 the App's statuses read `creator.login = "plot-review[bot]"`, `type = "Bot"`, `id = 342578638`. No App id is on the status.
- GitHub GraphQL `StatusContext.creator.login` reads `"plot-review"` — no `[bot]` suffix (ran the query on #3067). An implementer who compares logins across the two arms with one constant gets a mismatch on one of them.
- `gh pr list/view --json statusCheckRollup` (index arm, and `pr-state --with-checks` at `plot-host.sh:4087`) carries no creator at all.

### 3. Open Question 1 has an answer in the repo and on the host

- Ran: `gh api apps/plot-review` returns `{"id":5317669,"slug":"plot-review"}`. The ruleset's `integration_id` for `plot/review` is the App id (`docs/review-status-rollout.md:75`, the #3070 plan cites integration 5317669). So `Review app`'s first field is the ruleset's integration id.
- The status carries the bot login, not the App id. The mapping id → slug needs `GET /app` with the App JWT. `appJwt` and `call` already exist in `skills/plot/scripts/plot-github-app.mjs:66-89`, and `resolveApp` (`:45-62`) reads the key. No new config key is needed.
- A login of the form `<slug>[bot]` cannot belong to a user account (brackets are not legal in a user login), so equality with `<slug>[bot]` and `creator.type == "Bot"` is a sound check on the REST arm.

### 4. Approach contradicts its own layering line

- Approach: "The GitHub arm reads each status's `creator` and keeps a `plot/review` status only when its writer matches". Layering line: "the identity comparison is a rule the domain owns, and `pr-review` stays a reading that reports the writer". These are two different designs (filter in jq, or report in shell and decide in the domain). An unattended agent must pick one, and the choice moves every consumer.
- The repo already has the domain shape for this: the Bitbucket arm pipes raw statuses and comments into `board/plot-jenkins-pr-checks.mjs review`, which calls `bitbucketReview` (`packages/domain/src/rules/bitbucket-pr-reading.ts:129-143`). The GitHub arm can do the same with a `githubReview(sha, statuses, comments, trusted)` rule. That removes the inline jq at `plot-host.sh:4395`, so `scripts/check-shell-lines.sh` sees fewer shipped lines rather than more, and CLAUDE.md "Reduce shell, grow the domain" holds.

### 5. Bitbucket cannot be fixed by a reading

- `bitbucketReview`'s own header (`bitbucket-pr-reading.ts:114-116`) says "Bitbucket keeps one build status per `key` on a commit, and a later write with the same key replaces it." A forged write therefore destroys the App's status; there is no history to filter. The status object the decoder reads (`key, state, description, updated_on, created_on`) has no writer field.
- The Plot writer is the `BITBUCKET_REVIEW_USER` account (`plot-bitbucket-commit-status.mjs`, `.plot/briefs/bitbucket-commit-status-parity.md:20`). Open Question 3 therefore has an answer: the arm trusts any account with write access, and the plan should state that as a known gap with that reason, not as "which writer does it trust".

### 6. The `review-bypass:` comment has the same defect and is not named

- GitHub: `bypass: any(.comments[]?; .body | startswith("review-bypass:"))` (`plot-host.sh:4395`) reads any author. Bitbucket: `comments.some((c) => …startsWith('review-bypass:'))` (`bitbucket-pr-reading.ts:141`) reads any author.
- Only the bypass audit reads `bypass` (`review-bypass.ts:70`, `rules/review-bypass.ts:56`); no merge decision reads it. Any PR participant can therefore silence the `/plot-reconcile` "20a. Review bypass" report for a PR (`docs/review-status-rollout.md:89-98`). Lower severity than the status, but the same seam in the same jq line. The plan must either include it or name it out of scope with a follow-up issue.

### 7. The trusted identity is read from the working tree

- `plot-config.sh:290-296` reads `CLAUDE.md` at `PLOT_REPO_ROOT` or `git rev-parse --show-toplevel`. A `pr-review` run inside a desk worktree reads the desk branch's `Review app` line. A slice branch that edits that line changes which writer its own merge reading trusts, for any merge path that runs in that worktree. The #3068 panel raised the same point for `Merger app` (`config-reader.ts:41-44`, quoted in the #3068 plan's rejected options).
- The plan must state where the key is read from (the default branch's config, or `PLOT_REPO_ROOT` of the main checkout) and add a test for a worktree whose `Review app` differs.

### 8. Consumers of the reading the plan does not list

A new field or a new `state` word reaches each of these, and each needs a decision and a test update:

- `packages/domain/src/ports/host.ts:150-161` (`PrReviewReading`, its TSDoc says "newest `plot/review` status" — the meaning changes to "newest trusted").
- `packages/domain/src/workflows/merge.ts:209-213` (`review-not-passed` text names only `state`).
- `packages/domain/src/workflows/release-approve.ts` and its rule (`review-missing`), which #3070 also edits.
- `packages/board/src/server/entry/review.ts:303-306`, `:498-505`: `markPending` refuses on an existing `failure`, and the newest-pending-wins rule compares the `description` run id. Both must read the trusted status only, or a foreign `pending`/`failure` blocks every review run on that head. That is a new denial path the plan must name.
- `packages/domain/src/rules/review-bypass.ts:10` (`ReviewState` has no foreign word) and its board entry.
- `packages/domain/src/adapters/host/host-fixture.ts:205` and `host-shell.ts:521-522` (`asJson<PrReviewReading>` does no validation, so a new field passes silently if a consumer forgets it).
- `skills/plot/scripts/plot-host.sh:114-126` (op header, the port contract text).
- `docs/review-status-rollout.md:121` (states what `pr-review` reads).

### 9. Existing contract tests break as written

- `test/reconcile/host-pr-review.test.mjs:52-60`, `:143` stub statuses with no `creator` and expect `state: 'failure'`/`success`. With a writer filter and no `Review app` stub, every one reads foreign or absent. The slice must stub `plot-config.sh`'s `Review app` and the `GET /app` answer, and update these fixtures, and the plan should say so — otherwise an agent reads the red tests as regressions and "fixes" the filter.
- Also touched: `packages/domain/test/workflows-merge.test.ts`, `workflows-release-approve.test.ts`, `host-shell.test.ts`, `adapters-fixtures.test.ts`, `packages/board/test/unit/review.test.ts`, `review-bypass.test.ts`, `packages/fleet/test/unit/auto-merge.test.ts` (from `git grep -l "pr-review\|prReview"` on origin/main).

### 10. Overlap with #3068 and #3070

- #3068 (merged, decision 1): fleetd merges as a Merger App that is not on the bypass list, so GitHub itself refuses a fleet merge whose `plot/review` success does not come from integration 5317669. After #3068 ships, the forged-success merge this plan guards against remains open only for a bypass identity: `plot-ask.mjs merge` and `release-approve` run by the Admin login, and fleetd on a repo with no `Merger app`. The plan's Motivation should say this, because it sets the real exposure and makes the index seam (finding 1) the larger zero-interventions problem.
- #3070 (open) edits `release-approve.ts`, `workflows-release-approve.test.ts`, `release-prepare.ts`, and folds the rollup "excluding `plot/review`". It also reads `plotReview` from the index through `release-prepare.ts:199`. Both plans change `releaseApprove`'s refusal set; whichever lands second must rebase its refusal names. The plan should name the collision and the merge order.

### 11. Live reproduction is a host write

- Notes: "The first step of the slice is to reproduce the forged `success` in a sandbox." On GitHub that means the operator's login posting a `plot/review` status — the attack itself. An unattended desk must not do this on `plot-pm/plot`; there is no sandbox GitHub repo named. The stubbed contract test is sufficient for the slice; a live reproduction is a person-step.

## Amendments required

1. Correct the Motivation: the slice-PR rule and `releasePrepare` read the PR index (`pr-list --rich` rollup), not `pr-review`. State that `#3068` closes the fleet merge path at the host once `Merger app` is declared, and that the remaining exposure is bypass identities and the index.
2. Decide the index seam. Either (a) `pr-list --rich` reads `plot/review` with its creator (GraphQL `StatusContext.creator.login`, no `[bot]` suffix) and folds a foreign newest status to a distinct value that `slicePrNext` treats as "needs review", or (b) name the index out of scope and file a follow-up issue in the same PR. Recommend (a) as a second slice, since the fixer and review arms otherwise never fire on a forged head.
3. Pick one layering: the GitHub arm pipes raw `/statuses` and comments into a bundle that calls a new domain rule `githubReview`, mirroring `bitbucketReview`. Delete the inline jq. State the expected shell-line delta as negative.
4. Close Open Question 1 in the plan: trusted writer = `creator.type == "Bot"` and `creator.login == "<slug>[bot]"`, slug from `GET /app` with the `Review app` JWT through `plot-github-app.mjs`. A key that `resolveApp` cannot read, a JWT that fails to sign, or a `GET /app` that fails refuses `pr-review` with exit 3 and a named reason; it never falls back to accepting any writer.
5. Close Open Question 2: keep `state`/`description`/`time` as the newest TRUSTED status (or `absent`), and add `foreign: { state, login } | null` naming the newest untrusted `plot/review` status newer than the trusted one. `merge()` refuses `review-foreign` when `foreign` is non-null and `state` is not `success`, so the refusal names the writer; `review.ts` ignores foreign statuses in `markPending` and the pending-wins rule. Name the change to `PrReviewReading`'s TSDoc.
6. Close Open Question 4 (person decision, see below) and state the chosen behaviour plus a test.
7. Close Open Question 3: the Bitbucket arm cannot filter, because a later write with the same key replaces the status. State in `bitbucketReview`'s header and `docs/review-status-rollout.md` that it trusts any account with write access, with a test that pins today's answer.
8. Name the `review-bypass:` comment: either filter by author (GitHub `author.login` in `gh pr view --json comments`; Bitbucket `user.account_id`) or name it out of scope with a follow-up issue.
9. State where `Review app` is read from (default-branch config, not the desk worktree), with a test.
10. List the test files in finding 9 and say that the existing `host-pr-review.test.mjs` fixtures gain a `creator` and a stubbed `Review app`.
11. Remove the live sandbox reproduction from the slice and make it a person-step, or drop it.
12. Name the collision with #3070 on `release-approve.ts` and its test.

## Decisions that need a person

- Open Question 4: a repo with no `Review app` key. My recommendation is to keep today's behaviour (any writer, reported as `unchecked`), because refusing would stop every repo that never adopted the App, including Bitbucket ones. That trades safety for adoption and is the person's call.
- Whether the index seam (amendment 2) is in this plan or a follow-up. It changes the sprint scope.
- Whether a live reproduction on `plot-pm/plot` is wanted at all, and who runs it.

## Ran versus read

Ran (read-only): `gh issue view 3072`; `gh api repos/{owner}/{repo}/commits/<head of #3067>/statuses` (creator fields); `gh api apps/plot-review` (id 5317669, slug `plot-review`); `gh pr view 3067 --json statusCheckRollup` (no creator); one GraphQL query for `StatusContext.creator.login` (`plot-review`); `gh pr view 3068/3070/3074 --json files`; `git grep` and `git show` on origin/main.

Read only: `plot-host.sh` (`:114-126`, `:688`, `:709`, `:4087`, `:4378-4396`, `:4803`, `:6043-6067`), `plot-github-app.mjs`, `plot-commit-status.mjs`, `plot-config.sh`, `ports/host.ts`, `workflows/merge.ts`, `workflows/release-approve.ts`, `rules/slice-pr-next.ts`, `rules/release-prepare.ts`, `rules/review-bypass.ts`, `rules/bitbucket-pr-reading.ts`, `fleet/src/shared/pr-refresh.ts`, `board/src/server/entry/review.ts`, `review-bypass.ts`, `test/reconcile/host-pr-review.test.mjs`, `docs/review-status-rollout.md`, the #3068 plan on origin/main, the #3070 plan on its branch. No test suite, fleet or board command, or host write was run.
