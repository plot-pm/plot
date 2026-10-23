# Board: a Jira ticket named in `Issue:` leaves the inbox

> A plan whose `Issue:` field names a Jira key (`EWZKUS-3893`) removes that ticket from *Waiting on you*, as `#<n>` does for a GitHub issue.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2412
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2430 merged

## Changelog

- The board inbox treats a Jira ticket as planned when an open plan's `Issue:` field names its key, and the ticket leaves *Waiting on you* or shows the plan it belongs to.

<!-- Board impact: changes how the board matches plan `Issue:` values to inbox rows. No change to the plan format, the template or `issues.json`. -->

## Motivation

Observed in ewz-kus-portal (Plot 2.28.0, `Tracker: jira`, `Ticket prefixes: EWZKUS`, Bitbucket) on 2026-10-23. Plans 3893, 3894 and 3895 on `develop` each carry `- **Issue:** EWZKUS-<n>` in `## Status`, are Approved and started. `/api/board` shows `"issues": ["EWZKUS-3893"]` on each card. The same payload lists `EWZKUS-3893`, `EWZKUS-3894` and `EWZKUS-3895` in `tickets.open`, with no link to a plan. The payload was regenerated after the plans landed, so a cache does not explain it.

`/plot-idea` documents `Issue:` as the field that makes the board drop an issue from its inbox. The card side already carries the key as a string. The suspected cause is that the inbox side compares `#<n>` references only and never compares a tracker key. This is a hypothesis; the plan's first slice confirms it before any fix.

## Design

### Approach

1. Reproduce with a fixture: one plan with `Issue: EWZKUS-1` and an open ticket row `EWZKUS-1`; assert the ticket is planned. Find the comparison that fails, starting from `packages/domain/src/rules/ticket-phase.ts` and `waiting-tickets.ts` and the board's planned-set derivation.
2. Normalise both sides to one key form (`#12` for a GitHub issue, `PREFIX-12` for a tracker key) in the domain, so the comparison is a domain property and a unit test asserts it without a browser.
3. Check the neighbours of the same comparison: a plan naming several keys (`EWZKUS-1, EWZKUS-2`), a key whose prefix is not in `Ticket prefixes`, and a Draft plan PR's `Issue:` (see [a-planned-issue-shows-its-plan](2026-10-17-a-planned-issue-shows-its-plan.md)).

The related plans [my-jira-tickets-are-in-the-inbox](2026-08-26-my-jira-tickets-are-in-the-inbox.md) and [jira-inbox-and-issue-index](2026-10-16-jira-inbox-and-issue-index.md) built the Jira inbox; this plan corrects the planned-set match they left open.

### Open Questions

- [ ] Does the match fail in the domain rule, in the board's plan-to-issue index, or in the parse of the `Issue:` field?
- [ ] Is a key matched case-sensitively?

## Slices

### Fix

- `bug/jira-key-leaves-the-inbox` — a tracker key in `Issue:` marks the ticket planned, with a domain unit test and one browser test of the inbox

## Notes

Created from tracker issue #2412 by `/plot-idea`, unattended. Review `pr` and `Impl: own branches` follow the repo's `Plan PRs: required`; the design question was not answered, so the plan starts in Draft. Nothing is written to the tracker.
