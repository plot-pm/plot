---
'plot': patch
---

`plot-fleetctl.sh --stop` and `--status` refuse, with exit 3, when run from a linked worktree that is neither the main checkout nor a desk under its desk root. The refusal names the invoking worktree and the estate it would have reached, and nothing is enumerated or signalled. Run from the main checkout or from one of its desks, both verbs behave as before.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
