# Board shows no tickets offline without a fleet, although the issue index holds them

> With no fleet running and the host unreachable, a freshly started board shows an empty inbox while `issues.json` holds the last open-issue list.

## Status

- **State:** Released
- **Type:** bug
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2371 merged
- **Sprint:** bugfix-2-28-1
- **Issue:** #2369
- **Delivered:** 2026-10-23
- **Released:** 2026-10-23, v2.28.1
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches
- **Started:** 2026-10-23, Jan Wloka, `bug/board-shows-no-tickets-offline-without`

## Changelog

- A board with no fleet and no host answer shows the open issues from `.plot/state/index/issues.json`, with the failure line and the index's age, instead of an empty inbox.

<!-- Board impact: changes the board's server read path (`packages/board/src/server/fleet.ts`) and the inbox's staleness line. No change to the plan format, the template, the helper scripts or the docs/plans layout. Rebuild the board artifact (pnpm build:board) to test locally; do not commit it. -->

## Motivation

Issue #2369. `maybeRefreshPrs` (`packages/board/src/server/fleet.ts:2245-2270`) reads `issues.json` only when `fleetOwnsPrs` is true: the supervisor reads `up` and the fleet bridge is fresh. Otherwise `refreshIssues` (`:1937`) asks the tracker itself and keeps its rows in the board's memory only.

On a failed read, `refreshIssues` keeps the last in-memory rows (`:1990`). A board that has read none yet (just started or restarted) has none, and it never reads `issues.json`. The result is an empty inbox beside a file that holds the list.

## Design

### Approach

When the board owns the read (`fleetOwnsPrs` is false) and `refreshIssues` fails with no in-memory rows, the board loads the rows from `issues.json` through the existing reader behind `readIssuesFromStore` (`:2105`).

- The board uses the file only when its `source` matches this repository's issue source (`issueSource`).
- The board shows the failure line and the index's age beside the rows.
- The board writes nothing. `refreshIssueIndex` stays the one writer (CLAUDE.md, *A Decision Reads The Index*).
- Rows read this way are not marked as a live answer: `issueAnswer` stays `failed`, so the next poll still asks the host.
- A missing, unparseable, other-version or other-source file leaves the inbox as today and shows no age.

### Open Questions

- [x] Should the fallback also apply when `refreshIssues` fails and memory holds older rows than the file? **Settled: no — memory always wins.** The brief fixed this during interrogation: in-memory rows are at least as new as the file's `at` unless another process wrote it, so `offlineIssueRows` (`packages/domain/src/rules/issue-offline-fallback.ts`) only reads the file where `memoryRows` is `null`.
- [x] Which field carries the age: the file's `at`, or the last successful `askedAt`? **Settled: the file's `at`.** It needs no new state beyond what `issues.json` already carries, it answers "how old is this data" honestly even when the fleet process that wrote the file ran on another machine or clock than this board, and it mirrors the existing `prAt`/`prAgeSeconds` precedent for PR staleness in the same file. A separately-tracked "last successful `askedAt`" would mean a board that has never once answered live still has no age to report, which is exactly the cold-start case this plan exists to fix.

## Slices

### Offline issue rows

- `bug/board-shows-no-tickets-offline-without` — read `issues.json` on a failed issue read when the board holds no rows, and show its age → #2383

## Notes

- Domain rule first: the choice between memory rows, index rows and none is a domain property, tested without a browser (CLAUDE.md, *The Domain Package*).
- Deliverable search: `issues.json` already has a reader (`packages/domain/src/adapters/issue-index/issue-index-file.ts`) and a board consumer (`readIssuesFromStore`); the plan reuses both and builds no new reader.
- Similar plans: `2026-10-16-jira-inbox-and-issue-index` (built the index) and `2026-10-19-the-board-shows-no-rows-when` (poll limit, Released). Neither covers a board with no fleet.
