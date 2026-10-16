# Sprint: Bitbucket, Jira and Jenkins work with the board

> A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.

## Status

- **State:** Active
- **Start:** 2026-10-16
- **End:** 2026-10-23
- **Release:** 2.28.0

## Sprint Goal

**A project hosted on Bitbucket, tracked in Jira and built on Jenkins works with the board as well as a GitHub project does.**

The board and the fleet were built against GitHub, GitHub issues and GitHub Actions. The three connector plans close the gaps that stop a Bitbucket, Jira and Jenkins project from using the same lifecycle: the host connector (#1848), the tracker connector (#1849) and the CI connector (#1867). The ticket index and the ticket rows make the assigned tickets of such a project visible and current on the board.

### Must Have

- [x] [bitbucket-parity-and-app-identities] Host connector: Bitbucket parity and App identities (#1848)
- [ ] [jira-inbox-and-issue-index] Tracker connector: Jira inbox and issue index (#1849)
- [ ] [the-agent-s-ci-wait-never] Jenkins CI: the agent's CI wait settles, and a Jenkins check binds to a commit (#1867)

### Should Have

- [ ] [the-ticket-index-updates-incrementally-and] The ticket index updates incrementally and takes Plot's own issue writes at once (#1856)
- [x] [ticket-rows-show-type-and-owner] Ticket rows show type and owner under one "Assigned to you" sub-header (#1837)

### Could Have

- [ ] [row-placement-and-wording-1677-1791] Waiting on you: row placement and wording (#1830)
- [x] [fleetd-scan-cost-and-read-cadence] fleetd scan cost and read cadence (#1845)

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-16: Tiers set by Jan Wloka: Must are the three connector plans; Should are the ticket index and the ticket rows; Could are #1830 and #1845.
