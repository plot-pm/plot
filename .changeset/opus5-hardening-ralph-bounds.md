---
"plot": minor
---

`ralph-plot-sprint` is now bounded. The runner gains a whole-run wall-clock budget, a per-iteration deliverable checkpoint verified from git rather than from the agent's own report, a ship-partial fallback that fires while there is still time to land work, and a heartbeat file so a silent run is detectable from outside.

Two optional `## Plot Config` keys with documented defaults: `Sprint wall clock` (default `8h`) and `Sprint stall limit` (default `3`). Both accept an environment override (`RALPH_SPRINT_WALL_CLOCK`, `RALPH_SPRINT_STALL_LIMIT`) and `0` to disable. A project that sets neither behaves as before, except that a run can no longer grind or go silent indefinitely.

An iteration that emits no promise signal now counts toward the stall limit instead of logging a warning and continuing — silence is a failure signal, not a continuation.

<!--
bumps:
  skills:
    ralph-plot-sprint: minor
-->
