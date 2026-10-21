# Jira issue-list: --limit above one page returns 100 rows silently

> `plot-host.sh issue-list --limit 200` on a Jira tracker returns 100 rows with no warning; the plan makes the script refuse or warn.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2213
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2222 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/jira-issue-list-limit-above-one`

## Changelog

- `plot-host.sh issue-list --limit N` on Jira no longer returns fewer rows than asked without saying so when `N` exceeds one page (100 rows).

<!-- Board impact: none expected. Internal callers (the board, fleetd) read `issue-list --paged` through the tracker adapter and never ask an unpaged limit above 100. -->

## Motivation

Measured 2026-10-21 on ewz-kus-portal (main `01a6cf2ad`, read-only) with `PLOT_TRACKER="jira https://quatico.atlassian.net"`: `plot-host.sh issue-list --limit 200`, without `--paged`, prints 100 rows and exits 0. The Jira response carries a `nextPageToken`, and an unpaged read drops it.

The open read sets `maxResults` to `--limit` (`skills/plot/scripts/plot-host.sh`, `max="${limit:-50}"`). Only a paged read clamps `max` to `ISSUE_PAGE_ROWS` (100), and it prints the token. Jira caps `maxResults` at 100 itself, so an unpaged `--limit 200` is a silent truncation: the caller sees 100 rows and cannot tell that 100 more exist. This is the failure `an-outage-is-not-an-answer` names for the other direction: a partial answer reported as the whole one.

No Plot view is affected today, because internal callers page. The defect is in the script's contract for a direct caller (an operator, a skill, a future consumer).

## Design

### Approach

When the Jira open read gets `--limit N` with `N > ISSUE_PAGE_ROWS` and no `--paged`, the script does one of:

1. **Refuse** with a usage error naming `--paged`, exit 2.
2. **Warn** on stderr that the read returns at most one page, and clamp `maxResults` to `ISSUE_PAGE_ROWS`.

The issue allows either. Recommended: refuse, because a warning on stderr is lost wherever stderr is discarded, and the three-outcomes rule at `issue-list` says a partial answer must not look like a complete one. Refusal costs no internal caller: the tracker adapter always passes `--paged` for reads that can exceed a page.

The header comment for `issue-list` documents the new behaviour. The GitHub arm is out of scope unless a measurement shows the same truncation there.

### Open Questions

- [ ] Refuse (exit 2) or warn and clamp? Recommendation above is refuse.
- [ ] Does the GitHub arm truncate a `--limit` above its page size without saying so? Measure before widening the plan.
- [ ] Does any caller pass an unpaged `--limit` above 100? Grep `tracker-shell.ts`, `idea.ts` and the fleet scan before the change.

## Slices

### Limit guard

- `bug/jira-issue-list-limit-above-one` — refuse or warn on `issue-list --limit` above one page without `--paged` on Jira; contract test in `test/reconcile/host.test.mjs`; header comment updated → #2233

## Notes

- Source: https://github.com/plot-pm/plot/issues/2213. The plan writes nothing back to the tracker.
- Ceremony: `Plan PRs: required` in this repo's config, so `Review: pr`; the fix is one slice on its own branch.
