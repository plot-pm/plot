---
'plot': patch
---

The process census gains its scenarios: an idle board with no tab, with a hidden page and with a visible page beside fleetd (S1 to S3), an idle fleetd pass on GitHub and Bitbucket fixtures (S4), one desk commit (S5), one PR whose CI turns green (S6), and the per-source rows P1 to P4. Each zero target is an `it.fails` row whose title names the plan and slice that turn it green. The fixtures put stub `gh`, `bb` and Jira `curl` on `PATH` and hold each desk with a stub worker on a FIFO, and a census entry runs fleetd's `run` on a clock it drives one pass at a time.

<!--
plan: docs/plans/2026-11-08-process-census-gate.md
-->
