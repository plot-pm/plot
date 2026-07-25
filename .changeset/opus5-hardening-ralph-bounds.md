---
"plot": minor
---

`ralph-plot-sprint` is now bounded. The runner gains a whole-run wall-clock budget, a per-iteration deliverable checkpoint verified from git rather than from the agent's own report, a ship-partial fallback that fires while there is still time to land work, and a heartbeat file so a silent run is detectable from outside.

Five optional `## Plot Config` keys with documented defaults: `Sprint max iterations` (`20`), `Sprint deadline` (`8h`), `Sprint heartbeat interval` (`5m`), `Sprint stall limit` (`3`), and `Sprint on budget exhausted` (`ship_partial | fail`). Each accepts an environment override (`RALPH_SPRINT_MAX_ITERATIONS`, `RALPH_SPRINT_DEADLINE`, `RALPH_SPRINT_HEARTBEAT_INTERVAL`, `RALPH_SPRINT_STALL_LIMIT`, `RALPH_SPRINT_ON_BUDGET_EXHAUSTED`); the four numeric ones accept `0` to disable. A project that sets none behaves as before, except that a run can no longer grind or go silent indefinitely.

`Sprint on budget exhausted` is the behavioural contract: `ship_partial` lands in-flight work, writes a handover and exits 0; `fail` exits non-zero for CI. An unrecognised value coerces to `ship_partial` with a warning on stderr.

An iteration that emits no promise signal now counts toward the stall limit instead of logging a warning and continuing — silence is a failure signal, not a continuation.

The budget is expressed as a config surface rather than prose: five keys, one an enum (`Sprint on budget exhausted: ship_partial | fail`) validated at startup, which decides whether a budget boundary exits 0 or non-zero. The deliverable is judged against `deliverable-rubric.md` by the runner and a verifier agent — the agent no longer self-reports completion.

Deletion pass: Common Mistakes rows that echoed adjacent CRITICAL rules (one now obsolete), the Step 0 subagent prompt block, both inline GraphQL query bodies, and the DoD grep examples — 309 words. This skill still nets +349 including the new rubric file; it is the one branch in this plan that legitimately adds more than it removes.

<!--
bumps:
  skills:
    ralph-plot-sprint: minor
-->
