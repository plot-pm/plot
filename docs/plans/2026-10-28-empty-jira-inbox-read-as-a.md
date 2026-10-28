# Board: a missing Jira inbox read as a spelling mismatch; ticket rows repeat; Draft rows ignore «Mine»

> A board with no fleet never reads the reader's Jira inbox, then takes a colleague's account from the project-wide tickets as the reader's spelling. Ticket rows can appear twice, and Draft plan rows ignore the «Mine» filter.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2808
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2809 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/an-absent-inbox-guesses-no-spelling`

## Changelog

- A board with no fleet reads the reader's Jira inbox, so *Waiting on you* shows the reader's own tickets instead of the project's.
- With no inbox reading, *Waiting on you* never guesses the reader's spelling from project-wide tickets, and the spelling notice never suggests a spelling `People` gives another person.
- Each ticket appears once in *Waiting on you*, whichever path read it.
- Draft plan rows obey «Mine» like every other row: rows owned by another person hide, and rows with no known owner stay visible.

<!-- Board impact: yes. Changes `waitingTickets` in the domain, the board's no-fleet issue refresh in packages/board, the issue index fold in packages/fleet, and the Draft plan row's ownership. The plan format, template, helper scripts and docs/plans layout do not change. A board artifact rebuild follows from the board change. -->

## Motivation

Observed on the Delivery board of ewz-kus-portal (Plot 2.29.0, `Tracker: jira`, `Ticket prefixes: EWZKUS`) with two developers, jwloka and mruepp. The reader is jwloka. Jira `myself` is jan.wloka@quatico.com.

**1. A missing inbox reads as a spelling mismatch.** The reader's Jira inbox holds 0 issues. The banner reads: *The tracker names your tickets' assignee `markus.ruepp@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:markus.ruepp@quatico.com` to match.* `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) gives 0 tickets and no notice for an inbox that answered empty (`inbox: []`, `:201-203`); four independent probes in panel round 1 confirm it. The banner reproduces word for word only with `inbox: undefined`: the rule then falls back to all open project rows and takes the first assignee as the reader's spelling. The board with no fleet always takes that arm, because `refreshIssues` calls `waitingOf` with no inbox (`packages/board/src/server/fleet.ts:2096-2098`); only fleetd reads the inbox (`packages/fleet/src/shared/issue-refresh.ts:501`), and a failed first fleetd read also leaves it absent (`issue-refresh.ts:259-262`). The arm at `waiting-tickets.ts:196-198` (no `jira:` spelling declared) has the same defect. The suggested spelling already belongs to mruepp in `People`; following the advice would drop it for both people (`packages/domain/src/entities/person.ts:99-101`). `waiting-tickets.test.ts:175` pins the wrong advice as current behaviour.

**2. Ticket rows are duplicated.** About twelve rows (EWZKUS-3897 … 3849) appear twice in sequence. Only the matched arms of `waitingTickets` call `unionDedup` (`waiting-tickets.ts:99`); the fallback arms render `[...candidates]` (`:213`). Upstream, the paged read `walk` (`packages/domain/src/adapters/tracker/tracker-shell.ts:277-299`) drops repeated page tokens but not repeated issue keys, and the index write and `foldIssueRows` keep a key that the held rows already carry. The duplicated keys are the newest tickets, which points at the held index plus the changed-since fold; Jira's cursor was clean on pages 1–2 of 3 (202 open rows). The live ewz `issues.json` was not measured.

**3. Draft plan rows ignore «Mine».** With «Mine (Jan Wloka)» on, three Draft plans stayed visible. Draft plan rows skip the filter entirely (`packages/board/src/app/components/AgentList.tsx:514,1176`), and `DraftPlanSchema` has no owner field.

**Not a defect: Bitbucket PR authors.** A Bitbucket PR author arrives as `.author.nickname` (`skills/plot/scripts/plot-host.sh:4971-4983`). «Christian Kehl» on #3509, #3526 and #3527 resolves to `ckehl` through its declared display name, and `prOwnership` answers `theirs`. No `People` spelling makes a PR row `unknown`; the issue's question 4 rests on rows that were Draft plan rows (problem 3).

Related: #2807 (reap keeps merged desks with worker files only).

## Design

### Approach

**Slice 1 — the inbox is read, and an absent one guesses nothing.**

- The board's no-fleet issue refresh reads the reader's tracker inbox (`issue-list --state inbox`) and passes it to `waitingOf`, as fleetd does. One extra tracker call per refresh, on the same timer.
- `waitingTickets` distinguishes an inbox that answered from one that is absent. With an absent inbox on a project-scoped read, the tracker-account arm has no candidates: 0 tickets, no spelling notice, and a reason the view can name (*the inbox was not read*). It never takes a spelling from project-wide rows. The same holds for the arm at `:196-198`.
- The spelling notice fires only when the inbox is non-empty and none of its rows match the reader, takes its spelling from an inbox row, and never names a spelling `People` declares for another person.
- The rule lives in the domain; domain unit tests assert each arm without a browser. Replace the expectation at `waiting-tickets.test.ts:175`.

**Slice 2 — one row per ticket key.** Enforce one row per key at both funnels: where the issue index is written (`foldIssueRows` and the index write in `packages/fleet`) and where `waitingTickets` renders every arm, not only the matched ones. A later row for the same key replaces the earlier one. Regression tests feed overlapping pages and an overlapping fold and assert that no key appears twice on any arm, and that the hidden count never exceeds the number of distinct keys.

**Slice 3 — Draft plan rows obey «Mine».** A Draft plan row carries an owner (the plan PR's author where a plan PR exists) and passes through the same `isMine` filter as other rows. The released contract holds: `unknown` stays visible (`2026-09-24-the-board-shows-me-only-my-work.md:123`). The ownership comes from a domain property, not from `.tsx`.

**Out of scope, planned separately.** «Mine» hiding `unknown` rows behind a count, and an *Unassigned* section, reverse the released contract above and reach Discovery (`lanes-for-reader.ts:67`). They move to their own feature plan, which states that contract and the Bitbucket case where no login is known (`plot-host.sh account` exits 4) and every PR row reads `unknown`.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-empty-jira-inbox-read-as-a/panel.md`):

- [x] «Mine» hides unknown, the count and *Unassigned*: move to their own feature plan.
- [x] Slice 1: the no-fleet board reads the inbox, an absent inbox takes no spelling from project rows, and the notice never suggests another person's spelling.
- [x] Duplicates: fix at both funnels (index write and `waitingTickets` read) without waiting for the ewz `issues.json` measurement.
- [x] Draft plan rows ignoring «Mine»: a bug slice in this plan.
- [x] Is «Only my work» the same control as «Mine»? Yes: the chip row replaced the checkbox in #2080 (`DeliveryFilters.tsx:8-9`), with the same state and storage key.
- [x] Bitbucket PR author spelling: the nickname, matched as a plain spelling; no new `People` syntax.

## Slices

### Inbox

- `bug/an-absent-inbox-guesses-no-spelling` — the no-fleet board reads the inbox; an absent inbox gives no tickets and no notice; the notice never names another person's spelling <!-- builds: an inbox read in the board's refreshIssues, an absent-inbox arm in waitingTickets --> → #2814

### Duplicates

- `bug/ticket-rows-appear-once` — one row per ticket key at the issue index write and at every `waitingTickets` arm, with regression tests

### Draft rows

- `bug/draft-rows-obey-mine` — a Draft plan row carries its owner and passes the «Mine» filter; `unknown` stays visible

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2808. The plan names it in `Issue:` and writes nothing to the tracker.
- Earlier work in the same area: `2026-09-09-jira-inbox-is-instance-wide-the`, `2026-10-16-jira-inbox-and-issue-index`, `2026-09-24-the-board-shows-me-only-my-work` (the rule that `unknown` stays visible), `2026-10-23-only-my-work-waiting-on-you` (Released).
- The three slices touch separate files and merge in any order; slice 1 first is preferred because it removes the visible wrong advice.
