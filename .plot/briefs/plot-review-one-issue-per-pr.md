## Implementation brief — one-review-issue-per-pr-a (wave 1: One review issue per PR)

- **Plan (canonical):** docs/plans/2026-10-17-one-review-issue-per-pr-a.md on main
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1955 merged
- **Branch:** `bug/plot-review-one-issue-per-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** pr

This is the plan's first wave. The other two waves (`bug/sprint-goal-reads-template`, `bug/monitors-end-waits-for-pid`) touch other files and do not wait on this branch.

### What to build

`plot-review` opens one follow-up issue per reviewed head. Release PR #1763 regenerates on every push to main: 7 heads produced #1869, #1871, #1873, #1874, #1877, #1878 and #1880, all with the same single LOW finding, and six were closed by hand as duplicates of #1869. The fix: before `openFollowUp` (`packages/board/src/server/entry/review.ts`, ~line 193) calls `deps.tracker.issueOpen`, look for an open issue that carries the `ai-generated` label, has a title starting `plot-review:` and ending `on PR #N`. When one exists, report the new head SHA and any finding not yet reported on it, and record that issue as this review's issue (the `.issue` file under `reviews/`). Otherwise open as today.

The canonical text is the plan's Design section; this brief is orientation.

### Decisions the plan settles — do not re-derive them

- **The domain decides a match; the adapter only lists.** Put the title test in `packages/domain/src/rules/` as a pure function (`findOpenReviewIssue` is the name the plan's slice line gives) with a unit test in `packages/domain/test/`. `review.ts` and the tracker adapters name no title format. The title format today lives in `followUpIssue` (`review.ts:157`): `plot-review: <counts> on PR #N`. Read it from one place, so the producer and the matcher cannot drift — the matcher must accept both title shapes (`N HIGH finding(s)` and `MEDIUM m, LOW l`) because a PR's counts change between heads. A suffix test on ` on PR #N` is what the plan names; test that `PR #1` does not match `PR #12`.
- **The per-SHA record stays.** The `<key>.issue` file holds `pending`, then the id, per PR and head. A re-review of the same head still reuses its recorded issue before any lookup. The lookup runs only when that file is empty. Keep the `pending` protocol and `ISSUE_MAY_EXIST` handling unchanged: a lookup that finds nothing falls through to the existing open path.
- **The port has no comment or edit operation today.** `packages/domain/src/ports/tracker.ts` names exactly two writes, `statusWrite` and `issueOpen`, and its doc states that `IssueOpen` is the one write besides the status because it states a fact Plot produced. "Comment on the existing issue" therefore needs a new port operation, or the lookup must change what the plan says. This is the plan's open point 3 (does the port gain a find operation, and what does `trackerNone` answer). Settle it in this branch and write the answer in the PR body. Two constraints carry over from the port's own rules: `trackerNone` answers `unaskable` on every operation including a write, never a silent success; and a connector (`tracker-github`, the declared-tracker connectors) never sees another connector's credentials or budget.
- **Open points 1 and 2 are yours to close, with a stated reason.** A comment keeps the history of heads; an edit keeps one list. Prefer the comment: it needs no read-modify-write of the body, so two concurrent reviews cannot lose each other's text. A closed issue does not match: the issue text asks only about open issues, so a closed one means open a new one. Record both choices in the plan's Open Points checkboxes in the same PR.
- **`issueList` and `issueListOpen` already exist.** Check whether `issueListOpen(limit)` plus the pure matcher is enough before adding a find operation. It reads the whole open set, which costs a request budget; the index (`.plot/state/index/issues.json`) is the board's view, not this command's decision input (`CLAUDE.md`, *A Decision Reads The Index*, and the index holds answers a decision may read only when terminal). Do not read the index to decide a match.
- **Absent is not false.** A lookup that fails (`unaskable`, rate limit, transport error) means "do not know", not "no issue exists". Opening a new issue on a failed lookup recreates the duplicates this fixes. Answer with the existing `followUp.ok === false` path and a reason, and write nothing.
- **The new issue-write goes to the issue index like the open does.** `handOffIssueWrite` runs after `issueOpen`; a comment is a write to an issue the index already holds, so decide in the PR whether it hands off too, and test the choice. One writer of the index stays `refreshIssueIndex` (`one-issue-index-writer.test.ts`); do not write the file from `review.ts`.

### Done when

The plan's slice line is the specification: find and update the open follow-up issue of the PR. Lift these assertions, each of which a naive implementation would pass without:

- **Seven heads of one PR yield one issue.** A test that runs `reviewPr` for 3 distinct SHAs against a fake tracker and asserts `issueOpen` was called once and the other two heads wrote the new text to that issue. It catches a lookup that runs but whose result is discarded.
- **`PR #1` does not match `PR #12`.** It catches a substring test.
- **A closed issue does not match.** It catches a lookup over `issueList` that ignores state.
- **A lookup failure opens nothing.** It catches the fall-through that recreates duplicates.
- **A different label or title prefix does not match.** A human-written issue titled `... on PR #7` must not receive review text.
- **Same head, second run** reuses the recorded id and makes no lookup call. It catches a per-head record that the new path bypassed.
- **`trackerNone` and a git-host tracker with no write answer `unaskable`** for the new operation, with the reason in the output.

Plus: a changeset in `.changeset/` for `@plot-pm/board` with the description first and the `bumps:` block last; if the port or a skill's behaviour changes, the skill table in `README.md` stays in sync. The bundle `skills/plot/scripts/board/plot-review.mjs` is generated: commit none of it (`scripts/check-no-bundle-diff.sh`). Arrow functions for every function you write. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there comes back as a correction. List no full suite.

No `.sh` file is in scope, so `scripts/check-shell-lines.sh` should not move. If a change touches a `.sh` file, remove an equal number of shell lines elsewhere in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/review.ts`, its tests (`packages/board/test/unit/review.test.ts`), the matcher in `packages/domain/src/rules/` with its test, the tracker port and the adapters that implement a new operation, and one changeset. The plan's own Open Points boxes for #1881 are also yours.

Other branches in flight, verified from the plan: `bug/sprint-goal-reads-template` owns `packages/board/src/server/board.ts` and `skills/plot/templates/sprint.md`; `bug/monitors-end-waits-for-pid` owns `test/e2e/monitors-end.test.mjs` and possibly `plot-worker-loop.sh`. No overlap. `feature/the-index-takes-plots-own-issue-writes` was merged to main in #1949 (`Write-through`) and changed the issue-write hand-off this code calls; read `handOffIssueWrite` on current main, not from memory.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
