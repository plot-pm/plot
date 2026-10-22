## Implementation brief — plot-review-cannot-open-its-follow (wave 1: Implementation, branch 1 of 2)

- **Plan (canonical):** docs/plans/2026-10-22-plot-review-cannot-open-its-follow.md on main
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2337 merged
- **Branch:** `bug/plot-review-looks-up-its-issue-by-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

The plan has one wave with two independent branches. This branch owns the lookup; `bug/plot-review-publishes-findings-on-the-pr` owns the PR comment. Neither waits on the other.

### What to build

On 2026-10-22, `plot-review.mjs 2335` found 1 HIGH, set `plot/review=failure`, printed `could not look for an open follow-up issue of PR #2335: the read stopped at 200 issues` and exited 4. The repository held more than 200 open issues.

The cause is `openIssueOfPr` in `packages/board/src/server/entry/review.ts` (line 214). It calls `deps.tracker.issueListLabelled(REVIEW_ISSUE_LABEL, LOOKUP_LIMIT)` with `LOOKUP_LIMIT = 200` (line 199). `REVIEW_ISSUE_LABEL` is `ai-generated`, which every AI-created ticket carries, so the read grows with the whole backlog and not with the one PR asked about. When the read is incomplete and no match is among the first 200 rows, the function answers `ok: false`.

Replace that read with a lookup keyed by the PR. The title of a follow-up issue is `reviewIssueTitle(pr)` (`packages/domain/src/rules/review-issue.ts:19`, `plot-review: findings on PR #<pr>`). Ask the tracker for open issues whose title names the PR, and keep `findOpenReviewIssue` (same file, line 32) as the check on every candidate. A search that returns a complete answer settles the question. Keep the plan open for the paging alternative only if the measurement in the first decision below disqualifies search.

### Decisions the plan settles — do not re-derive them

**The refusal on an incomplete read stays.** `openIssueOfPr` answers `ok: false` rather than `issue: null` on a truncated read because opening on an unknown answer recreates duplicate issues. The plan states the rule is correct and the lookup is the defect. Do not weaken `ok: false`, and do not lower the bar for `complete`.

**A tracker that cannot search keeps today's behaviour.** `unaskable` means no lookup and the caller opens an issue (line 219). `tracker-none.ts:33` and `tracker-jira.ts:146` already answer `unaskable` for the label list. A new port method answers `unaskable` there too, with the reason stated. A Jira or `none` repository must see no change.

**`ISSUE_MAY_EXIST` is not touched.** `openFollowUp` (line 254) holds a pending record and refuses with `ISSUE_MAY_EXIST` when an earlier run asked the tracker to open an issue and recorded no answer. The lookup change must leave that guard and `refuted-issues.ts` unchanged.

**Open points the plan assigns to this slice — answer each in the PR description with a measurement:**

- Search by title (`in:title "PR #N"`) or page past 200? Measure which connectors support a title search: GitHub, Jira, `none`. `plot-host.sh issue-list --label` is GitHub-only (exit 4 on Bitbucket and Jira), so the search arm is expected to be GitHub-only too.
- Does a search read as complete? GitHub's search API caps at 1000 results and can lag a just-created issue. State what a lagging index does to the duplicate guard. A search that misses an issue created seconds earlier reads as "no issue" and opens a second one. Say how the code prevents or bounds that, for example by the recorded-issue path that already runs first in `openFollowUp`.
- GitHub search spends a different rate bucket (`code_search`/`search`) from `core` (`plot-host.sh` near line 3236). The tracker is a connector, so the call must report which bucket it spent. Read how `tracker-shell.ts` `walk` records requests before adding the method.

Rules carried over unchanged: absent is not false, so a missing or failed read never means "no issue exists". Read the exit code, not the emptiness of stdout, in any shell arm.

### Done when

The plan's `## Slices` line for this branch is the specification: a lookup keyed by the PR number, with tests for a backlog above 200 issues. The assertions a naive implementation would pass without:

- A fixture with 250 open issues carrying the label, where the matching issue is row 230. The old code fails this, so the test proves the lookup no longer depends on the first 200 rows. Use `tracker-fixture.ts`, which needs a matching search field (today it has `issueListLabelled` only, line 55).
- A fixture where the search is incomplete and finds no match: `ok: false`, not `issue: null`. This catches an implementation that treats "no match in the page" as "no issue".
- A tracker answering `unaskable` for the search: the caller opens an issue, as before. This catches Jira and `none` regressing.
- `PR #1` does not match an issue titled `... on PR #12`. `findOpenReviewIssue` already holds this; keep it the check on every candidate and do not match by substring in the new code.

Adding a method to the `Tracker` port (`packages/domain/src/ports/tracker.ts`) means every implementation gets it: `tracker-shell.ts`, `tracker-github.ts`, `tracker-resolve.ts`, `tracker-jira.ts`, `tracker-none.ts` and `tracker-fixture.ts`. A TypeScript compile error names any you miss.

Plus: a changeset for `@plot-pm/board` or `plot` per `## Versioning` in `CLAUDE.md`, description first and `bumps:` block last. In `packages/domain/**` write arrow functions and factual TSDoc, with no review history. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the search needs a new arm in `plot-host.sh`, pay for it in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override. Also run `scripts/check-host-cli-callers.sh`: `plot-host.sh` is the one place that talks to the host CLI.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/server/entry/review.ts` (`openIssueOfPr` and `LOOKUP_LIMIT`), `packages/domain/src/ports/tracker.ts`, `packages/domain/src/adapters/tracker/*`, `packages/domain/src/rules/review-issue.ts`, `packages/board/test/unit/review.test.ts` and the tests of those adapters.

The other branch, `bug/plot-review-publishes-findings-on-the-pr`, edits the same file `review.ts` in the `followUp?.ok === false` path near lines 431–455 and adds a PR-comment call through the host connector. It does not touch `openIssueOfPr`. Expect a small merge in `review.ts` and keep your edit inside `openIssueOfPr`, its constant and its imports. The host port (`packages/domain/src/ports/host.ts`) has no PR-comment operation today; that gap belongs to the other branch.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
