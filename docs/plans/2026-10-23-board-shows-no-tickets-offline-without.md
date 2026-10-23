# Board shows no tickets offline without a fleet, although the issue index holds them

> With no fleet running and the host unreachable, a freshly started board shows an empty inbox while `issues.json` holds the last open-issue list.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** #2369
- **Story:** <!-- optional, story slug this plan is part of (docs/stories/<slug>/) -->
- **Review:** pr
- **Impl:** own branches

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

- [ ] Should the fallback also apply when `refreshIssues` fails and memory holds older rows than the file? Proposal: keep the in-memory rows, since they are at least as new as the file's `at` unless another process wrote it.
- [ ] Which field carries the age: the file's `at`, or the last successful `askedAt`?

## Slices

### Offline issue rows

- `bug/board-shows-no-tickets-offline-without` — read `issues.json` on a failed issue read when the board holds no rows, and show its age

## Notes

- Domain rule first: the choice between memory rows, index rows and none is a domain property, tested without a browser (CLAUDE.md, *The Domain Package*).
- Deliverable search: `issues.json` already has a reader (`packages/domain/src/adapters/issue-index/issue-index-file.ts`) and a board consumer (`readIssuesFromStore`); the plan reuses both and builds no new reader.
- Similar plans: `2026-10-16-jira-inbox-and-issue-index` (built the index) and `2026-10-19-the-board-shows-no-rows-when` (poll limit, Released). Neither covers a board with no fleet.
