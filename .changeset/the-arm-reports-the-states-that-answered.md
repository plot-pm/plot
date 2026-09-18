---
'plot': patch
---

A Bitbucket `pr-list` that reaches some host states and not others now reports the PRs it has rather than answering as a total outage. `bb pr list` has no `all` state, so the arm asks once per state; a later state failing used to discard the rows the earlier ones had already printed, and a repository with three open PRs showed nine branches as having no PR at all. The partial answer carries its own exit code, the transport keeps the rows beside the sentence naming what is missing, and the fleet scan reports the reading as incomplete rather than as whole or as failed.

<!--
plan: docs/plans/2026-09-18-a-partial-page-is-not-an-outage.md
bumps:
  skills:
    plot: patch
-->
