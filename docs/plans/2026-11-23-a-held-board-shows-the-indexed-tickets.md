# A held board shows the indexed tickets

> A test proves the path #3551 reports, from the first `/api/fleet` render to the Tickets rows on a held board, so the issue closes on evidence and not on the unit test of one function.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** plot-describes-itself
- **Issue:** #3551
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Started:** 2026-11-24, Jan Wloka, `bug/a-held-board-shows-tickets-after-its-first-render`

## Changelog

- A board that serves in `held` mode shows the open tickets from fleetd's issue index after its first render, and the delivery test suite holds that path end to end.

<!-- Board impact: none. The slice adds a board test and changes no plan format, template, helper script or docs/plans layout. -->

## Motivation

#3551 reports that a board in `held` mode (a live fleetd on another snapshot protocol, #3528) shows "the tracker has not been read yet" in the Tickets section while fleetd keeps `.plot/state/index/issues.json` current. Observed 2026-11-19: fleetd on snapshot protocol 6, the board on protocol 8, `/api/fleet` answered `issueAnswer: null` with 0 rows.

**The main defect is fixed on main and the issue is still open.** PR #3552 (`bug/held-board-reads-issues`, merged 2026-11-19T10:17Z, commit `66507293e`) added `readHeldIssues` (`packages/board/src/server/fleet.ts:2707`), which the held PR beat calls (`fleet.ts:3189`). It installs the index through `installIssueIndex` and starts no process. The PR body says "Closes #3551", and GitHub still lists #3551 as open on 2026-11-23.

**What #3552 does not prove.** The held read filters planned issues through `entry.planMetas`. On a held board only the `/api/fleet` render fills it, through `fleetPlanIndexOf` (`fleet.ts:1878`, called at `fleet.ts:8902`). The tests in `packages/board/test/unit/board-serves-the-snapshot.test.ts:403` set `entry.planMetas` by hand or leave it null. No test runs the reported sequence: a render, a PR beat, and a second render that returns the rows. Until one does, a regression in that order reproduces #3551 with every test green.

**Why it matters for the sprint goal.** A second operator who follows Plot's documents to an unattended run reads the Tickets section to find work. A fleetd left on an older bundle is the common case after an upgrade, and in that case the section must show the tickets, not a sentence that blames the tracker.

## Design

### Approach

- **One board test, no production change unless it fails.** The test builds a held board (snapshot link `mismatch`, a live fleetd heartbeat, a fixture `issues.json` with two rows, one plan on the default branch that names one of them). It calls `buildFleet`, then `maybeRefreshPrs`, then `buildFleet` again, and asserts the second `/api/fleet` body: `issueAnswer: 'answered'`, the unplanned row only, and `issueError: null`.
- **The rendered state stays a domain property.** The Tickets wording comes from `delivery-view.ts:437` and `section-empty.ts:132` over `issueAnswer`; the test asserts `issueAnswer`, so no browser test is needed.
- **A failing test is the bug.** If the second render still answers `null` or `failed`, the slice fixes the order in the board's server layer (`fleet.ts`), where `readHeldIssues` already lives. No domain or port change is expected.
- **Close the issue with the evidence.** The slice's PR names #3551 and links #3552, so the issue closes on merge.

### Open Questions

- [ ] `[question-render-starts-processes]` On a held board, `fleetPlanIndexOf` runs `planMetasAtDefault` (`fleet.ts:1685`), which reads refs through `git` and parses plans through `plot-plan-meta.sh`. #3528 holds `held` to file reads, and this render still starts processes on the render clock. Recommendation: leave it out of this plan and file a separate issue with a process count from a held render, because the issue reports a missing inbox, not a process count.
- [ ] `[question-cold-held-board]` A held board that has not rendered once answers `failed` with "no plan read has answered while fleetd speaks another snapshot protocol" (`fleet.ts:2714`). Recommendation: accept it. The Tickets section is read through a render, and that render fills `entry.planMetas` for the next PR beat.

## Slices

### Proof

- `bug/a-held-board-shows-tickets-after-its-first-render` — a board test runs render, held PR beat, render, and asserts the second `/api/fleet` body carries the unplanned index row with `issueAnswer: 'answered'`; the PR closes #3551 <!-- builds: the held render-to-Tickets test in board-serves-the-snapshot.test.ts --> <!-- tests: on held, buildFleet then maybeRefreshPrs then buildFleet answers issueAnswer 'answered', issueError null, and only the row no plan names -->

## Notes

Created on 2026-11-23 from issue #3551, for the sprint plot-describes-itself.

The fix itself shipped in PR #3552 on 2026-11-19; this plan proves the reported path and closes the issue.
