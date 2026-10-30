---
'plot': minor
---

fleetd starts the fixer role on a desk's own PR when the review arm reports a HIGH finding on the current head, or when CI is red and the desk is dead or its corrections are spent — writing the attempt first, taking the desk's continue lock, and re-asking the host for the PR's state before it starts.

<!--
plan: docs/plans/2026-10-29-a-high-finding-is-fixed-before.md
bumps:
  skills:
    plot: minor
-->
