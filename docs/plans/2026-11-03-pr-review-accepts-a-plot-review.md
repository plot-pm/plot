# pr-review accepts a plot/review status from any writer

> `plot-host.sh pr-review` reads the first `plot/review` status on a head without checking who wrote it, so a status posted under the operator's login reads as the review App's answer.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3072
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3074 merged
- **Started:** 2026-11-06, Jan Wloka, `feature/pr-review-accepts-a-plot-review`
- **Started:** 2026-11-06, Jan Wloka, `feature/the-review-status-has-one-writer`

## Changelog

- `plot-host.sh pr-review` reports the writer (`creator.login`) of every `plot/review` status on the head, and a domain rule `githubReview` judges the reading against the bot login of the `Review app`. A `plot/review` status from any other writer never reads as `success`.
- `plot-ask.mjs merge` and `plot-ask.mjs release-approve` refuse `review-foreign-writer` when a `plot/review` status from another writer is newer than the Review app's own status, and `review-writer-unread` when the Review app's login cannot be resolved.
- fleetd judges the `plot/review` reading of an open PR whose index row reads `success` or `failure` before any rule acts on it, and keeps the judgment in its own fields, `plotReviewJudged` and `plotReviewCheckedSha`, which a later rollup write does not overwrite. A foreign status newer than the Review app's own sends the PR back for one review run, so it neither merges nor parks the PR.
- A `plot/review` commit-status write that does not come from `plot-review.mjs` is refused in the main checkout, at a fleet desk and for a role agent, through one command reading in `rules/role-gate.ts`.

<!-- Board impact: none in the plan format, the template or the docs/plans layout. The PR index row gains three optional fields (`plotReviewJudged`, `plotReviewCheckedSha`, `plotReviewCheckedAt`); `slicePrNext`, `release-prepare` and `revert-start-world` read them. -->

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

Taken for the plot-review findings on `0bd669857` (2026-11-03). They refine decisions 1, 4 and 6 and replace none of them.

10. **One command reading, two gates.** `rules/role-gate.ts` holds the one reading of a `plot/review` write. The role-deny gate applies it to a role agent; the controller gate applies it in the main checkout and at a desk, before its linked-worktree return. No second parser is written in `controller-gate.ts`.
11. **The judgment has its own fields.** The index keeps the judged state in `plotReviewJudged` beside the rollup's `plotReview`. A rollup write never clears the judgment unless the rollup's `plotReviewAt` changed on the same head, or the head moved.
12. **A newer foreign status sends the PR back for review.** Where `foreign` is not `null` over a trusted `success`, `pending` or `absent`, the judged state is `absent`, and the review arm starts one review run within the existing per-head start budget. The run's own statuses are newer than the foreign one, so the next judgment reads `foreign: null`. No hold reason and no board surface are added.

### The pr-review reading

The GitHub arm reads the statuses with `gh api --paginate "repos/{owner}/{repo}/commits/<head>/statuses?per_page=100"` and passes the pages to `jq` through stdin, never through `--argjson`. It emits one JSON line:

`{"sha","state","description","time","bypass","statuses":[{"state","description","time","writer"}]}`

`statuses` holds the `plot/review` statuses on the head, newest first, and `writer` is `creator.login` (`''` where the host gives none). `state`, `description` and `time` keep today's meaning (the newest status from any writer) so that a consumer which has not moved yet reads what it read before. The shipped shell line count must not grow (`scripts/check-shell-lines.sh`).

The Bitbucket arm (`plot-jenkins-pr-checks.mjs review`, `bitbucketReview`) emits the same `statuses` field with `writer: ''`. Its header states the limit in decision 7.

`PrReviewReading` (`packages/domain/src/ports/host.ts:150-161`) gains `statuses`, and its TSDoc says what `state` means now. `host-shell.ts:521-522` decodes the field, and `host-fixture.ts:205` and the op header at `plot-host.sh:114-125` follow.

### The trusted writer

A new host port operation `Host.reviewWriter(): Promise<PortResult<string>>`, implemented in the host adapter:

- It reads `Review app` from the default branch's committed `## Plot Config` (`CLAUDE.md`, then `AGENTS.md`, the file order `plot-config.sh` uses, read through `git show origin/<default>:<file>`). The working tree of a desk or a PR head never supplies the value.
- It does not fetch. A stale `origin/<default>` answers the value as last fetched; a `Review app` changed on the host since then reads the old login until the next fetch, and that login was the trusted one at the fetched commit.
- No `origin/<default>` ref (no remote, or never fetched): it answers `unaskable`, which `githubReview` reads as `unread` and the controllers refuse as `review-writer-unread`. It never falls back to the working tree's file.
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

The row in `packages/domain/src/entities/pr-index.ts` gains three optional fields:

- `plotReviewJudged`: the judged state, one of `success`, `failure`, `pending`, `absent`, `error`;
- `plotReviewCheckedSha`: the head the judgment read;
- `plotReviewCheckedAt`: the rollup's `plotReviewAt` at the time of the judgment.

**The rollup write keeps the judgment.** `pr-refresh.ts:1180` rebuilds `plotReview` from the rollup on every rich refresh, and the row is rebuilt from the host record with only some fields carried from `predecessor`. The row builder carries the three judged fields from `predecessor` when `predecessor.headSha` equals the new head and `predecessor.plotReviewCheckedAt` equals the new rollup `plotReviewAt`, and drops them otherwise. A rollup that still names the status the judgment read therefore keeps the judgment, and a newer status on the same head, or a new head, clears it.

**The re-ask judges.** `reviewReaskPrNumbers` (`packages/domain/src/rules/pr-index.ts:330`) keeps today's set and also returns an OPEN, non-draft, in-scope row whose rollup `plotReview` is `success` or `failure` on its `headSha` and whose `plotReviewCheckedSha` is not that head. The `ciChecks === 'green'` condition does not apply to these rows, because the HIGH arm and `revert-start-world` act on a `failure` whatever CI reads. For each number `pr-refresh.ts` (`:1646-1653`) asks `host.prReview`, judges the answer with `githubReview`, and writes `plotReviewJudged`, `plotReviewCheckedSha` and `plotReviewCheckedAt`. `host.reviewWriter` is asked once per pass, not once per row. With no `Review app` key the judgment is `unchecked`: the pass writes the rollup state as `plotReviewJudged` and asks no `pr-review`. A carried judgment is not re-asked, so a row costs one statuses read per new `plot/review` status, not one per delta.

**The judged state.** From the `githubReview` answer:

| Trusted state | `foreign` | `plotReviewJudged` |
|---|---|---|
| any | `null` | the trusted state |
| `failure` | not `null` | `failure` |
| `success`, `pending` or `absent` | not `null` | `absent` (decision 12) |
| writer `unread` | any | not written; the row stays unchecked |

**The consumers.** `slicePrNext` (`slice-pr-next.ts:181`, `:227`, `:324`), `release-prepare` (`:199`, `:260-267`) and `revert-start-world` (`:167`) read `plotReviewJudged` where `plotReviewCheckedSha` equals `headSha`. Where the rollup reads `success` or `failure` and no judgment holds for the head, they hold the PR with `review-writer-unchecked` and select no merge, no fixer and no revert. The review arm reads the rollup's `absent`, `pending` and `error` as today.

**The cases.**

- A foreign `success` over an App `failure` judges `failure`, so the HIGH arm starts a fixer.
- A foreign `success` with no App status judges `absent`, so the review arm starts a review.
- A foreign `success`, `pending` or `failure` newer than an App `success` judges `absent`. The review arm starts one run: `markPending` reads the trusted `success`, which it does not refuse, and the run writes `pending` and its verdict, both newer than the foreign status. The next judgment reads `foreign: null`. The merge arm never selects the PR meanwhile, because the judged state is not `success`, so `mergeAt` is not retried every pass.
- A foreign writer that writes again after each run spends the per-head start budget (`reviewStartAllowed`, `slice-pr-next.ts:295`); the review arm then answers `budget-spent` and the merge arm `not-passed`, and the PR waits for a person.
- With no `Review app` key the judgment is `unchecked`, the rollup state passes through, and nothing holds.

### The commit-status gate

**Two gates exist today, and neither covers a desk.**

- The role-deny gate (`roleDenyGateOf`, `packages/board/src/server/entry/gate.ts:1070`) already refuses `plot-host.sh commit-status` with any context through `callsCommitStatus` (`packages/domain/src/rules/role-gate.ts:75`, applied at `:276`), tested at `packages/board/test/unit/role-deny-gate.test.ts:21` with `plot/review`. It is in `NAME_ONLY_GATES` (`gate.ts:1121`), so only a role agent whose settings file names it runs it: a fixer, an unblocker or a main-repair agent. The master agent and a desk do not run it. It does not read the `gh api …/statuses` form.
- The controller gate (`controllerGateOf`) runs for the master agent and a desk through `--all` (`hooks/hooks.json` → `plot-gates.sh` → `plot-gate.mjs --all`). It reads a command only where `mayRunController` matches it (`wants` at `gate.ts:944`, `named` at `:949`) or the caller is an unattended desk, and it returns `null` for every linked worktree at `gate.ts:981` (`if (linked) return null;`), before the unpinned-merge refusal at `:984`. A desk is a linked worktree, so a refusal placed beside `unpinnedMerges` never runs there.

**The one reading.** `rules/role-gate.ts` gains `writesReviewStatus(command)`. It answers true for:

- `plot-host.sh commit-status <sha> <state> plot/review …` (op signature at `plot-host.sh:572`);
- `gh api` naming a `statuses/<sha>` path with a `context` field of `plot/review`, through `-f`, `-F`, `--field` or `--raw-field`, quoted or not.

**Where it runs.**

- Role agents: `roleDeniesCommand` (`role-gate.ts:275`) refuses `callsCommitStatus(command) || writesReviewStatus(command)`, so the role-deny gate also refuses the `gh api` form.
- Main checkout and desk: `controllerGateOf` calls `writesReviewStatus` first in `ask`, before the `named`/`atDesk` return, before the git read and before the `linked` return at `:981`. `wants` gains `writesReviewStatus(command)`, so an attended command is read too. The refusal names `plot-review.mjs` as the route. Because the check precedes the git read, a git reading that throws does not let the write through.

`controller-gate.ts` gains no parser; `gate.ts` imports `writesReviewStatus` beside the role-gate names it already imports (`gate.ts:29`).

The hook reads the agent's own command line. A write that `plot-review.mjs` makes as its child process is not seen, which is the allowed route. Two writes are not seen and are the gate's named limits: a script file the agent writes and then runs, and `gh api … --input <file>`, whose `context` lies in a file.

### Threat boundary

- The writer check stops a `plot/review` status written by any login other than the Review app's bot.
- The commit-status gate stops an agent command line that writes `plot/review` through Plot's own writer, which mints an App token from the `Review app` key (`plot-host.sh:572-604`) and so writes as `plot-review[bot]`, or through `gh api …/statuses`. It runs in the main checkout, at a desk and for a role agent. It does not see a write from a script file the agent runs, or a `gh api --input` body.
- The key file is readable by the operator's user, so a process that bypasses the hook can still write as the App. A write under the operator's own login is still caught by the writer check, whatever route it took.
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
- `reviewWriter` contract cases run against a temp repository with a bare `origin` remote: the fixture commits a `CLAUDE.md` holding a `Review app` line, pushes it to `origin`, and fetches, so `origin/<default>` exists and the designed path is the one read. A second case pushes a `CLAUDE.md` with no such line and answers `''`. A third case changes `Review app` in the working tree only and reads the pushed value. A fourth case has no `origin/<default>` ref (no remote) and answers `unaskable`, never the working tree's value. A fifth case pushes a new `Review app` value without fetching and reads the old one.
- `packages/domain/test/github-review.test.ts` (new): trusted `failure` plus newer foreign `success` gives `state: 'failure'` and `foreign` naming the login; foreign `success` with no trusted status gives `absent` plus `foreign`; foreign status older than the trusted one gives `foreign: null`; `trusted: ''` gives `unchecked`.
- `packages/domain/test/workflows-merge.test.ts` and `packages/domain/test/workflows-release-approve.test.ts`: a newer foreign status refuses `review-foreign-writer`; an `unread` writer refuses `review-writer-unread`; the trusted `success` merges; `unchecked` keeps today's answer.
- `packages/domain/test/host-shell.test.ts`: decodes `statuses`, and `reviewWriter` answers `unaskable` on a failed run.
- `packages/board/test/unit/review.test.ts`: a foreign `pending` with another run id does not supersede the run, and a foreign `failure` does not stop `markPending`.
- `packages/domain/test/pr-index.test.ts`: `reviewReaskPrNumbers` returns a `success` row and a `failure` row whose `plotReviewCheckedSha` is not their head, a `failure` row whose CI is red included; it does not return a row whose judgment holds for its head.
- `packages/domain/test/github-review.test.ts` also covers the judged-state table: a foreign `success`, `pending` or `failure` newer than a trusted `success` judges `absent`; a foreign status over a trusted `failure` judges `failure`.
- `packages/domain/test/slice-pr-next.test.ts` and `packages/domain/test/release-prepare.test.ts`: a `success` or `failure` row with no judgment on its head holds `review-writer-unchecked`; a judged `success` selects as today; a row whose rollup reads `success` and whose `plotReviewJudged` reads `absent` on the head answers `review` from the review arm and `none` from the merge arm, and answers `none('budget-spent')` from the review arm once the per-head start budget is spent.
- `packages/fleet/test/unit/fleet-pr-index.test.ts`, across refreshes: refresh 1 carries a rollup `success`, and the re-ask writes `plotReviewJudged: 'failure'` with the checked head and `plotReviewCheckedAt`. Refresh 2 carries the same rollup `success` with the same `plotReviewAt`; the row keeps `plotReviewJudged: 'failure'` and the pass asks no `pr-review`. Refresh 3 carries a newer `plotReviewAt` on the same head; the judgment is dropped and re-asked. A fourth case moves the head and drops the judgment. A fifth case judges a foreign status newer than an App `success` as `absent`, and the merge tick (`packages/fleet/src/shared/auto-merge.ts`) calls `mergeAt` on no pass.
- `packages/domain/test/role-gate.test.ts`: `writesReviewStatus` answers true for `plot-host.sh commit-status <sha> success plot/review …`, `gh api repos/o/r/statuses/<sha> -f context=plot/review -f state=success`, the `-F`, `--field` and `--raw-field` forms and a quoted `'context=plot/review'`; false for `plot-review.mjs <pr>`, a `commit-status` with another context, and a `gh api …/statuses/<sha>` read with no `context` field.
- `packages/board/test/unit/role-deny-gate.test.ts`: the `gh api …/statuses` form refuses beside the existing `:21` case.
- `packages/board/test/unit/controller-gate-readings.test.ts`: `controllerGateOf` refuses both write forms with a `where` reading of `linked: true` (a desk) and of `linked: false` (the main checkout), with `PLOT_UNATTENDED` set and unset, and with a `where` reading that throws. This test fails on `origin/main` for the linked case.
- `test/reconcile/controller-gate.test.mjs`: the hook refuses both forms when run from a real linked worktree (`git worktree add` in the fixture repository) and from its main checkout; `plot-review.mjs <pr>` and a `commit-status` with another context pass in both.
- Bitbucket: `bitbucketReview`'s test feeds an overwritten status and pins that the reading reports `writer: ''` and the newest state; the answer does not change.

### Docs and comments

- `skills/plot/scripts/plot-host.sh:114-125`: the `pr-review` op header names `statuses` and the pagination.
- `packages/domain/src/rules/bitbucket-pr-reading.ts:113-127`: the header states decision 7.
- `docs/review-status-rollout.md:121`: what `pr-review` reads, who judges it, and the Bitbucket limit.
- A follow-up issue for `review-bypass:` comment authorship.

## Slices

### Writer check

- `feature/pr-review-accepts-a-plot-review` — `pr-review` reports every `plot/review` status with its writer, `githubReview` and `reviewPasses` judge it, `Host.reviewWriter` resolves the Review app's bot login from the default branch's config, `mergeAt` and `releaseApproveAt` refuse a newer foreign status, the board's review run reads only the trusted status, and the index judges an unchecked `success` or `failure` row into `plotReviewJudged`, which a later rollup write keeps <!-- builds: the writer check on both read paths --> <!-- waits: feature/the-release-checks-are-counted --> → #3187

### Review write gate

- `feature/the-review-status-has-one-writer` — `writesReviewStatus` in `rules/role-gate.ts` reads a `plot/review` commit-status write, the role-deny gate refuses it for a role agent, and the controller gate refuses it in the main checkout and at a desk before its linked-worktree return, unless it comes from `plot-review.mjs` <!-- builds: the plot/review write gate -->

## Notes

- Source: issue #3072, read from the tracker; nothing is written back to it.
- Not reproduced on the host. The stubbed `gh` cases in *Tests* reproduce the forged `success`; a live forged write is not part of any slice.
- Panel round 1 (2026-11-03): four jurors, unanimous `amend`; moderation in `.plot/panels/2026-11-03-pr-review-accepts-a-plot-review/panel.md`.
- Amended for plot-review findings on 0bd669857 (2026-11-03).
