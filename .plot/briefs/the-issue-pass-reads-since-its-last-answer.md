## Implementation brief — the-ticket-index-updates-incrementally-and (wave 2: Incremental)

- **Plan (canonical):** [docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md](../../docs/plans/2026-10-16-the-ticket-index-updates-incrementally-and.md) on `main`
- **Approved:** 2026-10-16, Jan Wloka, plan-PR #1857 merged
- **Branch:** `feature/the-issue-pass-reads-since-its-last-answer` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** standard PR review

Wave 2 of 3. It waits on wave 1 (`feature/the-ticket-index-rows-carry-updated-at`, merged as #1915): `IssueIndexRow.updatedAt` and `foldIssueRows` (`packages/domain/src/rules/fold-issue-rows.ts`) exist on `main`. Wave 3 (`feature/the-index-takes-plots-own-issue-writes`) waits on this branch.

### What to build

`refreshIssueIndex` (`packages/fleet/src/shared/issue-refresh.ts`) calls `tracker.issueListOpen(ISSUE_INDEX_OPEN_LIMIT)`, then `issueListClosed` and `issueListInbox`, on every pass and replaces the open rows and the closed set whole. Measured 2026-10-16: the index held 140 open rows from its 08:18Z read while GitHub held 30 open issues, and the board showed #1756 open minutes after it closed. A fix is right only if a pass with nothing changed spends one request instead of the pages of three lists.

1. **`Tracker.issueListChanged(since, limit)`** on the port (`packages/domain/src/ports/tracker.ts`, beside `issueListClosed`). It lists the issues, open or closed, changed at or after `since`. Every connector implements it or answers `unaskable` with a `reason`: `trackerGithub` (`/repos/{o}/{r}/issues?state=all&since=<at>`), `trackerJira` (`updated >= "<at>"`, scoped by `Ticket prefixes` as the closed read is), `trackerFixture`, `trackerGitHost`, `trackerNone`. Bitbucket answers `unaskable` unless its issue API has an update filter. Add the shell arm to `plot-host.sh issue-list` only as far as the connectors need; `scripts/check-shell-lines.sh` refuses net growth, so move work into the TypeScript adapter instead of adding lines.
2. **`refreshIssueIndex` folds.** With a held index of the same `source` and `connector` and `answer: 'answered'`, a pass asks `issueListChanged(held.at, …)` and folds the result into the held open rows and closed set with `foldIssueRows`. A changed row whose `statusCategory` is closed leaves the open set and enters the closed set; a new or reassigned row updates in place.
3. **Full read as the floor.** A full read (today's path) runs every N passes or once a day, whichever comes first. Name N and the day bound as constants next to `ISSUE_REFRESH_MS` (`packages/domain/src/rules/cadence.ts:261`). A pass with no held index, a held index of another source or connector, or `answer` other than `answered` reads whole.
4. **Spend and failure.** `requests` counts the pages of the incremental read, so `issueIntervalMs` and `issueGateOf` stay correct. A failed incremental read keeps the previous rows, records `failedAt` and `reason`, sets `issueError`, and feeds `backoffUntil` through `hostReaction` as a failed closed read does. It is never read as "no change".

### Decisions the plan settles — do not re-derive them

- **`since` cannot report a deleted or a transferred issue.** That is the only reason the full read exists. Do not drop the floor because the incremental read "looks complete".
- **One writer.** `refreshIssueIndex` stays the only writer of `issues.json`; `one-issue-index-writer.test.ts` must pass unmodified.
- **`v` stays 1.** `IssueIndexRowSchema` is `.strict()` with no `.default()`, so an older reader fails closed to `null` and re-asks. Do not bump `ISSUE_INDEX_VERSION`.
- **The index holds answers, never verdicts** (CLAUDE.md, "A Decision Reads The Index"). The fold derives no lifecycle decision.
- **Absent is not false.** An `unaskable` or failed incremental read is not an empty change list. Three outcomes stay apart: answered empty, failed, `unaskable`.
- **Write-through is wave 3.** Do not add an issue-write path here; this slice does not move `at` on a write.

### Open questions the plan leaves to this slice

Decide each, record the answer in the plan's Open Questions in the same PR: (a) one keyed row list or the separate `closed` object with its own `since`; (b) the value of N, and whether the day bound runs on the last full read's `at` or the wall clock; (c) whether the inbox read goes incremental or stays whole (it is person-scoped and small, so whole is the default). The board reads `closed` and `inbox` today, so keep their shapes unless (a) is answered otherwise with a board change.

### Done when

The plan has no `## Done when` list; the specification is the Approach section above. Assertions a naive implementation passes without:

- A pass that returns no changed rows still writes `at` and `nextAt` and keeps every held row (catches treating an empty answer as "replace with nothing").
- A changed row closed on the tracker leaves `rows` and appears in `closed.rows` (catches a fold that only updates in place).
- A failed incremental read leaves `rows`, `closed` and `at` as held and sets `failedAt` (catches silent "no change").
- A held index of another connector reads whole (catches reusing a foreign `at`).
- The Nth pass, and a pass after the day bound, read whole and drop a row the tracker no longer lists (catches a missing floor).
- `requests` equals the incremental read's pages (catches `issueIntervalMs` and `issueGateOf` over- or under-counting).

Plus the repo gates: a changeset with `bumps:` last (`@plot-pm/board` or `plot` as the package check allows; run `./scripts/check-changeset-packages.sh`), and any domain TSDoc stated as fact, not history. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites under `CI suites` run in CI; a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. If the slice touches a `.sh` file, pay for growth in the same change — remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. Then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/ports/tracker.ts`, `packages/domain/src/adapters/tracker/*`, `packages/domain/src/rules/cadence.ts` (constants only), `packages/fleet/src/shared/issue-refresh.ts`, the `issue-list` arm of `skills/plot/scripts/plot-host.sh`, and their tests. Wave 3 (`feature/the-index-takes-plots-own-issue-writes`) later touches `issue-refresh.ts` and the tracker write path; leave `issueOpen` and the status write alone. Wave 1 is merged; do not change `foldIssueRows` semantics. If you find something the plan did not anticipate, report it rather than improvising outside scope.
