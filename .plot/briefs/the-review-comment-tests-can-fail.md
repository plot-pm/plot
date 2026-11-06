## Implementation brief — open-plot-review-findings-from-the (wave 6: Review comment tests)

- **Plan (canonical):** `docs/plans/2026-11-03-open-plot-review-findings-from-the.md` on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3075 merged
- **Branch:** `bug/the-review-comment-tests-can-fail` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot-review` gate, per repo convention

The slice waits on nothing and nothing waits on it. Its siblings (fixer attempts, red main, desk endings, idle slice, plan comment, merge gate) touch other files; the one shared path is `DESIGN-delivery-loop.md`, see *Scope guard*.

### What to build

A test that cannot fail, one tautological guard, and three stale texts, all from review finding #2929.

The failing test is `three heads of one PR edit the same comment, never a second one` in `packages/board/test/unit/review.test.ts` (`describe('one findings comment per PR')`). The test calls `rig(...)` three times. Each call builds its own empty `prComments` array (`const prComments = ...` inside `rig`, passed to `hostFixture`), so `r.prComments` has length 1 after every call whatever `finishReview` does. The test passes with the per-PR marker lookup deleted. Measured by reading `rig`: no state crosses calls except the `files` map the test passes in.

Do this:

1. Let `rig` take an optional `prComments` array in its `opts` and use it instead of the fresh one, then share one array across the three heads. The fixture (`packages/domain/src/adapters/host/host-fixture.ts`, `prComment`) edits in place when a comment with the same `pr` and marker exists, so a shared array is all the test needs.
2. Remove `reviewIssue` and `ReviewIssueDecision` from `packages/domain/src/rules/review-issue.ts`, and the `decision === 'none'` guard in `finishReview` (`packages/board/src/server/entry/review.ts`). The comment then posts for every non-zero finding count. Drop the `reviewIssue` import there, drop its `describe` block and import from `packages/domain/test/review-issue.test.ts`, and fix the `{@link reviewIssue}` sentence in the file's header comment (`review.ts` near line 49) so it says what the code does: a HIGH holds the PR at `plot/review=failure`; no finding opens an issue.
3. Rename the test `reports a failed PR comment without changing the exit code`. It asserts `EXIT.issueNotOpened`, so the name must say the exit code is `issueNotOpened`.
4. Correct `docs/stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md` line 53 (the `Review a slice PR` row), both halves: `plot-review` opens no follow-up issue (line 155 of the same file says that behaviour is removed), and fleetd does call `plot-review` through `packages/fleet/src/shared/auto-review.ts` when `Auto-review: true`.
5. Correct the comment on `REVIEW_ISSUE_LABEL` in `review-issue.ts`. The constant stays: `finding-tickets.ts`, `revert-ticket.ts` and `auto-ticket.ts` use it. Say what it labels today (the finding tickets and revert tickets that fleetd opens), not "every follow-up issue of `plot-review`".

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **Delete `reviewIssue`; do not make it return something.** It answers `'none'` for every input, HIGH included, so the guard it feeds is always true. A widened type would invent a decision nobody asked for. The plan decides removal.
- **Keep `review-issue.ts`.** The plan says "removed with the file if it holds nothing else". It holds `REVIEW_ISSUE_LABEL`, `reviewIssueTitle`, `findOpenReviewIssue` and the ticket-verdict rules, all with callers (`git grep` on `origin/main`). Only the one rule and its type go.
- **The test is checked by mutation, because it cannot fail on `origin/main` by design.** With the fix to the test in place, remove the per-PR marker from the `prComment` call in `finishReview` (pass no marker, or a different marker per head). The corrected test must then fail with 3 comments instead of 1. Commit first, mutate, run, restore from git (`git checkout -- <file>` returns to HEAD, not to your last edit), and say in the PR what failed. A test that passes under that mutation has not been fixed.
- **Carried rules:** an absent reading is not a false one; read the exit code of a command rather than the emptiness of its output; a test must not assert its own platform precondition.

### Done when

The plan's `## Tests` section for *Review comment tests* is the specification:

- `review.test.ts` shares one `prComments` array across the three heads, and fails under the mutation above.
- `reviewIssue` and `ReviewIssueDecision` are gone from the domain and from the board; `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` and `pnpm run typecheck` pass.
- The test name, `DESIGN-delivery-loop.md:53` and the `REVIEW_ISSUE_LABEL` comment are corrected; the diff is the check.

Plus: a changeset (package `plot` or `@plot-pm/board`, description first and the `bumps:` block last), whose description says what changed in 20 or more characters. `./scripts/check-changeset-packages.sh` checks it. The slice touches `CLAUDE.md` nowhere, so `check-agents-md.sh` has nothing to do. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Never run board tests while the operator's board is open: `plot-local-checks.mjs` prints the board command, and `test:board` takes the board down; if it prints that, run the named `vitest related` form only.

The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`; never `gh pr create`. Then append `→ #<number>` to this branch's line under `### Review comment tests` in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Files this branch owns: `packages/board/test/unit/review.test.ts`, `packages/board/src/server/entry/review.ts`, `packages/domain/src/rules/review-issue.ts`, `packages/domain/test/review-issue.test.ts`, the one row in `DESIGN-delivery-loop.md`, and one changeset.

Other branches in flight on this plan, none of which touches these files: `bug/a-red-main-stays-acted-on` (#3177), `bug/holding-work-reads-unpushed-commits` (#3182), `bug/an-idle-episode-survives-a-restart` (#3183), `bug/the-plan-comment-parses-what-it-wrote` (#3184). Another plan's `feature/fleetd-merges-as-the-merger-app` (#3068) edits `DESIGN-delivery-loop.md:37`, a different line; rebase on whichever merges first. If you find something the plan did not anticipate, report it rather than improvising outside scope.
