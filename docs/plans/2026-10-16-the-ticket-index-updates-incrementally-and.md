# The ticket index updates incrementally and takes Plot's own issue writes at once

> fleetd's ticket index folds only the issues changed since its last answered read, takes Plot's own issue writes through its one writer at once, and holds the fields the board's ticket rows show.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #1856
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1857 merged
- **Started:** 2026-10-16, Jan Wloka, `feature/the-ticket-index-rows-carry-updated-at`
- **Started:** 2026-10-17, Jan Wloka, `feature/the-issue-pass-reads-since-its-last-answer`
- **Started:** 2026-10-17, Jan Wloka, `feature/the-index-takes-plots-own-issue-writes`
- **Delivered:** 2026-10-17
- **Released:** 2026-10-22, v2.28.0

## Changelog

- The board's ticket rows reflect an issue that Plot or a person changed within one issue pass, and within seconds for a change Plot itself made.

<!-- Board impact: the board reads `issues.json` for its Waiting on you rows. A row gains `updatedAt`, so `IssueIndexRowSchema` and `ISSUE_INDEX_VERSION` change; the board artifact is rebuilt by main after merge. -->

## Motivation

`refreshIssueIndex` (`packages/fleet/src/shared/issue-refresh.ts:275`) reads the whole open list on every pass and replaces the open rows and the closed set whole. A change reaches the board only on the next pass, and a pass is spaced by `issueIntervalMs(requests)`, so the picture is stale between passes.

Measured 2026-10-16: the board showed #1756 open minutes after it closed and did not show #1837. The index held 140 open rows from its 08:18Z read while GitHub had 30 open issues after a triage.

Two costs follow from the whole-list read. Every pass spends the pages of the open list, the closed list and the inbox list, even where nothing changed. And a write Plot makes itself (`issueOpen`, the status write) is invisible to the board until the next whole read.

## Design

### Approach

**One writer stays.** `refreshIssueIndex` remains the only caller that writes `issues.json`, and `one-issue-index-writer.test.ts` keeps holding that. Write-through reaches the index by handing the writer a changed row; no second module writes the file.

**Rows carry what the board shows.** `IssueIndexRow` already holds `number`, `title`, `url`, `createdAt`, `status`, `statusCategory`, `closedAt`, `assignees` and `type` (`issueIndexRowOf`, `issue-refresh.ts:68`). It gains `updatedAt`, present only where the tracker gives it. Where two readings of one key disagree, the row with the newer `updatedAt` wins; a row with no `updatedAt` loses to one that has it and replaces an equal one.

**Incremental read.** A pass asks the tracker for the issues changed since the index's last answered read (`at`):

- GitHub: `/repos/{o}/{r}/issues?state=all&since=<at>`.
- Jira: `updated >= "<at>"`.
- Bitbucket: where its issue API supports an update filter; otherwise the connector answers `unaskable` for the incremental read and the pass reads whole, as it does today.

The pass folds the returned rows into the held rows by key. A row whose state is closed leaves the open set and enters the closed set; a new or reassigned row updates in place. The incremental read is a new operation on the `Tracker` port beside `issueListClosed`, and every connector implements it or answers `unaskable`.

**Full read as the floor.** `since` reports neither a deleted issue nor a transferred one. A full read runs every N passes or once a day, whichever comes first, and replaces the rows whole as today. N and the day bound are named constants next to `ISSUE_REFRESH_MS`. A pass with no held index, a held index of another source or connector, or a held index with `answer` other than `answered` reads whole.

**Write-through.** After a successful `issueOpen` or status write through the tracker port, the caller passes the changed row to the writer, which folds it by key with the newer-`updatedAt` rule and writes the file. The port has two writes today (`issueOpen` and the status write) and no assign or edit; a future write joins the same path rather than adding one. The write-through does not move `at`, `nextAt` or `backoffUntil`, because it is not a read of the tracker and the cadence tracks reads.

**Failure and spend.**

- A failed incremental read keeps the previous rows, records `failedAt` and `reason`, and is named in `issueError`; it is never read as "no change". Its refusal feeds `backoffUntil` through `hostReaction` as a failed closed read does.
- `requests` counts the pages of the incremental read, so `issueIntervalMs` and the PR pass's subtraction of the gate's spend (`issueGateOf`) stay correct. A write-through call spends one request on the tracker's connector and account and adds it to `requests`.
- The index holds answers, never verdicts (CLAUDE.md, "A Decision Reads The Index"). Nothing in the fold derives a lifecycle decision.

### Open Questions

- [x] Does the closed set stay a separate `closed` object with its own `since`, or does one keyed row list with a state replace the open rows and the closed set? One list simplifies the fold; the separate set keeps the shape the board reads today. **Stays separate** (`feature/the-issue-pass-reads-since-its-last-answer`). The incremental read folds into `rows` and `closed.rows` by `statusCategory`, and carries `closed.since`/`at`/`answer`/`complete` over unchanged — the incremental pass never re-asks `issueListClosed`, so it has no fresh answer for those fields. One keyed list would need every reader of `closed` (the board included) to change in the same slice as the fold itself.
- [x] Which value of N, and is the once-a-day bound measured on `at` of the last full read or on the wall clock? **N = 20 passes, day bound = 24h, anchored on `fullReadAt`** — the last full read's own timestamp, not wall-clock `now` (`ISSUE_FULL_READ_PASSES`, `ISSUE_FULL_READ_MS`, `cadence.ts`). Anchoring on `fullReadAt` makes the bound a property of the held index rather than of when a reader happens to ask, so two passes computing `dueForFullRead` from the same held index always agree.
- [x] Does the inbox read (`issueListInbox`) go incremental too, or stay whole because it is person-scoped and small? **Stays whole.** An incremental pass carries the held `inbox`/`inboxAt` over unchanged, the same as a pass that skips the inbox read today; nothing in this slice reads or writes it.
- [x] Where does a write-through caller live, given that the tracker port is reached from the board's `review.ts` and `verify.ts` entries and the fleet runs in another process? The board process and fleetd both write today only through fleetd's writer; a board-side write needs a path to that writer that adds no second writer. **A spool beside `issues.json`** (`feature/the-index-takes-plots-own-issue-writes`). The caller appends one line to `.plot/state/index/issue-writes.jsonl` through `handOffIssueWrite`; fleetd drains it on every 5 s base beat (`issue-writes` in `fleetDivisors`) through `drainIssueWrites`, which folds it with `issueWriteThrough` and writes through `refreshIssueIndex`'s store, so a row reaches the index within one beat of the write, not one issue pass. A stopped fleetd leaves the spool in place (capped at 256 KiB, bound *spent*) and the next fleetd drains it; no endpoint is called, so there is no absent-versus-false answer to refuse. Rejected: a fleetd endpoint, which needs fleetd running at the instant of the write and so loses the row of any write made while it is down.
- [x] Does `ISSUE_INDEX_VERSION` move from 1 to 2, so a reader of the old shape reads "ask again" rather than a row without `updatedAt`? **No, `v` stays 1** (`feature/the-ticket-index-rows-carry-updated-at`). `IssueIndexRowSchema` is `.strict()` with no `.default()`, so a pre-change reader meeting a row that carries `updatedAt` already fails closed to `null` — the store's documented "every failure is null" contract — and re-asks, at the cost of one extra tracker read. A version bump buys no extra safety over that scoped fallback and additionally invalidates every already-compatible reader until its next pass.

## Slices

### Rows

- `feature/the-ticket-index-rows-carry-updated-at` — `IssueIndexRow` gains `updatedAt`, `issueIndexRowOf` fills it, and a fold-by-key rule in the domain applies the newer-`updatedAt` rule → #1915 <!-- builds: foldIssueRows, a domain rule folding issue rows by key -->

### Incremental

- `feature/the-issue-pass-reads-since-its-last-answer` — the `Tracker` port gains an incremental read, the GitHub, Jira and fixture connectors implement it, and `refreshIssueIndex` folds its rows with a full read every N passes or once a day → #1938 <!-- builds: issueListChanged, a tracker read of the issues changed since a time -->

### Write-through

- `feature/the-index-takes-plots-own-issue-writes` — `issueOpen` and the status write hand their changed row to the one writer, which folds it without moving the read cadence → #1949 <!-- builds: issueWriteThrough, the path a Plot issue write takes into the index -->

## Notes

- Source: issue #1856 (maintainer, 2026-10-16). The plan is written from the issue and from `issue-refresh.ts` at `36cb3f860`.
- The tracker port holds two writes today, `issueOpen` and the status write. The issue's "assigns" and "edits" have no port write yet; this plan leaves them to the plan that adds them.
- Each slice leaves the board working: the first adds a field the board ignores, the second changes how the index is filled, the third adds rows the board already reads.
