# Jira issue-list answers an unknown fix version and a cut result silently

> `plot-host.sh issue-list` on a Jira tracker exits 0 with no rows for an unknown `--fix-version`, and prints 50 rows without saying that more exist; the plan makes both answers say what they are.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2251
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2257 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/jira-issue-list-answers-an-unknown`

## Changelog

- `plot-host.sh issue-list --fix-version <name>` on Jira refuses an unknown version with `version-not-found`, and an `issue-list` result cut at the limit says so on stderr.

<!-- Board impact: none expected. The board and fleetd read through the tracker adapter, which already answers `version-not-found` for the sprint gate. -->

## Motivation

Two silent answers from the Jira `issue-list` in `skills/plot/scripts/plot-host.sh`:

- `issue-list --fix-version <name>` for a version Jira does not have builds a `fixVersion = "<name>"` query (line ~4936) and exits 0 with no rows. The sprint gate's own version read names `version-not-found` (`VERSION_NOT_FOUND` in `tracker-shell.ts`, `ports/tracker.ts`), so only a direct caller sees the empty answer.
- `issue-list` with no `--limit` reads `max="${limit:-50}"` (line ~4904), returns 50 rows and does not say that more exist.

Measured 2026-10-21 on ewz-kus-portal, plot main `be96cdfe4`, read-only: more than 100 EWZKUS issues are open; the default call printed 50 rows and no note.

Related, not duplicated: `2026-10-21-jira-issue-list-limit-above-one` (#2213, Delivered) refuses an unpaged `--limit` above one page (100 rows). It leaves the default 50-row cut and the unknown version untouched. `pr-list` already reports a cut result through `pr_list_report_truncation`.

## Design

### Approach

1. **Unknown fix version.** Before the version read returns rows, `issue-list --fix-version` checks that the version exists in the tracker and refuses with the reason `version-not-found: <name>`, exit non-zero, when it does not. The existence check reuses the lookup the sprint gate's version read performs, so both paths name the same reason.
2. **Cut result.** When the open read returns exactly `max` rows and the response carries a next-page token (or the count equals `max` where the token is absent), `issue-list` prints one line on stderr naming the row count and the requested limit, in the form of the `pr-list` report. Stdout stays unchanged.

### Open Questions

- [ ] Does the version existence check cost an extra Jira call per `--fix-version` read, and does the budget record it?
- [ ] Should the cut notice fire on a `--paged` read, which already prints its token, or only on an unpaged one?

## Slices

### Unknown version and cut notice

- `bug/jira-issue-list-answers-an-unknown` — refuse an unknown `--fix-version` with `version-not-found`; report a cut `issue-list` result on stderr <!-- builds: issue-list version-not-found refusal, issue-list cut-result notice -->

## Notes

Source: https://github.com/plot-pm/plot/issues/2251. Nothing is written to the tracker.
