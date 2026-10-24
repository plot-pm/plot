# plot-review loses an existing issue and its run marker when a comment fails

> `plot-review` removes the record of a follow-up issue that exists when the comment on it fails, and reports a status that points at an issue holding an older verdict.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #2488
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2542 merged
- **Started:** 2026-10-24, jwloka, `bug/plot-review-keeps-an-issue-when-its-comment-fails`

## Changelog

- `plot-review` keeps the record of an existing follow-up issue when its comment fails, says in the commit status when the tracker cannot comment, and writes the run marker into the first run's status description. The PR-comment marker lookup reads only comments the review App wrote.

## Motivation

Issue #2488 collects follow-up findings from `plot-review` runs on #2135, #2357 and #2365, checked against `origin/main` at `84b1638e4` on 2026-10-24. Ten findings fall into three groups.

1. **A failed comment loses the issue (MEDIUM).** In `packages/board/src/server/entry/review.ts`, an issue found by label lookup that refuses the comment goes through `deps.removeFile(issueFile)` and returns `{ ok: false }` (line 298). The run reports "not opened", although the issue exists and the next run opens a duplicate. When the tracker answers `unaskable` for the comment (line 509), the status has no suffix and no marker, the command exits 0, and `target_url` points at an issue that holds an older verdict. The first run's status description has no run marker, while the issue body it opened carries one (line 511).
2. **The PR-comment marker lookup trusts any author (LOW).** The `pr-comment` arm of `skills/plot/scripts/plot-host.sh` (line 5667) finds its marker in any comment, so a pasted marker blocks or overwrites another user's comment. The arm copies the issue-comment marker lookup word for word and squeezes it onto long lines.
3. **Missing tests and documentation.** No test runs the `--title-has` shell paths in `plot-host.sh` (line 5083): the `gh` search text, the open-only refusal and the Bitbucket/Jira exit 4. No test covers a failed comment listing (`test/reconcile/host-pr-comment.test.mjs:100`), and the port's marker doc names only a failed edit. The issue lookup (`review.ts:227`) reads GitHub's search index, which can lag a newly opened issue and cause a duplicate, and nothing documents that. Two tests in `packages/board/test/unit/review.test.ts` cannot fail as claimed: the second-run test (line 608) uses a fixed `RUN`, so both bodies match, and the 250-row backlog test (line 663) has a stub that does the title filtering itself.

## Design

### Approach

**Keep the record of an issue that exists.** When the comment on an issue found by lookup fails, the run keeps `issueFile`, reports the issue as opened, and carries the comment failure the way the `uncommented` path already does for a newly opened issue. A failure to comment is a failure of the verdict's delivery, not of the issue's existence.

**Name an unaskable comment in the status.** When the tracker cannot comment, the status description says the verdict was not commented, and `target_url` points at the PR instead of an issue holding an older verdict. The first run's description carries the run marker that its issue body carries.

**Scope the marker lookup to the App.** The `pr-comment` arm reads only comments written by the review App's login, and the two copies of the marker lookup share one function. The port's marker doc names a failed listing as well as a failed edit.

**Tests and docs.** Each new test proves the second run reached the host: the run id differs between the two runs, and the stub does not filter. The `--title-has` paths get shell tests, and a comment at `review.ts:227` documents the search-index lag and what it does to the duplicate guard.

### Open Questions

- [ ] Should a failed comment on a found issue exit non-zero? Today a failed comment on a newly opened issue exits 0 with a printed line; consistency says the same here.
- [ ] Does the review App's login come from config or from the authenticated user of the connector? The slice names the source before it filters.

## Slices

### Issue and status

- `bug/plot-review-keeps-an-issue-when-its-comment-fails` — keep the issue record and report the issue as opened on a failed comment; name an unaskable comment in the status and point `target_url` at the PR; put the run marker in the first run's description; tests prove the second run reached the host <!-- builds: a status description that names an uncommented verdict -->

### Marker lookup

- `bug/plot-host-pr-comment-reads-only-the-apps-comments` — filter the `pr-comment` marker lookup by author, share one lookup with the issue-comment arm, test a failed listing, and extend the port's marker doc

### Shell tests

- `bug/plot-host-title-has-has-tests` — test the `--title-has` paths (the `gh` search text, the open-only refusal, the Bitbucket/Jira exit 4), document the search-index lag at `review.ts:227`, and make the 250-row backlog test unable to pass on its own stub

## Notes

- Source: https://github.com/plot-pm/plot/issues/2488
- Findings come from the reviews of #2135, #2357 and #2365.
