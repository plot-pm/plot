# Testability juror

Position: amend

Plan: `docs/plans/2026-11-03-open-plot-review-findings-from-the.md` (PR #3075, issue #3069). Lens: every open finding a slice claims has a named test that fails on `origin/main` and passes after, and the cited lines are current. Checked against `origin/main` at `a518552f1`.

## Summary

The cited lines are current. No commit between `321966041` (the triage base) and `a518552f1` touches any cited path (`git log 321966041..origin/main -- packages/ skills/plot/scripts/plot-worker-state.sh CHANGELOG.md docs/stories/the-fleet-delivers-a-scope-alone` is empty), and every excerpt I read matches the finding's description.

The test plan is not sufficient. The Approach says "each slice ... adds the test that fails without the fix", but no slice names a test file or a test name. Only slice 4 names a test, "a fleet test", and the defect it targets sits in a domain rule. Several existing tests assert the current behaviour and must flip; the plan names none of them, so an unattended agent cannot tell an intended flip from a regression it must not cause. Seven findings are text-only or latent and no test can fail on `origin/main` for them; the plan does not say how those are verified.

## Findings

### Cited lines (rubric 2)

All current on `origin/main`. Minor imprecisions:

- `packages/board/src/server/release.ts:211` does not read `PLOT_UNATTENDED`; it spawns the release script, and the caller is mapped in the child at `packages/board/src/server/entry/deliver.ts:791`. The claim holds through env inheritance; the citation names the spawn, not the read.
- `slice-idle.ts:122` is inside the `sliceIdle` docstring area; the key is built at `:127` (`idleEpisodeKey` is defined at `:69`).
- `repair-start.ts:152` is a generic `return 'none'`; `close-prs` appears only in the comment at `:67`. The claim "ignores `close-prs`" is true, but the line names the fall-through.
- `ending-action.ts:352`, `merge.ts:209-213`, `merge.ts:242`, `merge.ts:360-367`, `auto-merge.ts:116`, `slice-pr-next.ts:177-190/228-231/264-266/283/295/385`, `fixer-attempts.ts:26-37`, `ticket.ts:54`, `auto-fixer.ts:163-174/457`, `repair-role.ts:115`, `repair-pr.ts:25-39/66-70/202-207`, `repair.ts:255`, `revert-start.ts:207/335`, `release-approve.ts:73`, `restart.ts:70`, `review.ts:345/481`, `tracker-plan-state.ts:92/100-106/155-156/213-215`, `plan-issue-comment.ts:74-77/83/86-93`, `review.test.ts:89/552-561/586`, `DESIGN-delivery-loop.md:53/155`, `review-issue.ts:4`, `tracker-plan-state.test.ts:181-193`: each read and confirmed.

### Existing tests that assert today's behaviour and must flip (rubric 3, 6)

- `packages/domain/test/rules-ending-action.test.ts:76-82` asserts `leave` for every `holding-work` ending with `prMerged: 'merged'` and `dirtyTree: 'no'`. Slice 4 must change this expectation. `EndingActionReadings` (`ending-action.ts:60-72`) has no unpushed-commit reading, so slice 4 also adds a reading and its producer (`dirtyTreeReading` in `packages/fleet/src/server/entry/registryd.ts:1062` reads held files only).
- `packages/domain/test/repair.test.ts:123` asserts `redMainStep(..., record({ state: 'rerun' }), input({ rerunSettled: 'green' }))` is `close-prs`. Slice 3's first option ("reads the settled state before `close-prs`") changes the input of this case.
- `packages/domain/test/repair-pr.test.ts:78-83` asserts `isRevertBranch('bug/revert-2937')` is true with no number check. The record has no reverted-PR number (`repair-pr.ts:32-33` says so), so slice 3 adds a record field and `RepairRecordSchema` (`entities/repair-record.ts`) changes. The plan does not say so.
- `packages/domain/test/workflows-merge.test.ts:244-248` asserts `default-branch-unsettled` on a pending head past a green settled commit. Slice 1's "bound for a person's merge" must keep or change this case, and the plan does not say which.
- `packages/domain/test/slice-pr-next.test.ts:128-139` and `:227` cover `restatusArm` and the HIGH arm's `write-status`. Reordering the arms in `nextSlicePrStep` (`slice-pr-next.ts:385`) needs a combined case, not only per-arm cases.
- `packages/board/test/unit/release-caller-gate.test.ts:47` asserts the release entry refuses on `PLOT_UNATTENDED=1`. Slice 5's board-route fix must keep this entry-level assertion and change only the route's caller; otherwise the agent breaks a gate test to pass its own.

### Findings with no test that can fail on `origin/main`

- `review.ts:481`, `decision === 'none'`: `ReviewIssueDecision` is the single literal `'none'` (`review-issue.ts:8`, `:20`). Any test passes before and after. This is a type-level hardening.
- `plan-issue-comment.ts:74-77` docstring, `tracker-plan-state.ts:92` dead ternary, `review.test.ts:586` test name, `DESIGN-delivery-loop.md:53`, `review-issue.ts:4`: text only.
- `CHANGELOG.md:463` "makes no host call": the read-back at `tracker-plan-state.ts:213-215` is deliberate for progress writes (comment at `:210-212`). Either the behaviour changes (a test then fails before) or the published text changes (no test). The plan does not choose.
- `review.test.ts:552-561`: the fix makes a test able to fail. "Fails before" does not apply; the proof is a mutation (for example, remove the per-PR marker lookup in `finishReview`) under which the corrected test fails.

### Missing test decisions per slice (rubric 5, 6)

- Slice 1: no test named for `bypass` in `merge.ts` (`workflows-merge.test.ts:54` sets `bypass: false` and never varies it), none for the opt-in key, none for the no-retry memory in `packages/fleet/test/unit/auto-merge.test.ts` (`:108` covers `host-refused` only). The opt-in key name is an Open Question, so the test cannot be written yet.
- Slice 2: `FixerAttempt` already carries `finding` (`adapters/fixer-attempts/fixer-attempts-file.ts:76`), so a split count is testable in `packages/domain/test/fixer-attempts.test.ts` with no schema change. The plan does not name that file or `ticket.test.ts` for `reviewStatus`. The "red head a fixer pushed" case needs a test in `slice-pr-next.test.ts` and in `packages/fleet/test/unit/auto-fixer.test.ts` for `deskDeadFromWorkerState`; neither is named. The plan does not say which reading marks a head as fixer-pushed.
- Slice 3: tests belong in `repair.test.ts`, `repair-pr.test.ts`, `packages/domain/test/repair-start.test.ts` and `packages/fleet/test/unit/revert-start.test.ts`; none named. The "or" between two fixes for `close-prs` leaves the test shape to the agent.
- Slice 4: "a fleet test" is the wrong layer for the decision. The rule test is `rules-ending-action.test.ts`; the reading test belongs with `registryd.ts`'s readings. Name both.
- Slice 5: `workflows-release-finish.test.ts`, `workflows-release-approve.test.ts`, `restart-route.test.ts` and a release-route test are the homes; none named. "Books or names" and "states or enforces" are two-way choices, and "states" has no failing test.
- Slice 6: no test named. `packages/fleet/test/unit/repair-role.test.ts` and `test/reconcile/role-agent-definitions.test.mjs` are the patterns. The failing test is "the reviewer command is built from `reviewer.md` on `origin/<default>`, and a worktree copy is not read".
- Slice 7: `packages/domain/test/slice-idle.test.ts` uses one `FLEETD_STARTED_AT` (`:33`). The failing test is two `sliceIdle` calls with different `fleetdStartedAt` and the same unmoved slice: today the second call answers `isNew: true`.
- Slice 8: the lock race and the lost hash entry need concurrent tests in `packages/domain/test/tracker-plan-state.test.ts`; the `\r\n` case goes in `plan-issue-comment.test.ts` near `:75-95`. None named.

## Amendments required

1. Each slice names, per finding, the test file and the test name that fails on `origin/main` and passes after. Use the files listed above.
2. Each slice names the existing tests whose expectation it changes (the six listed above), and states that the change is intended.
3. Mark the seven findings that no test can fail on as text-only or type-only, and state their verification: a diff for text, a mutation run for `review.test.ts:552-561`.
4. Slice 3 states that the repair record gains the reverted PR number, and names the schema and decoder test that covers an old record without it.
5. Slice 4 names the domain rule test and the new reading, not only "a fleet test".
6. Resolve each "or" in slices 1, 3 and 5 to one fix, so each has one failing test.
7. Fix the three imprecise citations above, or mark line references as approximate at `a518552f1`.

## Decisions that need a person

- The three Open Questions in the plan. Slice 1's opt-in key and slice 5's enforce-or-state choice each decide whether a failing test exists at all.
- `CHANGELOG.md:463`: change the read-back behaviour, or correct the published text.

## What I ran versus read

Ran (read-only): `git fetch origin main`; `git show origin/main:<path> | sed -n` over every cited line; `git log 321966041..origin/main -- <cited paths>`; `git grep` for `dirtyTree`, `FixerAttempt`, `RepairRecord`; `git ls-tree` for existing test files; grep over `workflows-merge.test.ts`, `rules-ending-action.test.ts`, `slice-pr-next.test.ts`, `slice-idle.test.ts`, `repair.test.ts`, `repair-pr.test.ts`, `workflows-release-approve.test.ts`, `auto-merge.test.ts`, `plan-issue-comment.test.ts`, `release-caller-gate.test.ts`; `gh issue view 3069`.

Read only, not executed: every test file named above. I ran no test suite, so "fails before" is reasoned from the assertions, not observed.
