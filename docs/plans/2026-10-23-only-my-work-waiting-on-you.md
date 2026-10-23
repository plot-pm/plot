# Only my work and Waiting on you: a slice row without a PR takes its plan's owner

> A Delivery-tab row with no PR is owned by nobody, so *Waiting on you* and the *Mine* chip keep it for every reader, even when its plan names an assignee that resolves through `People`.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2389
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2415 merged
- **Started:** 2026-10-23, jwloka, `bug/only-my-work-waiting-on-you`

## Changelog

- A Delivery-tab row with no PR takes its plan's assignee, author or approver as its owner. *Waiting on you* and the *Mine* chip hide that row from a reader who is not that person.

Board impact: yes. The change is in `packages/board` (the row payload and `mine-filter.ts`). The plan format, template and helper scripts stay unchanged.

## Motivation

`ownedFromRow` (`packages/board/src/app/lib/agent-rows/mine-filter.ts:87`) reads the PR author and nothing else: a row with a PR is `{ kind: 'pr', author }`, and every other row is `{ kind: 'other' }`. A row of kind `other` is unknown to `isMine`, so the filter shows it to every reader.

A Draft plan's slice has no branch and no PR, so it always lands in that case. The Planning tab already reads the plan's `assignee`, `author` and `approver` through `ownedFromCard` (#1046). The same plan is therefore *theirs* on the Planning tab and *yours* on the Delivery tab.

Reported on Plot 2.28.0 (Bitbucket and Jira): three Draft plans on `idea/` branches carry `- **Assignee:** Christian Kehl`, and `People` maps `ckehl` to that name. The Planning cards resolve to `ckehl`. All three slices stay under *Waiting on you* for `jwloka`, labelled *plan not approved yet — still in review*. While the host answers 429, the plan PRs cannot be read, so nothing on the row names an owner.

## Design

### Approach

When a row carries no PR, the row's owner is its plan's owner: assignee, then author, then approver. This is the same field set and the same resolution `ownedFromCard` uses, through the reader's `People` directory. A PR keeps precedence where one exists. The branch name stays unconsulted, as `ownedFromRow` documents today.

`AgentRow` carries `plan` (display name) and `planFile`, and no ownership fields. The slice therefore does two things:

1. The server sets the plan's `assignee`, `author` and `approver` on the row where it creates the row, from the plan's card data. The client does not re-derive them from `planFile`, in the same way the row's sprint is joined on the server. A row with no plan (a release row, an unplanned PR) leaves the three fields empty.
2. `ownedFromRow` returns `{ kind: 'plan', assignee, author, approver }` for a row with no PR and a plan that names at least one of the three. It returns `{ kind: 'other' }` otherwise. The ownership rule in `packages/domain/src/rules/ownership.ts` already accepts the `plan` kind, so the rule itself needs no change.

A payload cast from an older server delivers `undefined` for the new fields. Absent and empty both read as no owner, so the row stays visible, as it does today.

### Open Questions

- [ ] Optional, from the issue: should a Draft plan awaiting approval be *waiting on* its approver or author instead of on whoever reads the board? This changes what *Waiting on you* means, not only who sees a row. The plan treats it as out of scope unless the reader decides otherwise.
- [ ] Which field wins when `assignee` resolves to one person and `approver` to another? The plan assumes the order assignee, author, approver, taken from `ownedFromCard`. Confirm that `isMine` already encodes this order.

## Slices

### Row ownership

- `bug/only-my-work-waiting-on-you` — a row with no PR carries its plan's owner fields, and `ownedFromRow` reads them <!-- builds: the plan owner fields on AgentRow, and the plan arm of ownedFromRow -->

## Notes

Source: issue #2389, https://github.com/plot-pm/plot/issues/2389. Related and released: #1046 (cards read the assignee), #967 (the Mine filter), #2079 (identity message).
