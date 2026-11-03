# Safety juror: pr-review-accepts-a-plot-review

Position: amend

The defect is real and the direction is right. As written, the plan closes one of three paths that read `plot/review`, leaves the trust anchor undecided, and lets the fix fail toward a stalled PR or a blocked review. Each gap below names its amendment.

## Findings

### F1 (HIGH): the index reads `plot/review` with no writer check, and the plan does not name it

- The plan says `mergeAt` "and the slice-PR rule read the answer of `pr-review`". The second half is false. `slicePrNext` reads `row.plotReview` from the PR index (`packages/domain/src/rules/slice-pr-next.ts:227` HIGH arm, `:324` merge arm). The index takes `plotReview` from `statusCheckRollup` in `pr-list --rich` (`skills/plot/scripts/plot-host.sh:4803`), which takes the first `plot/review` context and reads no creator.
- Other readers of the same unchecked field: `release-prepare.ts:199` and `:260-267`, and `revert-start-world.ts:167` (`reviewFailed` starts a revert review on `plotReview === 'failure'`).
- The rollup holds one entry per context, the newest. A forged `success` after an App `failure` therefore hides the App's `failure` from the index completely. The HIGH arm reads `no-high`, so no fixer starts. The merge arm selects `merge` every tick, and `mergeAt` (`auto-merge.ts:81`) refuses `review-not-passed` after this fix. Only `host-refused` enters the refused set (`auto-merge.ts:82`), so the PR loops without end and no arm hands it to a fixer or a person. That is a stall, which works against the sprint goal of zero interventions.
- `gh pr list --json statusCheckRollup` exposes no creator for a `StatusContext`. A writer check on this path needs its own GraphQL selection (`... on StatusContext { creator { login } }`) or a re-ask through `pr-review`.

### F2 (HIGH): the writer check does not stop an agent that writes as the App

- `plot-host.sh commit-status` mints an installation token from the key that `Review app` names (`plot-host.sh:572-604`, `:6047-6050`). The key file is `/Users/jwloka/.config/plot/plot-review.5317669.private-key.pem`, mode 0600, owned by the operator. Fleet desks and the master agent run as that user.
- Any agent can therefore run `plot-host.sh commit-status <sha> success plot/review ...` and the status arrives as `plot-review[bot]`. The writer check accepts it. `controller-gate.ts` holds no refusal for `commit-status` or `plot-commit-status.mjs` (grep returned nothing).
- The fix stops the one-call `gh api` forgery named in the issue. It does not stop a forgery through Plot's own writer. The plan must state this boundary. A person decides whether a gate on `commit-status` with context `plot/review` outside `plot-review.mjs` belongs in this slice or in a follow-up issue.

### F3 (HIGH): the identity source is undecided, and an unattended agent must not choose it

- Measured on a merged PR head on origin/main: a `plot/review` status carries `creator.login = "plot-review[bot]"`, `creator.type = "Bot"`, `creator.id = 342578638` and `performed_via_github_app = null`. The bot user id 342578638 is not the App id 5317669. No field on the status names the integration.
- The plan's Open Question 1 is correct but unanswered. Three possible sources exist: `GET /app` under the App's JWT, which returns the slug and needs the private key on every reading machine; a login or bot id in config; or a hard-coded suffix rule. A config value that the PR head can edit lets a PR re-point the trusted writer. The plan must say that the identity is read from the default branch's config, or from the App itself, and never from the PR's own tree.
- A comparison on `[bot]` alone, or on `type == "Bot"` alone, accepts any App with status write on the repository (for example integration 5173644, which the ruleset lists as a bypass actor). The comparison must name one login or one id.

### F4 (MEDIUM): the refusal shape can block the App's own review

- `reviewPr` reads `prReview` before it writes `pending` and before it writes the result (`packages/board/src/server/entry/review.ts:303-306`, `:498-507`). If a foreign status makes `prReview` non-ok, or yields a `state` that `markPending` refuses, one forged status blocks the App from ever writing again. That is a denial of review by any writer.
- Required shape: `state`, `description` and `time` describe the newest status from the trusted writer only (`absent` where it wrote none). A separate field (for example `foreign: { login, state, time } | null`) reports the newest status from any other writer. The read stays `ok`.
- `mergeAt` then refuses on `state !== 'success'` as today, and also refuses with a new name (for example `review-foreign-writer`, naming the login) when a foreign status is newer than the trusted one. The refusal is safe because a merge cannot be undone.

### F5 (MEDIUM): App absent plus forged success, and the page limit

- App absent, forged `success` present: with F4's shape, `state` reads `absent`, and `mergeAt` refuses `review-not-passed`. The plan must hold this case in a test.
- `gh api repos/{owner}/{repo}/commits/<sha>/statuses` (`plot-host.sh:4394`) reads one page of 30 with no pagination. Thirty foreign writes after the App's status push the App's status off the page, and the reading turns into `absent`. That fails toward refusal, which is safe, but it starts a new review run each time. Use `per_page=100` and report `truncated` when a full page holds no trusted status, or walk pages as the Bitbucket arm does (`_bb_paged_walk`).
- The same line passes the page through `--argjson` (`plot-host.sh:4395`). The memory "jq --argjson dies on Linux past 128KB" applies to a larger page. Use stdin, as the Bitbucket arm's comment at `:4383-4387` describes.

### F6 (MEDIUM): the Bitbucket arm cannot know the writer, and the plan must say so as a fact

- `bitbucketReview` (`packages/domain/src/rules/bitbucket-pr-reading.ts:113-142`) states that Bitbucket keeps one build status per key and "a later write with the same key replaces it". A forged write erases the App's status. No history exists, so "newest per writer" cannot apply.
- The Bitbucket status objects the decoder reads carry no creator field. The writer is `BITBUCKET_REVIEW_USER` by convention only (`plot-host.sh:588-596`), and its app password lives in the environment or `.env`, which agents can read.
- Open Question 3 has a factual answer: no, a key cannot be tied to one account. The slice must write that sentence into the decoder header and hold it in a test that feeds an overwritten status and reads the overwrite. A person decides whether Bitbucket merges through `plot-ask.mjs merge` stay allowed under that limit.

### F7 (MEDIUM): a repository with no `Review app` key

- On GitHub, `commit-status` exits 4 with no `Review app` key (`plot-host.sh:584-588`). Plot then writes no `plot/review` status at all. Every `plot/review` status in such a repository comes from a writer that is not Plot.
- So the claim in Open Question 4, "Refusing breaks repos that never adopted the App", is narrower than it reads. Refusal breaks only repositories where something other than Plot writes `plot/review`. In all other such repositories `mergeAt` already refuses for want of a `success`.
- Recommendation for the person: with no key, `pr-review` reports `writer: 'unverified'`, and `mergeAt` refuses `review-writer-unverified`. A repository that wants another writer declares it in config.

### F8 (LOW): `bypass` trusts any commenter

- `bypass` is true for a comment from any author that starts `review-bypass:` (`plot-host.sh:4395`, `bitbucket-pr-reading.ts:141`). `mergeAt` does not read it (`merge.ts:209-212`), so it opens no merge. `plot-review-bypass.mjs` (`packages/board/src/server/entry/review-bypass.ts:70`) does read it, so one agent comment removes a PR from the audit. This is the same class of defect. File it as a follow-up and keep it out of this slice.

### F9 (LOW): the ruleset does not enforce the App on auto-merges

- Read on 2026-11-03: the `main` ruleset requires `plot/review` from integration 5317669 and lists two bypass actors with `bypass_mode: always`: RepositoryRole 5 (Admin) and Integration 5173644.
- If 5173644 is the merger App that `auto-merge.ts` uses (`MERGER_APP_KEY`, `auto-merge.ts:30`), GitHub does not check the review writer on any fleet merge. Plot's own check is then the only check. This raises the importance of F1 and F4. Removing the bypass actors is a decision for a person and stays out of this plan.

### F10 (LOW): the reproduction step writes to the host

- Notes: "The first step of the slice is to reproduce the forged `success` in a sandbox." On a real repository this is a forged `plot/review` write, which is the act under review. An unattended agent must not do it. Reproduce it with a stubbed `gh` in `test/reconcile/host.test.mjs` that returns statuses with `creator` fields.

## Rubric answers

1. Fix and sprint goal: the plan fixes the `pr-review` path only. The index path (F1) stays open and adds a stall. A reader verifies the fix with a stubbed `gh` that returns `[forged success by operator, App failure by plot-review[bot]]` and checks that `pr-review` reads `failure` plus `foreign`, and that `mergeAt` refuses.
2. Claims: the `pr-review` description is true (`plot-host.sh:4394-4396`). The claim that the slice-PR rule reads `pr-review` is false (F1). "The Bitbucket arm decodes build statuses, which carry no comparable creator on every plan" is true, and the stronger fact is that a later write replaces the earlier one (F6).
3. Breaks: `PrReviewReading` (`ports/host.ts:151-161`) gains fields, so `host-fixture.ts:205` and the `pr-review` header (`plot-host.sh:114-125`) change too. The index schema (`entities/pr-index.ts:111`) changes too if F1 is taken. The shell-lines ratchet applies to any line added in `plot-host.sh`. The cheaper route is to move the writer filter into a domain decoder beside `bitbucketReview` and keep the shell a pipe.
4. Failure modes: listed in F4, F5 and F7. Each needs a named refusal: `review-not-passed`, `review-foreign-writer`, `review-writer-unverified`, and `truncated` or an `unaskable` reading.
5. Unattended build: Open Questions 1, 2 and 4 are design decisions, and a Sonnet agent would choose one of them silently. Open Question 3 is a fact (F6). F2 and F9 belong to a person.
6. Tests: the named test (forged success after App failure) fails before and passes after. Still missing: App absent plus forged success; foreign newer than an App success; no `Review app` key; the index path with a forged rollup entry; `reviewPr` still writes when a foreign status exists; the Bitbucket overwrite statement.

## Required amendments

1. Name the index path (`plot-host.sh:4803` into `slicePrNext`, `release-prepare`, `revert-start-world`) and either apply the same writer check there or mark a foreign rollup entry so that the slice rule holds with a named reason instead of selecting `merge` every tick. If this goes to a second slice, state that, and state the stall the first slice leaves.
2. Decide Open Question 1. Name the field compared (`creator.login` or `creator.id`), the source of the expected value, and that the value is read from the default branch or from the App, never from the PR head.
3. Decide Open Question 2 as F4 describes. `state` belongs to the trusted writer. A separate field reports the foreign status. The read stays `ok`. `mergeAt` gains a named refusal for a newer foreign status.
4. Decide Open Question 4 (F7). Recommendation: refuse with a named reason when no key exists.
5. Replace Open Question 3 with the fact from F6, and require the header sentence and its test.
6. State the threat boundary (F2): the check stops a `gh api` forgery and does not stop a write through `commit-status`. Link a follow-up issue for a gate.
7. Fix the statuses read: paginate or set `per_page=100` with a named `truncated`, and pass the page through stdin instead of `--argjson` (F5).
8. Reproduce the defect with a stubbed `gh` and never with a live write (F10). List the six tests from rubric item 6.

## Decisions for a person

- Whether a repository with no `Review app` key refuses (F7).
- Whether a gate on `commit-status` for `plot/review` joins this plan or a follow-up (F2).
- Whether Bitbucket merges stay allowed while the writer cannot be checked (F6).
- Whether the ruleset keeps Admin and Integration 5173644 as `always` bypass actors (F9).

## What I ran and what I only read

Ran (read-only): `gh issue view 3072`; `git grep` over origin/main for `pr-review`, `prReview`, `plotReview`, `bypass`, `commit-status`, `mergeAt`; `git show` of `plot-host.sh`, `review.ts`, `ports/host.ts`, `bitbucket-pr-reading.ts`, `slice-pr-next.ts`, `revert-start-world.ts`, `auto-merge.ts`; `gh api repos/plot-pm/plot/rulesets/<id>` (bypass actors and required checks); `gh api repos/plot-pm/plot/commits/<head of the newest merged PR>/statuses` (creator fields of `plot/review`); `ls -l /Users/jwloka/.config/plot/`.

Only read, not executed: the claim that `gh pr list --json statusCheckRollup` carries no creator, the claim that Bitbucket status objects carry no creator, and the identity behind integration 5173644. I posted no status, ran no test suite, and wrote nothing to the host.
