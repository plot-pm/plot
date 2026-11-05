# Testability juror — plot-approve-writes-the-sprint-annotation

Position: amend

## Lens

Testability: every behaviour asserted on a domain property or a script contract without a browser; each named test fails before the change and passes after; no test touches the operator's fleet, launchd or port 7777.

## Findings

1. The plan leaves the cause open, but the cause is already in git. At `v2.28.0`, `annotateSprintItem` matched with `line.includes(needle)` (`git show v2.28.0:packages/domain/src/rules/sprint-annotation.ts`, line 39). Commit `0ef7e8a2b` (2026-11-01, "plot-approve, plot-deliver: find the sprint by rule, not by directory scan", first in `v2.30.0`) switched it to `memberLineIndex`. So cause 1 of the plan's Motivation is true for the `POST /api/approve` path, and the plan can state it instead of making the agent rediscover it.
2. A regression test for that path already exists: `packages/domain/test/rules-sprint-annotation.test.ts` "finds the item on a Must/Should/Could tier line, never on a log line naming the slug elsewhere". It covers a log line with NO tier item (outcome `missing`). It does not cover the issue's shape: a tier item AND a later `### Scope Changes` line naming the same slug, with the log line asserted byte-identical. The plan's new test fills that gap, but against `annotateSprintItem` on `main` it passes before the change. It is a characterization test, and the plan must say so and say how to see it fail (revert `annotateSprintItem` to its `0ef7e8a2b^` body, or run it against that commit).
3. A second writer still has the defect on `main`, and the plan does not name it. `withSprintAnnotation` (`packages/domain/src/workflows/rendering.ts:221`) annotates every line where `line.includes(marker)` is true (`:227-228`). It performs the `sprint-annotation` write that `workflows/approve.ts:386` and `workflows/deliver.ts:245` emit, through `packages/domain/src/adapters/performer/perform-fs.ts:164-166`. The issue's fixture against `withSprintAnnotation(text, slug, false, 42, 'feature/x')` annotates the log line today, and with `tick: true` it also rewrites `[ ]` on any line containing the marker. This is the one test in this plan that genuinely fails before and passes after. I found no production caller of `perform-fs` (`git grep performFs origin/main -- packages/*/src` returns nothing); it is the sandbox performer. The defect is real for the sandbox tier and for any future caller.
4. Open Question 2 (`- [ ] [slug]` under `## Notes`) is answerable now: `memberLineIndex` (`sprint-membership.ts:125-138`) sets `inTier=false` on any `##`/`###` heading that is not a tier heading, so `annotateSprintItem` and `tickSprintItem` (`sprint-tick.ts:36`) leave it alone; `withSprintAnnotation` does not.
5. Every path the plan names is testable without a browser, a fleet, launchd or port 7777: `annotateSprintItem` and `withSprintAnnotation` are pure string functions with vitest suites in `packages/domain/test/`. "run it through `plot-approve.mjs`" is the only step that risks a real repo; the plan does not say how. The board entry's `annotateSprint` (`packages/board/src/server/entry/approve.ts:733-766`) takes a `PlanStore`, so a fake store covers it without spawning the bundle.
6. Line and caller claims checked: `memberLineIndex` at `sprint-membership.ts:125` is correct. "returns the first `- [ ] [slug]` line" is slightly narrow: `MEMBER_SLUG_LINE` (`:116`) also matches `[x]` and a struck `~~[slug]`. `plot-sprint-member` (`transitions/sprint-member.ts:229`) uses `annotateSprintItem` and is safe.

## Amendments required

1. State the cause in Motivation: `v2.28.0` matched by `includes`; `0ef7e8a2b` fixed the approve path; the item is fixed for `POST /api/approve` from `v2.30.0`.
2. Add `withSprintAnnotation` (`rendering.ts:221`) to the writers in Approach and fix it to use `memberLineIndex` (approve and deliver both reach it). Its existing tests in `packages/domain/test/rendering.test.ts:180-290` pass bare item lines with no tier heading; the slice must wrap them in `### Must Have` or they will turn red, and the plan must say that is expected.
3. Name the tests and their before/after: (a) `rendering.test.ts` — the issue's fixture through `withSprintAnnotation`, log line byte-identical, `tick: true` and `false` — fails on `main`, passes after; (b) `rules-sprint-annotation.test.ts` — the same fixture through `annotateSprintItem` — passes on `main`, labelled a regression hold, shown failing against `0ef7e8a2b^`; (c) one `## Notes` checkbox case for both writers.
4. Replace "run through `plot-approve.mjs`" with the board entry's `annotateSprint` over a fake `PlanStore`, or drop it; no slice test starts a board, fleetd or the bundle against the operator's repo.
5. Close both Open Questions in the plan with the answers in findings 3 and 4.

## Decisions for a person

- Whether the issue closes as "fixed in v2.30.0 by 0ef7e8a2b" plus the `withSprintAnnotation` fix, or the latter gets its own issue. This plan can carry both; the agent should not decide the issue's wording.

## Ran versus read

Ran (read-only): `gh issue view 2532`; `git show` of `origin/main` and `v2.28.0` for `sprint-membership.ts`, `sprint-annotation.ts`, `rendering.ts`, `decision.ts`, `workflows/approve.ts`, `board/.../entry/approve.ts`, `sprint-member.ts`, `sprint-tick.ts`, `perform-fs.ts`, `performer-shell.ts` and the two test files; `git grep` for writers and callers; `git log -S`/`git tag --contains` for the fix commit. Ran no test suite and no board, fleet or host-write command. The fail-before claim for `withSprintAnnotation` is read from source, not executed.
