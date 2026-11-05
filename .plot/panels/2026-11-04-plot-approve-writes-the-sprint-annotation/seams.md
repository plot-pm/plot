# Seams juror: plot-approve-writes-the-sprint-annotation

Position: amend

## Findings

1. **The cause is already in git, and the plan leaves it as an open question.** At `v2.28.0` (`2bd72e1ee`, 2026-10-22) `annotateSprintItem` annotated every line that contained `[slug]` (`git show 2bd72e1ee:packages/domain/src/rules/sprint-annotation.ts`, the `lines.map` over `line.includes(needle)`). Commit `0ef7e8a2b` (2026-11-01, "find the sprint by rule, not by directory scan") switched it to `memberLineIndex`, after the issue was filed (2026-10-24). That commit also added `packages/domain/test/rules-sprint-annotation.test.ts:72`, "never on a log line naming the slug elsewhere". The plan's cause 1 is therefore answered, and the plan does not name `0ef7e8a2b` or that test.

2. **A second tier-unaware writer of the same annotation still exists on `main`, and the plan does not name it.** `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:221-242`) rewrites every line that contains `[plan]`, with no tier check. It renders the `sprint-annotation` write that `workflows/approve.ts:384-393` (step 6, `tick: false`) and `workflows/deliver.ts:243-254` (`tick: true`) emit, and `adapters/performer/perform-fs.ts:164-174` applies it. Production approve does not use that path: `packages/board/src/server/entry/approve.ts:754` calls `annotateSprintItem`, and `entry/deliver.ts:573` calls `tickSprintItem`. So the domain holds two implementations of one write, one tier-aware and one not, and no test pairs them. The plan's "the approve workflow's sprint step" reaches exactly this renderer, so its reproduction step will find the bug there, and the plan does not say whether that counts as "a path that annotates the log line" (fix) or as sandbox-only (declare).

3. **The deliver arm of that renderer has a worse shape.** With `tick: true`, `withSprintAnnotation` replaces `[ ]` with `[x]` on every line containing `[slug]`, so a `- [ ] [slug]` checkbox under `## Notes` gets ticked as well as annotated. The plan's second open question asks this for `memberLineIndex` only.

4. **The existing regression test does not hold the issue's shape.** `rules-sprint-annotation.test.ts:72` puts the log line before the tier and has no item, and asserts `outcome: 'missing'`. The issue's shape is an item under `### Could Have` followed by a `### Scope Changes` log line, and the assertion that matters is that the log line is byte-identical after the write. No test in `rules-sprint-annotation.test.ts`, `sprint-tick.test.ts` or `rendering.test.ts:182-290` builds that file.

5. **Open PR #3112 (`bug/plot-approve-reads-the-plan-from`, OPEN, BLOCKED) changes the same files.** It edits `packages/board/src/server/entry/approve.ts`, `packages/domain/src/workflows/approve.ts`, `packages/board/test/unit/approve.test.ts` and `packages/domain/test/workflows-approve.test.ts`. A grep of its diff for `annotat|sprint` shows only the `sprint` reading (`let sprint = plan?.sprint`), not `annotateSprint` (approve.ts:733-763) or step 6. Textual conflict is unlikely if this slice stays in `rules/` and `rendering.ts`, but a fix that edits step 6 or the workflow tests rebases onto #3112. The plan names no ordering.

6. **Shell and corpus seams are clear.** `skills/plot/scripts/plot-approve.sh` is a 12-line launcher with no `sprint` text, so the plan's "a path in `plot-approve.sh`" holds nothing. `plot-sprint-member` does not exist under `skills/plot/scripts/`; the member write is `packages/domain/src/transitions/sprint-member.ts:229`, which calls `annotateSprintItem`. The corpus tier (`sprint-item.corpus.test.ts`, `sprint-item-fixture.corpus.test.ts`, `sprint-score.corpus.test.ts`) compares readers, not writers, so no declared shell/domain pair covers this write and none is needed. No active plan in `docs/plans/active/` touches sprint annotation; `docs/sprints/` content is not changed by this plan.

## Required amendments

1. Replace the two-cause Motivation with the measured cause: `2bd72e1ee` (2.28.0) matched any line, and `0ef7e8a2b` fixed `annotateSprintItem` and `tickSprintItem`. Name the existing test at `rules-sprint-annotation.test.ts:72`.
2. Name `withSprintAnnotation` (`rendering.ts:221`) as the remaining tier-unaware writer, used by `workflows/approve.ts:384` and `workflows/deliver.ts:243` through `perform-fs.ts:164`. Decide in the plan: route it through `memberLineIndex` (and write nothing when the index is `-1`), so the domain holds one rule for which line is the item. This is the decision a Sonnet agent should not make alone.
3. Name the tests: the issue's file (Could item, then `### Scope Changes` log line, then a `## Notes` checkbox `- [ ] [slug]`) against `annotateSprintItem`, `tickSprintItem` and `withSprintAnnotation` with `tick` true and false, each asserting the log line and the Notes line are byte-identical. The `withSprintAnnotation` cases fail on `main` today; the other two pass and hold the fix.
4. Drop `plot-approve.sh` and `plot-sprint-member` from the candidate writers, or replace the latter with `transitions/sprint-member.ts:229`.
5. State the ordering with PR #3112: keep the slice out of `entry/approve.ts` and `workflows/approve.ts`, or rebase after #3112 merges.

## Decisions for a person

- Whether the issue closes with a comment that names `0ef7e8a2b` as the fix, before or after this slice merges. The plan has the agent report on the issue; the plan says "Nothing was written to the tracker" and does not say whether a fleet agent may close it.

## Ran versus read

Ran: `git grep`, `git show` and `git log` on `origin/main`, `git show 2bd72e1ee:…`, `git show 0ef7e8a2b --stat`, `gh issue view 2532`, `gh pr list`, `gh pr diff 3112 --name-only`, `gh pr diff 3112 | grep`, `gh pr view 3112`. Read: the plan, `sprint-annotation.ts`, `sprint-membership.ts:114-139`, `rendering.ts:199-283`, `workflows/approve.ts:381-393`, `workflows/deliver.ts:243-254`, `perform-fs.ts`, `entry/approve.ts:733-763,966`, the corpus test headers, `docs/shell-and-domain.md`. Ran no test suite; the claim that the `withSprintAnnotation` cases fail on `main` comes from reading `rendering.ts:229-240`, not from running a test.
