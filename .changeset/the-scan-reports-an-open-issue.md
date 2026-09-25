---
'plot': patch
---

The reconcile scan reports a plan at Delivered or Released whose `Issue:` field names a ticket the tracker still reports as open. Measured 2026-09-24: `a-gate-matches-an-invocation` released in 2.19.0 naming `Issue: #935`, and #935 was still open five days later — found by a sprint sweep cross-checking every open ticket against the plan estate, not by anything in Plot. Section 23 asks the tracker once with `issue-list` and tests membership per plan, so cost is constant in plan count. Membership means open and absence does not mean closed: the window is stated (`PLOT_ISSUE_LIMIT`, default 200) and a full window says what it may have missed, rather than printing `(none)` as if complete. A tracker that cannot be asked, a failed question, and a Jira tracker whose keys cannot match a parsed number each print `(not evaluated — …)` with the reason. It reports and never gates — a tracker is a copy of Plot's state, so an open ticket must not stop a delivery — and it names a decision rather than a repair, because Plot closes no ticket.

<!--
plan: docs/plans/2026-09-24-a-released-plan-tells-its-tracker.md
bumps:
  skills:
    plot-reconcile: patch
-->
