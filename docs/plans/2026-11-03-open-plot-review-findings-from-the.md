# Open plot-review findings from the 2026-10-29 delivery-loop plans

> Fix the open code, test and text defects that the review gate found in the delivery-loop plans of 2026-10-29 and that `origin/main` still carries, except release approval and the reviewer role, which move to #3077.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #3069
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/holding-work-reads-unpushed-commits`

## Changelog

- Merge gate, fixer arms, red-main repair, desk endings, idle-slice notices, plan issue comments and review comment tests no longer carry the open plot-review findings of 2026-10-29.

<!-- Board impact: none. The slices change domain rules, fleet controllers, one board entry (`entry/review.ts`) and its test, and no plan format, template, helper script or docs/plans layout. -->

## Motivation

The review gate filed 11 issues on 2026-10-29 for 9 plan PRs and 2 code PRs. All 11 PRs merged and all 9 plans are Released. A triage against `origin/main` at `321966041` on 2026-11-03 gives 56 verdicts: 19 fixed, 36 open, 1 obsolete. The one HIGH (#2925, a hand-cut desk gets a fresh agent) is fixed by the `.plot-worker.pid` guard in `c78164a5a` (#2960). No HIGH is open.

Of the 36 open verdicts, 15 are text errors in Released plans with no effect on the code, and stay with no slice. Four findings (release approval and the reviewer role) change a trust boundary and move to #3077 for a Design phase. One finding (`review-not-passed` refuses every caller) is decided as correct behaviour. This plan covers the remaining 22 findings in seven slices: 15 have a test that fails on `origin/main`, and 7 are text-only or type-only. Slices 1 to 4 change rules that decide merges, fixers and repairs.

Line references are against `origin/main` at `a518552f1`. No commit between `321966041` and `a518552f1` touches a cited path.

## Design

### Approach

One slice per area. Each slice fixes the findings listed under it and adds the test named under *Tests* that fails without the fix. A text-only or type-only finding names how it is checked instead. Source issue: #3069.

**Merge gate (`packages/domain/src/workflows/merge.ts`), #2922:**

- Decided, no change: `review-not-passed` refuses every caller, a person included (`merge.ts:209-213`). `Review required since` already decides adoption, and fleetd never honours a `review-bypass:` comment (`PrReviewReading.bypass`, `ports/host.ts:159-160`, stays an after-the-fact audit in `rules/review-bypass.ts`). No opt-in key is added.
- MEDIUM: a default-branch head whose runs read `unknown` never settles. `advanceSettled` keeps the old settled reading (`rules/default-branch.ts:110-115`), so `merge.ts:242` refuses every person's merge with `default-branch-unsettled` until another push. **Fix:** in `merge()` only, for `caller === 'person'` only, a head that reads `unknown` for longer than `Checks wait` since `headSince` (`entities/default-branch.ts:64`) passes the tip check. The bound never writes `settled`, never lifts `default-branch-red`, and never applies to `fleetd`.
- MEDIUM: after fleetd's own merge, each scan until the next PR beat answers `merge` again. `mergeAt` asks `prState --with-checks` (`merge.ts:360`) and `prReview` (`:366`) before or beside the free tip read (`:364-367`), and the no-retry memory records only `host-refused` (`packages/fleet/src/shared/auto-merge.ts:116`). Each scan costs two host calls. **Fix, one layer:** `mergeAt` reads the default branch and its remote tip first, and returns `default-branch-unsettled` with no `prState` or `prReview` call when the tip differs from the reading's settled SHA. The `slicePrNext` merge arm and the fleet no-retry memory do not change. A memory keyed by (PR, head) would strand a PR on a transient refusal.

**Fixer arms (`packages/domain/src/rules/slice-pr-next.ts`), #2921 and #2923:**

- MEDIUM (latent): the re-status arm runs before the HIGH arm (`slice-pr-next.ts:385`). With a real verdict reading, it writes the verdict file's `failure` over the accepted `success`, and the two arms loop (`:177-190`). Every caller passes `verdict: { read: 'absent' }` today. **Fix:** move `restatusArm` after `highArm` and update the arm order docstring (`:372-376`) and the arm numbers in the JSDoc. (#2921)
- MEDIUM (latent): the re-status arm reads neither `config.autoReview` nor the start budget (`:177-190`); only the review arm does (`:283`, `:295`). No code starts a `--status-only` run today. **Fix:** gate `restatusArm` on both, as `reviewArm` does. (#2921)
- MEDIUM: red-CI attempts and HIGH attempts share one count of two (`rules/fixer-attempts.ts:26-37`). A PR whose two attempts answered red CI gets its HIGH ticketed and accepted with no fixer run on the HIGH (`slice-pr-next.ts:228-231`, `rules/ticket.ts:54`), and the merge arm then merges it. **Fix:** count by the existing `finding.kind` (`entities/fixer-attempts.ts:21-23`). `FIXER_ATTEMPTS_VERSION` stays 1, because a version bump reads every existing record as `unreadable` and `fixerInFlight` holds an unreadable record forever. `FixerReading.exhausted` (`slice-pr-next.ts:20`) splits into a HIGH and a CI answer, and the fleet callers that build it change with it: `auto-fixer.ts:377` (`fixerAttemptsExhausted`), `auto-ticket.ts:178` (`reviewStatus`), and every test filler of `FixerReading`. (#2923)
- MEDIUM: red CI on a head that a fixer pushed starts no fixer. `ciRedArm` needs the desk dead or its corrections spent (`slice-pr-next.ts:264-266`), and a sealed desk whose loop went free reads `live` or `elsewhere` (`packages/fleet/src/shared/auto-fixer.ts:163-174`). **Fix:** a head counts as fixer-pushed only when the fixer attempts record proves it and no fixer is in flight. A desk that reads `elsewhere` or `live` never counts as gone. Each attempt records today only the head it started for (`entities/fixer-attempts.ts:58-59`). If those fields cannot name the pushed head, the slice adds one optional field for it, written by the tick that ends the attempt, and keeps `FIXER_ATTEMPTS_VERSION` at 1. (#2923)

**Red default branch repair, #2926:**

- MEDIUM: a green re-run of the first red SHA makes `redMainStep` answer `close-prs` without a read of the current settled state (`packages/domain/src/rules/repair.ts:255`). `repairStartTick` falls through to `return 'none'` on `close-prs` (`packages/fleet/src/shared/repair-start.ts:152`), the revert tick answers `await-rerun` (`revert-start.ts:207`), and `keepsRepairRecord` keeps the episode (`rules/repair-pr.ts:202-207`). If a later commit is settled red, no repair and no revert starts. **Fix:** `redMainStep` reads the settled state before it answers `close-prs`. It answers `close-prs` only while the current settled reading is green. A green re-run of `firstRedSha` with a later SHA settled red answers a repair step and closes nothing. The record is not replaced, so a person's recorded `repairPr` stays.
- MEDIUM: the repair branch name derives from the record's own `lastGreenSha`, and `isRevertBranch` accepts any `bug/revert-<n>` without a check of the number (`rules/repair-pr.ts:25-39`, `:66-70`). **Fix:** the check compares `<n>` with the existing `RepairRecord.revertedPr` (`entities/repair-record.ts:136`), which `revert-start.ts:342` writes before it opens the revert PR. A record with no `revertedPr` refuses `repair-branch-mismatch`. The docstring at `rules/repair-pr.ts:33-34` ("The record holds no number for the reverted PR") is false and is corrected. The record schema does not change. This narrows the accepted branch shape; it does not move the trust boundary, because `revertedPr` lives in the same record.
- LOW: the revert commit is made after a re-ask of `record.firstRedSha` only (`packages/fleet/src/shared/revert-start.ts:335`). **Fix:** re-ask both `firstRedSha` and the settled SHA, and revert only when both read red. The `firstRedSha` re-ask stays, because it stops a revert of a PR whose red was a flake.

**Desk endings, #2925:**

- MEDIUM: the `holding-work` arm answers `leave` when the PR merged and `dirtyTree` reads `no` (`packages/domain/src/rules/ending-action.ts:352`). `dirtyTree` comes from `dirtyTreeReading(heldFiles)` (`packages/fleet/src/server/entry/registryd.ts:1267`), which reads held files only, and the agent loop also ends `holding-work` for `unpushed-commits` (`packages/domain/src/workflows/agent-loop.ts:155-162`). A desk with an unpushed commit after the merge answers `leave`, and nobody is asked. **Fix:** the decision stays in the domain rule `ending-action.ts`. `EndingActionReadings` gains an unpushed-commits reading (`none`, `some`, `unanswerable`). The fleet controller reads it through the existing `Trees.unpushedCommits` port (`packages/domain/src/ports/trees.ts:457`, `adapters/trees/trees-git.ts:559`) at the `endingAction` call in `registryd.ts:1259`, and passes filler at the second call site (`registryd.ts:1816-1823`). A merged desk with an unpushed commit, or with an `unanswerable` reading, answers `needs-a-person`, never `start-fresh` and never `leave`. No shell line changes; `plot-worker-state.sh` is not the source.

**Idle-slice notification, #2933:**

- MEDIUM: each fleetd restart sets a new clock start (`packages/domain/src/rules/slice-idle.ts:90`, `packages/fleet/src/server/entry/registryd-main.ts:2557`), and the episode key includes the clock start (`slice-idle.ts:127`). An unmoved slice notifies again one `Slice idle after` period after every restart. `createdAt` is always `''` (`registryd-main.ts:1128-1139`), so a slice with no `moved` line repeats on every restart. **Fix:** the episode key drops fleetd's start time; fleetd's start only delays the first notification. A slice with no `moved` line keeps one key for its whole life, and that is the intended answer.

**Plan issue comment (`packages/domain/src/adapters/tracker/tracker-plan-state.ts`), #2935:**

- LOW: two waiters can both break the same stale lock, and the second `unlink` removes the lock the first one took (`tracker-plan-state.ts:155-156`).
- LOW: `priorPlanLinesOf` splits on `\n` only (`packages/domain/src/rules/plan-issue-comment.ts:83`), so a comment edited in the GitHub web UI (`\r\n`) misreads its first ticket line.
- LOW: `writeWrittenHash` rewrites the shared hash file with no rename and outside the per-issue lock (`tracker-plan-state.ts:100-106`). Two writes on different issues can lose one entry.
- LOW, text-only: the `priorPlanLinesOf` docstring says parsing "stops there", and the loop continues (`plan-issue-comment.ts:74-77` against `:86-93`).
- LOW, no behaviour: `readWrittenHashes` returns `{}` on both branches of a ternary (`tracker-plan-state.ts:92`).
- LOW, text-only: the published 2.30.0 changelog says an identical second write "makes no host call" (`CHANGELOG.md:463`), but the read-back runs on every write that omits a field (`tracker-plan-state.ts:213-215`); the read-back is deliberate for progress writes (`:208-212`). **Fix:** the text is corrected, not the behaviour. `CHANGELOG.md` is generated by changesets (`.changeset/changelog-functions.js`), so the correction goes in this slice's changeset description, which the next release publishes. The 2.30.0 entry stays as published.

**Review comment tests and text, #2929:**

- MEDIUM: the test `three heads of one PR edit the same comment, never a second one` cannot fail. Each `rig` call builds a new empty `prComments` array (`packages/board/test/unit/review.test.ts:89`, `:552-561`).
- LOW, type-only: `finishReview` posts the findings comment only when `decision === 'none'` (`packages/board/src/server/entry/review.ts:481`). `ReviewIssueDecision` is the single literal `'none'` (`packages/domain/src/rules/review-issue.ts:8`, `:20`), so the guard is a tautology. **Fix:** remove `reviewIssue` and `ReviewIssueDecision` from the domain and the guard from the board, so the comment posts for every non-zero finding count.
- LOW, text-only: the test name at `review.test.ts:586` says the exit code does not change, and the test asserts `EXIT.issueNotOpened`.
- LOW, text-only: `docs/stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md:53` says `plot-review` opens a follow-up issue, and line 155 of the same file says that behaviour is removed. Line 53 also says fleetd never calls `plot-review`, which #3070's `feature/the-release-review-is-switched-on` (`Auto-review: true`) makes false.
- LOW, text-only: the comment on `REVIEW_ISSUE_LABEL` (`review-issue.ts:4`) describes follow-up issues that no longer open.

**Moved to #3077:** release approval (#2927 findings 1 and 2, the #2918 board caller LOW) and the reviewer role (#2918 MEDIUM). Both change a trust boundary and need a Design phase.

**Out of scope:** 15 text errors in Released plans (`Rounds:` undercounts in four plans and the panel record of `a-dead-desk-gets-a-fixer`, missing `waits:` markers in `fleet-roles-are-declared-agents.md`, wrong citations, a slug that does not match its title, and unresolved references in `a-red-default-branch-is-repaired.md`). A Released plan is a record and its errors change no behaviour. A person can correct them in one docs commit.

### Decisions

jwloka, 2026-11-03, after the first panel round:

1. No review opt-in. `review-not-passed` keeps refusing every caller. `Review required since` already decides adoption. fleetd never honours a `review-bypass:` comment.
2. Release approval and the reviewer role leave this plan for #3077 and a Design phase.
3. The changelog read-back claim is corrected in text through a changeset description, not in behaviour.

### Ordering

- `bug/a-high-gets-its-own-fixer-attempts` lands before or with #3070's `feature/the-release-review-is-switched-on`. That slice sets `Auto-review: true`, which makes every slice PR able to get HIGH findings, so the shared count of two decides live PRs from then on. A `waits:` marker points from the waiting branch, so this order is a note here and a `waits:` on #3070's line, not on this plan's.
- Slices 2 and 3 edit `rules/slice-pr-next.ts` and `slice-pr-next.test.ts`, which #3068's `feature/fleetd-merges-as-the-merger-app` rewrites (`mergeArm`, `SlicePrNextReadings`, `:405-408`), and #3068 adds a repair-arm test with a `bug/revert-<n>` fixture. Both wait on it.
- Slice 1 waits on #3074's `feature/pr-review-accepts-a-plot-review`, which decides which writer's `plot/review` counts. Slice 1 keeps `review-not-passed` as the only review gate, so that gate must read a trusted writer first.
- Slices 1 and 3 both edit the `CLAUDE.md` paragraph *One hold reads a non-terminal answer* (`default-branch-unsettled` for slice 1, the `bug/revert-<pr>` rule for slice 3). The second to merge rebases on the first. Slice 1 never writes `settled`, so it does not change what `redMainStep` reads.
- Slices 2 and 3 share `slice-pr-next.test.ts` (the arm order, and the revert fixture at `:468`). The second to merge rebases on the first.
- Slice 5 (idle slice) edits `registryd-main.ts`, where #3067's `feature/fleetd-starts-the-unblocker` exports the tick options builder. The conflict is textual only.
- Slice 6 (plan comment) fixes the lock and the hash file on the path #3071's `bug/release-approve-tells-its-tracker` calls once per booked plan. It should land before that slice.
- Slice 7 (review comment) corrects `DESIGN-delivery-loop.md:53`, which #3068 also edits (`:37`) and which #3070 makes false. Slice 7 corrects both halves of line 53.

## Slices

### Merge gate

- `bug/the-merge-gate-bounds-an-unknown-head` <!-- waits: feature/pr-review-accepts-a-plot-review --> — a person's merge passes a default-branch head that reads `unknown` past `Checks wait`, with no `settled` write; `mergeAt` reads the tip before any host call (#2922)

### Fixer attempts

- `bug/a-high-gets-its-own-fixer-attempts` <!-- waits: feature/fleetd-merges-as-the-merger-app --> — count HIGH and CI-red attempts apart by `finding.kind`; give a red head that the fixer record proves fixer-pushed to the fixer arm; move the re-status arm after the HIGH arm and gate it on `Auto-review` and the start budget (#2923, #2921)

### Red main

- `bug/a-red-main-stays-acted-on` <!-- waits: feature/fleetd-merges-as-the-merger-app --> — `redMainStep` reads the settled state before `close-prs`; the revert branch check compares `RepairRecord.revertedPr`; the revert start re-asks the first red SHA and the settled SHA (#2926)

### Desk endings

- `bug/holding-work-reads-unpushed-commits` — `endingAction` reads unpushed commits through `Trees.unpushedCommits`; a merged desk with an unpushed commit answers `needs-a-person` (#2925)

### Idle slice

- `bug/an-idle-episode-survives-a-restart` — the episode key drops fleetd's start time; fleetd's start only delays the first notification (#2933)

### Plan comment

- `bug/the-plan-comment-parses-what-it-wrote` — the stale-lock break race, `\r\n` parsing, an atomic hash file, the docstring, the dead ternary, and the changelog text through the changeset (#2935)

### Review comment tests

- `bug/the-review-comment-tests-can-fail` — one shared `prComments` across heads, the dead `reviewIssue` decision removed, the test name, and the two stale texts (#2929)

## Tests

Each finding names its test file and test name. "Changes" marks an existing test whose expectation the slice changes on purpose; any other existing test that fails is a regression.

### Merge gate tests

- `packages/domain/test/workflows-merge.test.ts`, new: `passes a person's merge past a head that reads unknown longer than Checks wait`, `keeps default-branch-unsettled for fleetd on the same reading`, `keeps default-branch-red on a red settled reading whatever the head reads`.
- `packages/domain/test/workflows-merge.test.ts:244-248` (`refuses default-branch-unsettled on a pending head past a green settled commit`): unchanged on purpose. The bound covers `unknown`, not `pending`.
- `packages/domain/test/workflows-merge.test.ts` (`mergeAt` block, `:289`), new: `asks the host nothing when the tip differs from the settled SHA`, with a counting host fake that asserts zero `prState` and `prReview` calls.
- `packages/domain/test/default-branch.test.ts`: unchanged on purpose. `advanceSettled` does not change.

### Fixer attempts tests

- `packages/domain/test/fixer-attempts.test.ts`, new: `two CI-red attempts leave the HIGH budget unspent`, `decodes a record written by the current schema at version 1`.
- `packages/domain/test/ticket.test.ts`, new: `reviewStatus does not accept a HIGH whose own attempts are unspent`.
- `packages/domain/test/slice-pr-next.test.ts`, new: `starts the fixer for a HIGH after two CI-red attempts`; `starts the fixer on a red head the fixer record proves fixer-pushed`; `answers none('desk-alive') for a red head the desk pushed while the desk reads elsewhere`; `the HIGH arm's accepted success survives a failure verdict file` (a combined case over both arms); `the re-status arm answers none with Auto-review off and with the budget spent`.
- `packages/domain/test/slice-pr-next.test.ts:127-139` (re-status cases) and the HIGH arm block at `:181-256`: changes, because the arm order changes and the fixer reading splits.
- `packages/fleet/test/unit/auto-fixer.test.ts`, new: `deskDeadFromWorkerState never reads elsewhere as dead`.

### Red main tests

- `packages/domain/test/repair.test.ts:123` (`a green re-run answers none`): changes; the input gains a green settled reading. New: `a green re-run of the first red SHA with a later SHA settled red answers a repair step`.
- `packages/domain/test/repair-pr.test.ts:78-83` (`isRevertBranch` table): changes; the check takes `revertedPr`. New: `refuses repair-branch-mismatch for bug/revert-<n> where n differs from revertedPr`, `refuses repair-branch-mismatch for a record with no revertedPr`.
- `packages/domain/test/slice-pr-next.test.ts:468` (`admits the revert PR the open episode names from bug/revert-<pr>`): changes; the fixture carries a matching `revertedPr`.
- `packages/fleet/test/unit/revert-start.test.ts`, new: `opens no revert PR when the first red SHA re-runs green and the settled SHA reads red`, `closes no PR while the settled reading is red`.

### Desk endings tests

- `packages/domain/test/rules-ending-action.test.ts:76-82` (`answers leave for a holding-work ending only where the PR merged and the tree is clean`): changes; the loop gains the unpushed reading, and `leave` needs `none`. New: `answers needs-a-person, never start-fresh, for a merged holding-work desk with an unpushed commit or an unanswerable reading`.
- `packages/fleet/test/unit/fresh-agent-tick.test.ts`, new: `a merged desk with a clean tree and an unpushed commit asks a person and starts no agent`.

### Idle slice tests

- `packages/domain/test/slice-idle.test.ts`, new: `an unmoved slice keeps one episode key across two fleetd starts` (two `sliceIdle` calls with different `fleetdStartedAt`; today the second answers `isNew: true`).
- `packages/domain/test/slice-idle.test.ts:54` (`is not idle just after fleetd starts`): unchanged on purpose.

### Plan comment tests

- `packages/domain/test/tracker-plan-state.test.ts`, new: `two waiters on one stale lock leave exactly one holder`, `two writes on different issues keep both hash entries`.
- `packages/domain/test/plan-issue-comment.test.ts`, new: `reads the first ticket line of a comment with \r\n line ends`.
- Text-only and no-behaviour findings (docstring, dead ternary, changelog text): checked by the diff. `packages/domain/test/tracker-plan-state.test.ts:181-193` (`issues no host call for label or comment on a second identical write`) is renamed to say what it stubs.

### Review comment tests

- `packages/board/test/unit/review.test.ts:552-561`: changes; one `prComments` array is shared across the three heads. It cannot fail on `origin/main` by design, so the check is a mutation: with the per-PR marker lookup in `finishReview` removed, the corrected test fails.
- `packages/domain/test/review-issue.test.ts`: removed with `reviewIssue`. Type-only finding: checked by `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck`.
- Text-only (`review.test.ts:586` name, `DESIGN-delivery-loop.md:53`, `review-issue.ts:4`): checked by the diff.

## Docs

- Merge gate: `CLAUDE.md` *One hold reads a non-terminal answer* (`default-branch-unsettled` for a person), then `./scripts/check-agents-md.sh --write`.
- Fixer attempts: the JSDoc arm order and arm numbers in `slice-pr-next.ts:136-320`.
- Red main: `CLAUDE.md` *One hold reads a non-terminal answer* and the `plot-ask.mjs repair-pr` sentence (the `bug/revert-<pr>` number rule), then `./scripts/check-agents-md.sh --write`; the docstring at `rules/repair-pr.ts:33-34`.
- Desk endings: none.
- Idle slice: the `createdAt` comment at `registryd-main.ts:1128-1139`.
- Plan comment: the docstring at `plan-issue-comment.ts:74-77`; the changeset description for `CHANGELOG.md:463`.
- Review comment: `DESIGN-delivery-loop.md:53`, `review-issue.ts:4` (removed with the file if it holds nothing else).

## Notes

- Created from tracker issue #3069 (https://github.com/plot-pm/plot/issues/3069), 2026-11-03. The issue's triage and slice proposal are the source.
- Refs #2918, #2921, #2922, #2923, #2924, #2925, #2926, #2927, #2929, #2933, #2935.
- Release approval and the reviewer role moved to #3077 ("Who may approve a release, and the reviewer as a role agent"), with the panel's design questions.
- Panel round 1: four jurors (layering, safety, seams, testability), unanimous `amend`. Moderation: `.plot/panels/2026-11-03-open-plot-review-findings-from-the/panel.md`.
- Slice order and cross-plan pairs are under *Ordering*. Slices 1 to 4 change rules that decide merges, fixers and repairs.
- Deliverable search: no slice builds a new artifact; each fixes an existing one.
