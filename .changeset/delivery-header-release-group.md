---
'@plot-pm/board': minor
---

The Delivery tab header draws one Release group over every sprint in scope, in place of the release cards and the sprint card. The group shows the targeted versions as release tuples, a scope line (`all sprints · 3 people`, or `my sprint · <title>` under My sprint), one five-segment bar summed over the sprints, and a status line such as `Release PR #300 ready`. The bar is grey and the status line names the missing reading where any sprint is unread. A fixed slot at the top right holds the *Approve release* button for the lowest ready version, the line names the other ready PRs as `+N more ready`, and a disabled button has a dashed border with its reason as the status line and its title. With no release targeted, the group reads `No release targeted · last vX.Y.Z <date>`, from a new `lastRelease` field in the board payload.

<!--
plan: docs/plans/2026-11-20-delivery-tab-has-one-header.md
bumps:
  skills:
    plot: patch
-->
