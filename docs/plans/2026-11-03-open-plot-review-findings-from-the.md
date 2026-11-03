# Open plot-review findings from the 2026-10-29 delivery-loop plans

> Fix the 21 code and test defects that the review gate found in the delivery-loop plans of 2026-10-29 and that `origin/main` still carries.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3069
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches

## Changelog

- Merge gate, fixer arms, red-main repair, desk endings, release approval, idle-slice notices, plan issue comments and review comment tests no longer carry the open plot-review findings of 2026-10-29.

<!-- Board impact: none. The slices change domain rules, fleet controllers and board server routes, and no plan format, template, helper script or docs/plans layout. -->

## Motivation

The review gate filed 11 issues on 2026-10-29 for 9 plan PRs and 2 code PRs. All 11 PRs merged and all 9 plans are Released. A triage against `origin/main` at `321966041` on 2026-11-03 gives 56 verdicts: 19 fixed, 36 open, 1 obsolete. The one HIGH (#2925, a hand-cut desk gets a fresh agent) is fixed by the `.plot-worker.pid` guard in `c78164a5a` (#2960). No HIGH is open.

Of the 36 open verdicts, 21 are code or test defects and 15 are text errors in Released plans with no effect on the code. This plan covers the 21. Slices 1 to 4 change rules that decide merges, fixers and repairs, so they come first.

## Design

### Approach

One slice per area. Each slice fixes the findings listed under it and adds the test that fails without the fix. Source issue: #3069.

**Merge gate (`packages/domain/src/workflows/merge.ts`), #2922:**

- MEDIUM: `review-not-passed` refuses every caller, a person included. It has no opt-in for an estate without the review App, and it ignores `PrReviewReading.bypass` (`merge.ts:209-213`, `ports/host.ts:159-160`).
- MEDIUM: a default-branch head with no declared CI run never settles. `advanceSettled` keeps the old settled SHA (`rules/default-branch.ts:110-115`), so `merge.ts:242` refuses every person's merge with `default-branch-unsettled` until another push.
- MEDIUM: after fleetd's own merge, each scan until the next PR beat answers `merge` again. `mergeAt` asks `prState --with-checks` and `prReview` before the free tip read (`merge.ts:360-367`), and the no-retry memory records only `host-refused` (`packages/fleet/src/shared/auto-merge.ts:116`). Each scan costs two host calls.

**Slice PR rule (`packages/domain/src/rules/slice-pr-next.ts`), #2921 and #2923:**

- MEDIUM (latent): the re-status arm runs before the HIGH arm (`slice-pr-next.ts:385`). With a real verdict reading, it writes the verdict file's `failure` over the accepted `success`, and the two arms loop (`:177-190`). Every caller passes `verdict: { read: 'absent' }` today. (#2921)
- MEDIUM (latent): the re-status arm reads neither `config.autoReview` nor the start budget (`slice-pr-next.ts:177-190`); only the review arm does (`:283`, `:295`). No code starts a `--status-only` run today. (#2921)
- MEDIUM: red-CI attempts and HIGH attempts share one count of two (`rules/fixer-attempts.ts:26-37`). A PR whose two attempts answered red CI gets its HIGH ticketed and accepted with no fixer run on the HIGH (`slice-pr-next.ts:228-231`, `rules/ticket.ts:54`). (#2923)
- MEDIUM: red CI on a head that a fixer pushed starts no fixer. `ciRedArm` needs the desk dead or its corrections spent (`slice-pr-next.ts:264-266`), and a sealed desk whose loop went free reads `live` or `elsewhere` (`packages/fleet/src/shared/auto-fixer.ts:163-174`). (#2923)

**Red default branch repair, #2926:**

- MEDIUM: a green re-run of the first red SHA makes `redMainStep` answer `close-prs` without a read of the current settled state (`packages/domain/src/rules/repair.ts:255`). `repairStartTick` ignores `close-prs` (`packages/fleet/src/shared/repair-start.ts:152`), the revert tick answers `await-rerun` (`revert-start.ts:207`), and `keepsRepairRecord` keeps the episode (`rules/repair-pr.ts:202-207`). If a later commit is settled red, no repair and no revert starts.
- MEDIUM: the repair branch name derives from the record's own `lastGreenSha`, and `isRevertBranch` accepts any `bug/revert-<n>` without a check of the number (`rules/repair-pr.ts:25-39`, `:66-70`). A process that writes the record chooses the branch the exception admits.
- LOW: the revert commit is made after a re-ask of `record.firstRedSha`, not the settled SHA (`packages/fleet/src/shared/revert-start.ts:335`). The merge step refuses such a PR, so the cost is one wasted revert PR.

**Desk endings, #2925:**

- MEDIUM: the `holding-work` arm answers `leave` when the PR merged and `dirtyTree` reads `no` (`packages/domain/src/rules/ending-action.ts:352`). `dirtyTree` reads only `git status --porcelain` (`skills/plot/scripts/plot-worker-state.sh:527-531`), and the agent loop also ends `holding-work` for `unpushed-commits` (`packages/domain/src/workflows/agent-loop.ts:155-162`). A desk with an unpushed commit after the merge answers `leave`, and nobody is asked.

**Release approval, #2927 and #2918:**

- MEDIUM: `releaseFinish` books only the sprint's scope plans (`packages/domain/src/workflows/release-finish.ts:126-175`). A Delivered plan outside the sprint whose changesets ship under the tag stays Delivered, and the finish does not name it. (#2927)
- MEDIUM: `releaseApprove` refuses only an `unattended` caller (`packages/domain/src/workflows/release-approve.ts:73`). A master agent in the person's session can run `plot-ask.mjs release-approve`, which merges and pushes the finish to `main`. (#2927)
- LOW: a board that an unattended process started refuses a person's release and restart clicks. `POST /api/release` and the restart route pass the board's own `PLOT_UNATTENDED` (`packages/board/src/server/release.ts:211`, `packages/board/src/server/entry/deliver.ts:791-794`, `packages/board/src/server/restart.ts:70`). (#2918)

**Role agents, #2918:**

- MEDIUM: the reviewer still starts from `reviewerCommand` (`packages/board/src/server/entry/review.ts:345`), and no code loads `.claude/agents/reviewer.md`. Only the fixer (`packages/fleet/src/shared/auto-fixer.ts:457`) and main-repair (`packages/fleet/src/shared/repair-role.ts:115`) use the role builder. The plan's main security claim, a reviewer definition loaded from the default branch, has no owner.

**Idle-slice notification, #2933:**

- MEDIUM: each fleetd restart sets a new clock start (`packages/domain/src/rules/slice-idle.ts:90`, `packages/fleet/src/server/entry/registryd-main.ts:2557`), and the episode key includes the clock start (`slice-idle.ts:122`, `:127`). An unmoved slice notifies again one `Slice idle after` period after every restart. `createdAt` is always `''` (`registryd-main.ts:1128-1139`), so a slice with no `moved` line repeats on every restart.

**Plan issue comment (`packages/domain/src/adapters/tracker/tracker-plan-state.ts`), #2935:**

- LOW: two waiters can both break the same stale lock, and the second `unlink` removes the lock the first one took (`tracker-plan-state.ts:155-156`).
- LOW: `priorPlanLinesOf` splits on `\n` only (`packages/domain/src/rules/plan-issue-comment.ts:83`), so a comment edited in the GitHub web UI (`\r\n`) misreads its first ticket line.
- LOW: `writeWrittenHash` rewrites the shared hash file with no rename and outside the per-issue lock (`tracker-plan-state.ts:100-106`). Two writes on different issues can lose one entry.
- LOW: the `priorPlanLinesOf` docstring says parsing "stops there", and the loop continues (`plan-issue-comment.ts:74-77` against `:86-93`).
- LOW: `readWrittenHashes` returns `{}` on both branches of a ternary (`tracker-plan-state.ts:92`).
- LOW: the published changelog says an identical second write "makes no host call" (`CHANGELOG.md:463`), but the read-back runs on every write that omits a field (`tracker-plan-state.ts:213-215`). The test stubs the read and does not check the claim (`packages/domain/test/tracker-plan-state.test.ts:181-193`).

**Review comment tests and text, #2929:**

- MEDIUM: the test `three heads of one PR edit the same comment, never a second one` cannot fail. Each `rig` call builds a new empty `prComments` array (`packages/board/test/unit/review.test.ts:89`, `:552-561`).
- LOW: `finishReview` posts the findings comment only when `decision === 'none'` (`packages/board/src/server/entry/review.ts:481`). A second `ReviewIssueDecision` value stops the comment with no error.
- LOW: the test name at `review.test.ts:586` says the exit code does not change, and the test asserts `EXIT.issueNotOpened`.
- LOW: `docs/stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:53` says `plot-review` opens a follow-up issue, and line 155 of the same file says that behaviour is removed.
- LOW: the comment on `REVIEW_ISSUE_LABEL` (`packages/domain/src/rules/review-issue.ts:4`) describes follow-up issues that no longer open.

**Out of scope:** 15 text errors in Released plans (`Rounds:` undercounts in four plans and the panel record of `a-dead-desk-gets-a-fixer`, missing `waits:` markers in `fleet-roles-are-declared-agents.md`, wrong citations, a slug that does not match its title, and unresolved references in `a-red-default-branch-is-repaired.md`). A Released plan is a record and its errors change no behaviour. A person can correct them in one docs commit.

### Open Questions

- [ ] Merge gate, `review-not-passed`: honour a review opt-in config key, `PrReviewReading.bypass`, or both?
- [ ] Release approval: enforce who may approve (a refusal when a master agent calls `release-approve`), or only state the rule in the skill?
- [ ] Slice 6 changes a security boundary (the reviewer definition loads from the default branch). Does it need a Design phase first?

## Slices

### Merge gate

- `bug/the-merge-gate-reads-adoption` — `review-not-passed` honours the review opt-in and `bypass`; an `unknown` settled reading has a bound for a person's merge; the tip read runs before the host calls, or the no-retry memory covers `default-branch-unsettled` (#2922)

### Fixer attempts

- `bug/a-high-gets-its-own-fixer-attempts` — count HIGH attempts apart from CI-red attempts in `fixerAttemptsExhausted` and `reviewStatus`; give a red head that a fixer pushed to the fixer arm; move the re-status arm after the HIGH arm and gate it on `Auto-review` and the start budget (#2923, #2921)

### Red main

- `bug/a-red-main-stays-acted-on` — `redMainStep` reads the settled state before `close-prs`, or the refresh opens a new episode; the revert branch check compares the PR number; the revert start re-asks the settled SHA (#2926)

### Desk endings

- `bug/holding-work-reads-unpushed-commits` — the `holding-work` merge guard also requires no commit ahead of upstream; a fleet test with a merged PR, a clean tree and an unpushed commit (#2925)

### Release approval

- `bug/the-release-books-what-it-ships` — `releaseFinish` books or names every Delivered plan in the tagged head; `release-approve` states or enforces who may approve; board release and restart routes pass the clicking person as caller (#2927, #2918)

### Reviewer role

- `feature/the-reviewer-is-a-role-agent` — `reviewerCommand` moves onto the role builder and loads `reviewer.md` from the default branch (#2918)

### Idle slice

- `bug/an-idle-episode-survives-a-restart` — the episode key drops fleetd's start time; fleetd's start only delays the first notification (#2933)

### Plan comment

- `bug/the-plan-comment-parses-what-it-wrote` — the stale-lock break race, `\r\n` parsing, an atomic hash file, the docstring and the dead ternary (#2935)

### Review comment tests

- `bug/the-review-comment-tests-can-fail` — one shared `prComments` across heads, the comment posted for every non-zero finding count, the test name, and the two stale texts (#2929)

## Notes

- Created from tracker issue #3069 (https://github.com/plot-pm/plot/issues/3069), 2026-11-03. The issue's triage and slice proposal are the source; line references are against `origin/main` at `321966041` and may have moved.
- Refs #2918, #2921, #2922, #2923, #2924, #2925, #2926, #2927, #2929, #2933, #2935.
- Slices 1 to 4 change rules that decide merges, fixers and repairs, so they come first. The slices name no `waits:` marker because the issue gives no dependency among them; the reader decides whether to order them.
- Deliverable search: no slice builds a new artifact; each fixes an existing one.
