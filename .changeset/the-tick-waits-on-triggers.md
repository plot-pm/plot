---
'@plot-pm/board': patch
---

fleetd now waits between supervision ticks on a trigger or on the next deadline a tick-owned rule holds, and no longer on `--interval`. A scan that drained a pending set starts a tick, as does a full read that finds a change no trigger named and a clock jump; a registry, desk-files or worker-gone change enters the pending set, and a `PLOT-BLOCKED.md` write is a desk-files change. The deadlines are a desk question's next escalation rung, a slice going idle, an agent's `Worker bound` from its start, an unheld claim passing its 60 s age, a launch leaving its grace or its pid bound, and a red default-branch hold ending `Checks wait` after the last answer; each strict rule's deadline lies 1 ms past its bound. `--interval` ends the wait while a watch is degraded, read again on every scan beat, after a tick that threw or did not complete, and in place of a deadline where the clock does not answer. The tick's host spend is priced over the time since its calls were last counted.

<!--
plan: docs/plans/2026-11-10-triggers-replace-the-tick.md
bumps:
  skills:
    plot: patch
-->
