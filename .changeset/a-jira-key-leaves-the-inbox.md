---
"@plot-pm/board": patch
---

Added regression coverage proving a Jira-keyed ticket an Approved plan names (`Issue: EWZKUS-3893`) already leaves the unplanned inbox and shows its phase in Waiting on you, end to end through the real `plot-config.sh` and `plot-plan-meta.sh` — including several keys on one `Issue:` line, a key whose prefix is not in `Ticket prefixes`, a Draft plan PR's Jira key, and a decision test for a lowercase key, which the parser refuses on purpose. Every existing test exercising this path stubbed `Tracker` to answer empty, so the Jira key-extraction branch had never been run by an automated test before. No production code changed: the mechanism was already correct.

<!--
plan: docs/plans/2026-10-23-jira-ticket-stays-in-the-inbox.md
bumps:
  skills:
    plot: patch
-->
