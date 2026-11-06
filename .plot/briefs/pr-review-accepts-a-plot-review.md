## Implementation brief — pr-review-accepts-a-plot-review (wave 1: Writer check)

- **Plan (canonical):** docs/plans/2026-11-03-pr-review-accepts-a-plot-review.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3074 merged
- **Branch:** `feature/pr-review-accepts-a-plot-review` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** `plot/review` by the Review app (plan `Review: pr`)

This wave waits on `feature/the-release-checks-are-counted`, which has merged (`checks-missing` is in `ReleaseApproveRefusal`, `release-approve.ts:17`). `feature/the-review-status-has-one-writer` (wave 2, the write gate) waits on this wave and owns `rules/role-gate.ts` and `gate.ts`.

### What to build

`plot-host.sh pr-review` on GitHub (`plot-host.sh:4377`) takes the first `plot/review` status on a head and never reads who wrote it. The operator's login can post `plot/review` with one `gh api` call, and a `success` posted after the App's `failure` reads as the App's answer. The same happens on the index path: `statusCheckRollup` holds one newest entry per context and carries no creator, so a forged `success` hides the App's `failure` from `plotReview`. Both read paths get a writer check in this slice.

Build, in this order: (1) `pr-review` reports every `plot/review` status with its `writer`; (2) the `githubReview` and `reviewPasses` domain rules; (3) `Host.reviewWriter`; (4) `mergeAt` and `releaseApproveAt` call `reviewPasses`; (5) the board's review run reads the trusted status only; (6) the index judges `success` and `failure` rows into `plotReviewJudged`. The plan's *Design* section holds the exact shapes, the judged-state table and the case list.

### Decisions the plan settles — do not re-derive them

- **`pr-review` reports and decides nothing.** It reads no config. `githubReview` judges, as `bitbucketReview` (`bitbucket-pr-reading.ts:128`) decodes the Bitbucket reading. Reason: a shell op that reads config duplicates a rule the corpus tier would then have to hold.
- **The trusted writer is `<slug>[bot]`, resolved through `GET /app` with the App JWT** (`appJwt`, `call` in `plot-github-app.mjs`). The bot user id (342578638) is not the App id (5317669), and no status field names the integration, so no login can be hardcoded or derived from the id.
- **`Review app` is read from `git show origin/<default>:CLAUDE.md`, then `AGENTS.md`, and never from the working tree.** A desk or PR head must not supply the trust anchor. `reviewWriter` does not fetch. No `origin/<default>` ref answers `unaskable`, never the working tree's value. No key answers `ok` with `''`, which reads `unchecked` and refuses nothing.
- **A newer foreign status refuses the merge but the read still succeeds.** `state` is the trusted writer's newest status and `foreign` is reported separately, so one forged status never blocks the App's own review writes.
- **Pagination goes through stdin to `jq`, never `--argjson`.** The plan's rule is `--paginate` with `per_page=100`; `--argjson` dies on Linux past 128 KB.
- **`state`, `description` and `time` keep today's meaning** (newest from any writer) so a consumer that has not moved reads what it read before.
- **The index keeps the judgment in its own fields** (`plotReviewJudged`, `plotReviewCheckedSha`, `plotReviewCheckedAt`). The row builder carries them from `predecessor` only when the head is the same and `plotReviewCheckedAt` equals the new rollup `plotReviewAt`. Overwriting `plotReview` in place would let the next rollup write erase the judgment.
- **A foreign status over a trusted `success`, `pending` or `absent` judges `absent`**, which sends the PR back for one review run inside the existing per-head budget (`reviewStartAllowed`). No hold reason and no board surface are added. Over a trusted `failure` it judges `failure`.
- **`reviewReaskPrNumbers` also returns `success`/`failure` rows with no judgment on their head, whatever CI reads.** The HIGH arm and `revert-start-world` act on `failure` with CI red. `reviewWriter` is asked once per pass.
- **Consumers hold `review-writer-unchecked`** where the rollup reads `success` or `failure` and no judgment holds for the head: `slicePrNext`, `release-prepare`, `revert-start-world`.
- **Bitbucket is a named limit.** One status per key, no writer. `statuses` carries `writer: ''`, `reviewWriter` answers `ok` with `''`, and the answer does not change.
- **No live reproduction.** A forged write on a real repository is the act under review. Tests use a stubbed `gh`.

Carried-over rules: absent is not false (the index supplies `success`, never *no review*; a missing judgment means ask, not pass). Read exit codes, not emptiness. The index never says no.

### Done when

The plan's *Tests* list is the specification. Lift these, which a naive implementation passes without:

- the `host-pr-review.test.mjs` stub's argv arms gain `--paginate` and `per_page=100` in the same commit, or every GitHub case fails with `the read failed`;
- the `reviewWriter` cases use a temp repo with a bare `origin`, so `origin/<default>` exists. A working-tree-only `Review app` change must read the pushed value, and an unfetched push must read the old one. Without these a read of the working tree passes;
- the cross-refresh test in `fleet-pr-index.test.ts` (judgment kept on refresh 2, dropped on a newer `plotReviewAt` or a moved head) catches a row builder that carries the judgment unconditionally;
- the `slice-pr-next` and `release-prepare` case where `plotReview: success` and `plotReviewJudged: absent` answers `review` from the review arm and `none` from the merge arm catches a consumer that still reads the rollup.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite. In `test/reconcile/`, use `host-pr-review.test.mjs`, never `host.test.mjs` (the whole file runs for minutes).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `plot-host.sh`, so growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;` or `&&` is not a payment. It stores no number and has no override.

Add a changeset (`plot` package, description first, `bumps:` block last, then run `./scripts/check-changeset-packages.sh`). The PR diff carries no generated bundle (`scripts/check-no-bundle-diff.sh`). New functions are arrows. TSDoc states behaviour, not history.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while it moves), never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices`. Update the docs the plan names: the `pr-review` op header (`plot-host.sh:114-125`), the `bitbucket-pr-reading.ts` header (decision 7) and `docs/review-status-rollout.md:121`. Paths moved since the plan was written: the host adapter is `packages/domain/src/adapters/host/host-shell.ts` and `host-fixture.ts` (the plan says `adapters/host-shell.ts`); `controllerGateOf`'s `linked` return is now `gate.ts:999`. Re-find line numbers by symbol.

### Scope guard

This branch owns: `plot-host.sh` (`pr-review` arm), `plot-jenkins-pr-checks.mjs` (`review`), `ports/host.ts`, `adapters/host/*`, `rules/github-review.ts` (new), `rules/pr-index.ts`, `entities/pr-index.ts`, `workflows/merge.ts`, `workflows/release-approve.ts`, `slice-pr-next.ts`, `release-prepare.ts`, `revert-start-world.ts`, `pr-refresh.ts`, `board/.../review.ts`, `review-bypass.ts`, and their tests.

Not this branch: `rules/role-gate.ts`, `gate.ts`, `controller-gate-readings.test.ts`, `role-deny-gate.test.ts` (wave 2, `feature/the-review-status-has-one-writer`). In flight on main at dispatch: #3105 (`bug/the-queue-hands-out-an-approved-spike`, shared slice readings, may touch `slice-pr-next.ts`), #3080 (release PR) and #3076 (plan only). Rebase on `origin/main` before the PR.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
