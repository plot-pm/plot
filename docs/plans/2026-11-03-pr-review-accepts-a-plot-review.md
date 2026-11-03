# pr-review accepts a plot/review status from any writer

> `plot-host.sh pr-review` reads the first `plot/review` status on a head without checking who wrote it, so a status posted under the operator's login reads as the review App's answer.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3072
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `plot-host.sh pr-review` reports the writer (`creator.login`) of every `plot/review` status on the head, and a domain rule `githubReview` judges the reading against the bot login of the `Review app`. A `plot/review` status from any other writer never reads as `success`.
- `plot-ask.mjs merge` and `plot-ask.mjs release-approve` refuse `review-foreign-writer` when a `plot/review` status from another writer is newer than the Review app's own status, and `review-writer-unread` when the Review app's login cannot be resolved.
- fleetd re-asks `pr-review` for an open PR whose index row reads `plot/review: success` before any rule acts on it, so a foreign `success` neither merges nor parks the PR.
- The controller gate refuses a `plot/review` commit-status write that does not come from `plot-review.mjs`.

<!-- Board impact: none in the plan format, the template or the docs/plans layout. The PR index row gains one optional field (`plotReviewCheckedSha`); `slicePrNext`, `release-prepare` and `revert-start-world` read it. -->

## Motivation

`plot-host.sh pr-review` on GitHub (`skills/plot/scripts/plot-host.sh:4394-4396`) reads `repos/{owner}/{repo}/commits/<head>/statuses` and takes the first status whose `context` is `plot/review`. It does not read the status's `creator`, it reads only the first page, and it passes the page to `jq` through `--argjson`.

The ruleset on `main` accepts `plot/review` only from the plot-review App (integration 5317669). Fleet desks and the master agent run under the operator's `gh` login, which posts a `plot/review` status with one `gh api` call. A status posted that way after the App posted `failure` reads as `success` to Plot.

The ruleset still refuses such a merge for a writer without bypass. The operator's login has the Admin role, which the ruleset lists with `bypass_mode: always`, so a merge through `plot-ask.mjs merge` as that login is not stopped by the ruleset. The safety and seams jurors of plan PR #3068 found this on 2026-11-03 from the code. It is not reproduced on the host, and this plan does not reproduce it there.

### Readers of plot/review

Two read paths exist, and each consumer uses one of them. Measured on `origin/main` on 2026-11-03.

| Consumer | Reading | Use |
|---|---|---|
| `packages/domain/src/workflows/merge.ts:210` (`mergeAt`, `:366`) | `host.prReview` | refuses `review-not-passed` unless `state` is `success` on the head |
| `packages/domain/src/workflows/release-approve.ts:92` (`releaseApproveAt`, `:132`) | `host.prReview` | refuses `review-missing` unless `state` is `success` on the head |
| `packages/board/src/server/entry/review.ts:303` | `host.prReview` | `markPending` refuses on an existing verdict before the run writes `pending` |
| `packages/board/src/server/entry/review.ts:498` | `host.prReview` | newest-pending-wins: compares `description` with `run <runId>` before the run writes its verdict |
| `packages/board/src/server/entry/review-bypass.ts:62` | `host.prReview` | audits merged PRs whose review is not `success`, and reads `bypass` |
| `packages/domain/src/rules/slice-pr-next.ts:181`, `:227`, `:324` | PR index `plotReview` | review arm, HIGH arm and merge arm select a PR |
| `packages/domain/src/rules/release-prepare.ts:199`, `:260-267` | PR index `plotReview` | decides whether the release PR needs a review |
| `packages/fleet/src/shared/revert-start-world.ts:167` | PR index `plotReview` | starts a revert review on `failure` |

The PR index takes `plotReview` from `statusCheckRollup` in `pr-list --rich` (`plot-host.sh:4803`). The rollup carries no creator, and it holds one entry per context, the newest. A forged `success` after an App `failure` therefore hides the App's `failure` from the index. The plan's first draft said the slice-PR rule reads `pr-review`; that was false, and both paths are in scope.

### Overlap with other plans

- #3068 (`fleetd-merges-no-slice-pr-while`, Approved): once `Merger app` is declared, fleetd merges as an App that is not on the bypass list, so GitHub refuses a fleet merge whose `plot/review` success does not come from integration 5317669. Plot's own check still guards every merge under a bypass identity: `plot-ask.mjs merge` and `plot-ask.mjs release-approve` run by the Admin login, and fleetd in a repository with no `Merger app`.
- #3070 (`the-release-pr-needs-a-person`, Draft): its branch `feature/the-release-checks-are-counted` adds `checks-missing` to `ReleaseApproveRefusal` in `release-approve.ts:17` and edits `workflows-release-approve.test.ts`. This plan adds `review-foreign-writer` and `review-writer-unread` to the same union. The slice line below carries a `waits:` marker on that branch.

## Design

### Decisions

Taken by jwloka on 2026-11-03 after the first panel round.

1. **Both read paths are in scope.** The `pr-review` path and the PR index path get the writer check in this plan.
2. **`pr-review` reports and decides nothing.** It reports each `plot/review` status with its writer and reads no config. A pure domain rule `githubReview` judges it, the way `bitbucketReview` (`packages/domain/src/rules/bitbucket-pr-reading.ts:128`) decodes the Bitbucket reading.
3. **The trusted writer is `<slug>[bot]` of the Review app.** A host-adapter operation resolves it from the `Review app` id through `GET /app` with the App JWT (`appJwt` and `call` in `skills/plot/scripts/plot-github-app.mjs:67`, `:74`). It reads `Review app` from the default branch's committed config, never from the PR head's working tree. No login is hardcoded.
4. **A newer foreign status refuses a merge, and the read still succeeds.** `state` describes the trusted writer's newest status. A foreign status newer than it is reported in a separate field. `mergeAt` and `releaseApproveAt` refuse it through one shared domain rule. One forged status never blocks the App's own review writes.
5. **No `Review app` key keeps today's behaviour.** The reading reports `unchecked`, and no consumer refuses on that ground.
6. **The `plot/review` write is gated.** The controller gate refuses a `plot/review` commit-status write from anything but `plot-review.mjs`.
7. **Bitbucket is a named limit.** Bitbucket keeps one build status per key and a later write with the same key replaces the earlier one; the status object carries no writer. No reading can tell a forged status from Plot's own there.
8. **`review-bypass:` comment authorship is a follow-up**, not this plan. `bypass` stays true for a `review-bypass:` comment from any author (`plot-host.sh:4395`, `bitbucket-pr-reading.ts:141`). Only the bypass audit reads it; no merge decision does.
9. **No live reproduction.** A forged `plot/review` write on a real repository is the act under review. Tests use a stubbed `gh`.

### The pr-review reading

The GitHub arm reads the statuses with `gh api --paginate "repos/{owner}/{repo}/commits/<head>/statuses?per_page=100"` and passes the pages to `jq` through stdin, never through `--argjson`. It emits one JSON line:

`{"sha","state","description","time","bypass","statuses":[{"state","description","time","writer"}]}`

`statuses` holds the `plot/review` statuses on the head, newest first, and `writer` is `creator.login` (`''` where the host gives none). `state`, `description` and `time` keep today's meaning (the newest status from any writer) so that a consumer which has not moved yet reads what it read before. The shipped shell line count must not grow (`scripts/check-shell-lines.sh`).

The Bitbucket arm (`plot-jenkins-pr-checks.mjs review`, `bitbucketReview`) emits the same `statuses` field with `writer: ''`. Its header states the limit in decision 7.

`PrReviewReading` (`packages/domain/src/ports/host.ts:150-161`) gains `statuses`, and its TSDoc says what `state` means now. `host-shell.ts:521-522` decodes the field, and `host-fixture.ts:205` and the op header at `plot-host.sh:114-125` follow.

### The trusted writer

A new host port operation `Host.reviewWriter(): Promise<PortResult<string>>`, implemented in the host adapter:

- It reads `Review app` from the default branch's committed `## Plot Config` (`CLAUDE.md`, then `AGENTS.md`, the file order `plot-config.sh` uses, read through `git show origin/<default>:<file>`). The working tree of a desk or a PR head never supplies the value.
- It mints the App JWT with `appJwt`, calls `GET /app` with `call`, and answers `<slug>[bot]`.
- No `Review app` key: it answers `ok` with `''`, which `githubReview` reads as `unchecked`.
- A key that `resolveApp` cannot read, a JWT that fails to sign, or a failed `GET /app`: it answers `unaskable`. It never falls back to accepting any writer.

On Bitbucket the operation answers `ok` with `''`.

### The githubReview rule

`githubReview(reading, trusted)` in `packages/domain/src/rules/`, an arrow function with no I/O, answers:

- `writer: 'checked'` and `state`, `description`, `time` from the newest status whose `writer` equals `trusted` (`absent` where none exists);
- `foreign: { login, state, time } | null`: the newest status from another writer that is newer than the trusted one, else `null`;
- `writer: 'unchecked'` where `trusted` is `''`: `state`, `description` and `time` are the newest status from any writer, and `foreign` is `null`;
- `writer: 'unread'` where the `reviewWriter` reading was `unaskable`.

One shared rule, `reviewPasses(judged, head)`, answers the merge question for both controllers. It refuses `review-foreign-writer` (naming the login and the time) when `foreign` is not `null`, `review-writer-unread` when the writer was `unread`, and `review-not-passed` or `review-missing` as today otherwise. `merge.ts:209-213` and `release-approve.ts:92-98` call it, and the two refusal unions (`merge.ts:40`, `release-approve.ts:17`) gain the two names.

The board's review run (`review.ts:303`, `:498`) reads the judged reading: `markPending` and newest-pending-wins read only the trusted writer's status, so a foreign `pending` or `failure` never blocks a run and a foreign `run <id>` description never supersedes one. The bypass audit (`review-bypass.ts:62`) reports a merged PR whose only `success` is foreign as a bypass.

### The index path

`reviewReaskPrNumbers` (`packages/domain/src/rules/pr-index.ts:330`) also returns an OPEN in-scope row whose `plotReview` is `success` and whose `plotReviewCheckedSha` is not its `headSha`. For each such number `pr-refresh.ts` (`:1646-1653`) asks `host.prReview` and `host.reviewWriter`, judges the answer with `githubReview`, and writes the judged `state` into `plotReview` and the head into `plotReviewCheckedSha`. The row gains `plotReviewCheckedSha` as an optional field in `packages/domain/src/entities/pr-index.ts`.

`slicePrNext`, `release-prepare` and `revert-start-world` read `plotReview: 'success'` as passed only where `plotReviewCheckedSha` equals `headSha`. Until the re-ask lands they hold the PR with a named reason (`review-writer-unchecked`) and select no merge. After the re-ask, a forged `success` over an App `failure` reads `failure`, so the HIGH arm starts a fixer; a forged `success` with no App status reads `absent`, so the review arm starts a review. A foreign `success` therefore never parks a PR. With no `Review app` key the judged reading is `unchecked`, the re-ask writes the newest state as today, and nothing holds.

### The commit-status gate

`packages/domain/src/rules/controller-gate.ts` gains a reading of `plot/review` writes beside `unpinnedMerges` (`:296`): `plot-host.sh commit-status <sha> <state> plot/review …` (op signature at `plot-host.sh:572`), and `gh api …/statuses/<sha>` with a `context` field of `plot/review`. `packages/board/src/server/entry/gate.ts` (the PreToolUse hook, bundled as `board/plot-gate.mjs` and launched by `skills/plot/scripts/plot-gates.sh` from `hooks/hooks.json`) refuses such a command and names `plot-review.mjs` as the route, the way it refuses an unpinned merge (`gate.ts:984`).

The hook reads the agent's own command line. A write that `plot-review.mjs` makes as its child process is not seen, which is the allowed route. A write from a script file the agent writes and then runs is not seen either; that is the gate's named limit.

### Threat boundary

- The writer check stops a `plot/review` status written by any login other than the Review app's bot.
- The commit-status gate stops an agent command that writes `plot/review` through Plot's own writer, which mints an App token from the `Review app` key (`plot-host.sh:572-604`) and so writes as `plot-review[bot]`. The key file is readable by the operator's user, so a process that bypasses the hook can still write as the App.
- Bitbucket stays unchecked (decision 7).
- The ruleset lists Admin (role 5) and Integration 5173644 as `always` bypass actors. Changing that is a person's decision outside this plan.

### Open Questions

- [x] Which field names the App? `creator.login`, compared with `<slug>[bot]`; the slug comes from `GET /app` with the App JWT. The bot user id (342578638) is not the App id (5317669), and no status field names the integration.
- [x] What does `pr-review` report for a foreign status? Every `plot/review` status with its writer; `githubReview` puts the trusted writer's newest in `state` and a newer foreign one in `foreign`. The read stays `ok`.
- [x] Which writer does the Bitbucket arm trust? Any account with write access. A later write with the same key replaces the earlier status and the status carries no writer (decision 7).
- [x] A repository with no `Review app` key: today's behaviour, reported as `unchecked`, no refusal (decision 5).

### Tests

Each test fails on `origin/main` before the change unless it says otherwise.

- `test/reconcile/host-pr-review.test.mjs` (not `host.test.mjs`, whose whole file runs for minutes): a stubbed `gh` returns `[forged success by jwloka (User), App failure by plot-review[bot] (Bot)]`, newest first; the GitHub arm emits both in `statuses` with their writers. A second case passes two pages and reads both. The stub's argv arms gain `--paginate` and `per_page=100` in the same commit, or every GitHub case in the file fails with `the read failed`.
- The existing fixtures gain `creator`: `host-pr-review.test.mjs:52` and `:143`, and `test/reconcile/scan-review-bypass.test.mjs:180` (fixture at `:47-53`) where the case reaches the writer check.
- `test/reconcile/scan-review-bypass.test.mjs`: a merged PR whose only `success` is foreign is reported.
- `reviewWriter` contract cases run against a temp `PLOT_REPO_ROOT` with its own committed `CLAUDE.md` holding a `Review app` line, and a second case with no such line answering `''`. A third case changes `Review app` in the working tree only and reads the committed value.
- `packages/domain/test/github-review.test.ts` (new): trusted `failure` plus newer foreign `success` gives `state: 'failure'` and `foreign` naming the login; foreign `success` with no trusted status gives `absent` plus `foreign`; foreign status older than the trusted one gives `foreign: null`; `trusted: ''` gives `unchecked`.
- `packages/domain/test/workflows-merge.test.ts` and `packages/domain/test/workflows-release-approve.test.ts`: a newer foreign status refuses `review-foreign-writer`; an `unread` writer refuses `review-writer-unread`; the trusted `success` merges; `unchecked` keeps today's answer.
- `packages/domain/test/host-shell.test.ts`: decodes `statuses`, and `reviewWriter` answers `unaskable` on a failed run.
- `packages/board/test/unit/review.test.ts`: a foreign `pending` with another run id does not supersede the run, and a foreign `failure` does not stop `markPending`.
- `packages/domain/test/pr-index.test.ts`: `reviewReaskPrNumbers` returns a `success` row whose `plotReviewCheckedSha` is not its head.
- `packages/domain/test/slice-pr-next.test.ts` and `packages/domain/test/release-prepare.test.ts`: an unchecked `success` row holds `review-writer-unchecked`; a checked one selects as today.
- `packages/fleet/test/unit/fleet-pr-index.test.ts`: the re-ask writes the judged state and `plotReviewCheckedSha`.
- `packages/domain/test/controller-gate.test.ts` and `test/reconcile/controller-gate.test.mjs`: `plot-host.sh commit-status <sha> success plot/review …` and `gh api repos/o/r/statuses/<sha> -f context=plot/review -f state=success` refuse; `plot-review.mjs <pr>` and a `commit-status` with another context pass.
- Bitbucket: `bitbucketReview`'s test feeds an overwritten status and pins that the reading reports `writer: ''` and the newest state; the answer does not change.

### Docs and comments

- `skills/plot/scripts/plot-host.sh:114-125`: the `pr-review` op header names `statuses` and the pagination.
- `packages/domain/src/rules/bitbucket-pr-reading.ts:113-127`: the header states decision 7.
- `docs/review-status-rollout.md:121`: what `pr-review` reads, who judges it, and the Bitbucket limit.
- A follow-up issue for `review-bypass:` comment authorship.

## Slices

### Writer check

- `feature/pr-review-accepts-a-plot-review` — `pr-review` reports every `plot/review` status with its writer, `githubReview` and `reviewPasses` judge it, `Host.reviewWriter` resolves the Review app's bot login from the default branch's config, `mergeAt` and `releaseApproveAt` refuse a newer foreign status, the board's review run reads only the trusted status, and the index re-asks an unchecked `success` row <!-- builds: the writer check on both read paths --> <!-- waits: feature/the-release-checks-are-counted -->

### Review write gate

- `feature/the-review-status-has-one-writer` — the controller gate refuses a `plot/review` commit-status write that does not come from `plot-review.mjs` <!-- builds: the plot/review write gate -->

## Notes

- Source: issue #3072, read from the tracker; nothing is written back to it.
- Not reproduced on the host. The stubbed `gh` cases in *Tests* reproduce the forged `success`; a live forged write is not part of any slice.
- Panel round 1 (2026-11-03): four jurors, unanimous `amend`; moderation in `.plot/panels/2026-11-03-pr-review-accepts-a-plot-review/panel.md`.
