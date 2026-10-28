# Board: empty Jira inbox read as a spelling mismatch; «Mine» keeps unknown-owner rows

> An empty Jira inbox makes *Waiting on you* suggest a colleague's account as the reader's spelling, and the «Mine» filter keeps every row whose owner it cannot resolve.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2808
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- *Waiting on you* shows no tickets and no spelling notice when the tracker's inbox for the reader is empty.
- The spelling notice fires only when the inbox is non-empty and none of its rows match the reader, and it names a spelling taken from the inbox.
- «Mine» hides `unknown` rows and shows their count beside the toggle; unassigned tickets move to a collapsed *Unassigned* section.

<!-- Board impact: yes. Changes `waitingTickets` in the domain and the «Mine» filter, the section list and the toolbar in packages/board. The plan format, template, helper scripts and docs/plans layout do not change. A board artifact rebuild follows from the board change. -->

## Motivation

Observed on the Delivery board of ewz-kus-portal (Plot 2.29.0, `Tracker: jira`, `Ticket prefixes: EWZKUS`) with two developers, jwloka and mruepp. The reader is jwloka. Jira `myself` is jan.wloka@quatico.com.

**1. An empty inbox reads as a spelling mismatch.** The query `assignee = currentUser() AND resolution = EMPTY AND project = EWZKUS` returns 0 issues, and `plot-host.sh issue-list --state inbox` prints nothing and exits 0. `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts:201-220`) then falls back to all open rows, finds none that match the reader, and takes the first assignee of any row as the reader's spelling. The banner reads: *The tracker names your tickets' assignee `markus.ruepp@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:markus.ruepp@quatico.com` to match.* Following that advice maps jwloka to a colleague's account. The 40 project-wide open tickets do not belong under *Waiting on you*.

**2. Ticket rows are duplicated.** About twelve rows (EWZKUS-3897 … 3849) appear twice in sequence in the same list. Jira holds 40 open tickets and the board rendered more rows. `unionDedup` (`waiting-tickets.ts:99`) dedups the union by `number`, so the duplicate comes from another path. The cause is not yet found.

**3. «Mine» keeps rows that are not provably mine.** `rowsForReader` and `ticketsForReader` (`packages/board/src/app/lib/agent-rows/mine-filter.ts`) hide only rows that `isMine` answers `theirs`, and `unknown` rows stay. With «Mine (Jan Wloka)» on, the board still showed 16 unassigned tickets, tickets assigned to a person not in `People`, and three Draft plans whose plan PRs (#3509, #3526, #3527) are authored by «Christian Kehl». The existing design keeps `unknown` visible so that a mis-resolved identity cannot silently empty the board. That concern holds, so the hidden part stays visible as a count.

**4. Plan-PR authors resolve to `unknown`.** `ckehl = Christian Kehl, jira:christian.kehl@quatico.com` is declared in `People`, and the Bitbucket PR author «Christian Kehl» does not resolve to `ckehl`. Either `People` needs a host spelling (the syntax for Bitbucket is undocumented), or the PR author field carries a different identifier than the display name. The `People` documentation does not say which.

Related: #2807 (reap keeps merged desks with worker files only).

## Design

### Approach

**Slice 1 — an empty inbox is zero.** In `waitingTickets`, the tracker-account arm treats `inbox` as the candidate set when the tracker answered the inbox query, including when the answer is empty. An empty inbox returns count 0 and no notice. It never falls back to the project-wide rows. The spelling notice fires only when the inbox is non-empty and no row matches, and `raw` comes from an inbox row. The host-login arm and the arm where the inbox query did not run (`inbox === undefined`) keep their current behaviour. The rule lives in the domain, so a unit test asserts the banner without a browser.

**Slice 2 — duplicate rows.** Reproduce the duplicate with the ewz-kus-portal shape (inbox plus project rows plus the issue index), name the path that emits a row twice, and fix it at that path. Add a regression test that fails on the duplicate.

**Slice 3 — «Mine» hides `unknown`, and counts it.**

- «Mine» on keeps only `mine` rows. The ownership rule in `packages/domain/src/rules/ownership.ts` stays the single source of the three answers.
- The toolbar shows `N others · M unknown ▸` while «Mine» is on and the unknown count is above 0. A click adds the `unknown` rows back. It is one control with three states, and it is absent while «Mine» is off.
- The counts come from a domain property, not from `.tsx`, per *Every rendered state is a domain property*.
- Unassigned tickets (empty assignee list) leave *Waiting on you* and go to their own collapsed *Unassigned* section.
- Resolve question 4: find why «Christian Kehl» does not resolve, then either fix the resolution or document the `People` spelling for each host in the `People` docs.

### Open Questions

- [ ] Where does the duplicate row come from (slice 2)? The issue shows twelve rows twice; the path is unmeasured.
- [ ] Does the Bitbucket PR author arrive as a display name, an account id or a nickname, and which `People` spelling does `resolvePerson` match (question 4)?
- [ ] Does the *Unassigned* section also apply with «Mine» off, or only with it on? The issue says unassigned tickets are not anybody's, which points to both.
- [ ] Does the existing *Only my work* toggle become the «Mine» control of the proposal, or does the proposal replace it? Name the toggle in the plan before slice 3 starts.

## Slices

### Inbox

- `bug/empty-jira-inbox-is-zero` — an empty tracker inbox returns no tickets and no notice; the notice names an inbox spelling only

### Duplicates

- `bug/ticket-rows-appear-once` — find the path that renders a ticket row twice and fix it, with a regression test

### Mine

- `feature/mine-counts-what-it-hides` — «Mine» keeps only `mine` rows, shows the unknown count as one control, and moves unassigned tickets to a collapsed section; the `People` docs state the host spelling

## Notes

- Issue: https://github.com/plot-pm/plot/issues/2808. The plan names it in `Issue:` and writes nothing to the tracker.
- Earlier work in the same area: `2026-09-09-jira-inbox-is-instance-wide-the`, `2026-10-16-jira-inbox-and-issue-index`, `2026-10-23-only-my-work-waiting-on-you` (Released). Check each before slice 3 changes the filter's contract.
