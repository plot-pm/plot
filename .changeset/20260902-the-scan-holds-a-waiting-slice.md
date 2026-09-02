---
'plot': minor
---

The fleet scan holds a slice whose prerequisite has not merged. A branch's `waits:` annotation names a prerequisite branch, and the scan reports two new branch counters beside the wave ones: `waiting=` where the prerequisite exists and has not merged, and `prereq_missing=` where the host has never seen a PR for it. The first resolves by waiting and the second by editing the plan, so they travel separately rather than as one number. Silence is never permission to start.

<!--
bumps:
  skills:
    plot: minor
-->
