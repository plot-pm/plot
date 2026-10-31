---
'plot': minor
---

fleetd drives a red default branch through its re-run, claim, repair and review steps: it re-runs the first red commit's failed jobs once per episode through the new `plot-host.sh rerun-failed` operation, claims `bug/main-repair-<12 hex of the last green SHA>` with an empty claim commit before it creates a desk, starts the `main-repair` role in that desk, and records its fix PR on the repair record, so the auto-review pass reviews that PR once its CI is green. Each episode gets one repair attempt: a lost claim or an ended run starts no second run, and a run that crashed with no ending record resumes once. The new `Main repair bound` config key sets the repair attempt's time limit in seconds and defaults to 3600.

<!--
plan: docs/plans/2026-10-29-a-red-default-branch-is-repaired.md
bumps:
  skills:
    plot: minor
-->
