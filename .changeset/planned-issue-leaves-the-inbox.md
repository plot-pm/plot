---
'plot': minor
---

An issue named by a Draft plan PR's `Issue:` field now leaves the board's unplanned inbox, and *Waiting on you* no longer lists any issue a plan references. The inbox reads the plans on open `idea/` branches at their refs as well as the plan directory, and `waitingOf` filters its rows and inbox by the referenced set. No tracker label is read.

<!--
plan: docs/plans/2026-10-17-a-planned-issue-shows-its-plan.md
bumps:
  skills:
    plot: minor
-->
