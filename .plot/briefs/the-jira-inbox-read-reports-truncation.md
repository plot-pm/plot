## Implementation brief — jira-inbox-and-issue-index (wave 1: Inbox read)

- **Plan (canonical):** `docs/plans/2026-10-16-jira-inbox-and-issue-index.md` on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1860 merged
- **Branch:** `feature/the-jira-inbox-read-reports-truncation` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

Wave 1 of 4. The three later waves (scope gate, closed set, coverage) wait on this one and build on the inbox read it changes.

### What to build

The Jira inbox read reports itself as complete when it is not, and a failed read leaves stale rows with no marker. Both findings (#1688 M2, M3) still hold on main at `7c2ac9a01`; no commit has touched the tracker adapters, `plot-host.sh` or the fleet since approval.

**M2 — silent truncation.** `refreshIssueIndex` calls `tracker.issueListInbox(ISSUE_INDEX_OPEN_LIMIT)` (`packages/fleet/src/shared/issue-refresh.ts:320`, limit 1000). `trackerReads.issueListInbox` (`tracker-shell.ts:338`) sends `--limit 1000` and returns `complete: issues.length < limit, pages: 1`. In `plot-host.sh` the inbox arm is not `paged`, so `max="${limit:-50}"` sends `maxResults=1000` and Jira caps the page near 100. A reader with 150 open tickets gets 100 rows and `complete: true`. The result type already has `complete` and `pages`; the inbox read must make them true.

**M3 — a kept inbox with no marker.** `inboxOutcomeOf` returns `inboxSkipped(kept)` on `unaskable` and `{ inbox: kept, … }` on a failed read. The previous pass's rows then sit in `inbox` with nothing saying they are old, and they survive removal of `Ticket prefixes`. The index must record when the inbox was read, so a reader derives staleness from a stored time.

### Decisions the plan leaves open — settle them in the first commit and record each in the PR body

- **Page or cap.** The plan's open question: walk pages (more requests against the Jira budget) or cap at one page and record that it was capped. The closed read already pages: `plot-host.sh` takes `--paged` and `ISSUE_PAGE_ROWS`, and the TypeScript `walk` follows `nextPageToken`. Reuse that walk before writing a second one. Count the requests with `pages`, which feeds `issueIntervalMs(requests)`; a 3-page inbox must cost 3.
- **What the index stores.** The index holds answers, never verdicts (`CLAUDE.md`, *A Decision Reads The Index*). A truncation flag is an answer the host gave. A staleness verdict is not stored: store the read time and derive staleness from it. Any new field goes on the `.strict()` `IssueIndexSchema` with no `.default()`, and the board and fleetd restart together after the change.
- **`unaskable` drops the kept inbox.** An `unaskable` read means the read no longer applies, so `inbox` is cleared. A failed read keeps the rows and marks them, because the failure may be transient.

### Rules carried over — do not re-learn them by breaking them

- **Absent is not false.** `inbox` is absent where no read happened, never `[]` for "nothing in it". A new field follows the same rule.
- **The index never says no.** A truncated or unread inbox is not proof a ticket is absent.
- **One writer.** `refreshIssueIndex` is the only writer of `issues.json`; `one-issue-index-writer.test.ts` holds that.
- **Layering.** The decision lives in the domain; `plot-host.sh` stays the one host caller; no new `spawn`/`execFile` outside `adapters/` (the ratchet is `allowed=28`).
- **Arrow functions** for every function you write. Do not convert neighbours.
- **No rewrite of `ISSUE_INDEX_OPEN_LIMIT` semantics for the open read.** Only the inbox read changes in this slice.

### Done when

The plan lists no `## Done when`, so the specification is the Motivation findings M2 and M3 and the plan's Changelog line. The assertions below exist because a naive change would pass without them:

- An inbox with more rows than one page reads `complete: false`, or is walked to completion with `pages` equal to the pages fetched. A test with a fixture of 101 rows catches the `issues.length < limit` rule that read true at 100.
- `inboxOutcomeOf` on `unaskable` returns no kept rows. A test with `kept` set catches the old `inboxSkipped(kept)` path.
- A failed read keeps its rows and the index records that they are old. A test that reads the file after a failed pass catches a marker held only in memory.
- A cold store and a store written before this change decode with the new field absent (`decodeIssueIndex`). A test over an old-shape fixture catches an accidental required field.

Plus: a changeset for `plot` with the description first and the `bumps:` block last, and a rebuilt board bundle tested locally but not committed. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in `CI suites` run in CI and a failure there comes back as a correction. Run no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the slice touches `plot-host.sh`, pay for the growth in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/adapters/tracker/tracker-shell.ts`, `tracker-jira.ts` (inbox arm only), `packages/domain/src/entities/issue-index.ts`, the inbox half of `packages/fleet/src/shared/issue-refresh.ts` and the inbox arm of `skills/plot/scripts/plot-host.sh`, with their tests.

The other three branches of the plan touch what this one must not:

- `feature/the-ticket-prefix-scope-has-one-source` — the `PLOT_TICKET_PREFIXES` gate in `tracker-jira.ts` and the `issue-open` arm. Leave the gate at `tracker-jira.ts:119-130` as it is.
- `feature/the-closed-set-answers-for-itself` — the closed read's `unsupported` reason and `state.issueError`. Leave `closedOutcomeOf`.
- `feature/the-tracker-connector-paths-are-tested` — `tracker-fixture.ts` coverage. Extend the fixture only as far as your own tests need.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
