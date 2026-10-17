# Waiting on you: a long ticket title hides the plan name

> A long ticket title squeezes the plan name out of its row in Waiting on you, and the `Assigned to you · N` sub-header does not render on the operator's board.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #1960
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1975 merged

## Changelog

- Waiting on you: a ticket row truncates its title before its plan name, and the `Assigned to you · N` sub-header shows above the ticket rows.

<!-- Board impact: packages/board only (AgentList.tsx and, if the heading cause is in the payload, the waiting view in the domain). No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

Issue #1960, seen on the operator's board on 2026-10-17 (built from `cd44b52a9`), in *Waiting on you* with 9 tickets assigned to the reader:

- Rows for #1849, #1848 and #1830 show the plan slug (`jira-inbox-and-iss…`, `bitbucket-…`, `r…`). Rows for #1952, #1951, #1950, #1867, #1856 and #1837 show only the plan icon. The rows without a name have the longest titles, and #1830's slug is cut to one letter. The plan-name column gives up its width when the title is long.
- `/api/fleet` returns `waiting: {shown: 9, hidden: 22, complete: true, notice: null, source: {service: github, match: host-login}}`, so the block should open with `Assigned to you · 9`. The served bundle contains the `data-waiting-heading` row, rendered when `issueAnswer === 'answered'` and `issues.length > 0` (`packages/board/src/app/components/AgentList.tsx:2468`). The screenshot shows the `22 open tickets are not assigned to you` control row and no sub-header above the ticket rows. The cause is not traced.

## Design

### Approach

1. **Trace the sub-header first.** Find which list `issues` holds at the heading condition and which list `IssueRowView` renders. The heading counts one list and the rows may come from another, for example the raw issue index against the `waitingView` selection. Reproduce with the payload quoted above before changing code.
2. **Make the title the column that truncates.** In the ticket row, give the title `min-w-0` and `truncate`, and give the plan name a fixed minimum width with `shrink-0`, so a title shrinks before the plan name does. Keep the plan name's own truncation for slugs longer than that minimum.
3. **Decide in the domain.** The heading text already comes from `waitingView` (`waitingBlock.heading`). If the cause is a disagreement between the count and the rendered list, the fix goes into the domain value so a unit test asserts it, per *Every rendered state is a domain property*.
4. **Browser test with the production payload.** One test feeds the payload above and asserts the sub-header text `Assigned to you · 9` and a visible plan name on a row whose title is long enough to overflow.

### Open Questions

- [ ] Which list do the rendered ticket rows come from, and is it the list the heading condition counts?
- [ ] What minimum width keeps a plan slug readable on the narrowest supported board width?

## Slices

### Fix

- `bug/a-long-ticket-title-hides-the` — trace and fix the missing sub-header, truncate the title before the plan name, add the browser test with the production payload

## Notes

- Source: tracker issue #1960. The plan answers it; the tracker receives nothing from this plan.
- Related: #1879 introduced the `Assigned to you · N` sub-header.
