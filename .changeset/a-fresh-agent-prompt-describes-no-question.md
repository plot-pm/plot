---
'plot': patch
---

A fresh continuation's prompt — after a turn limit, spent corrections, or holding-work, with no `PLOT-BLOCKED` marker ever written — no longer tells the new worker that "a previous worker... stopped to ask a question" or that a "blocked marker... is still in this tree... yours to delete" (#1843, #1389, #1386). `composeContinuation` now branches both the opening and closing paragraphs on whether a question was actually asked, matching the body text's existing branch. Separately, `worker-loop.ts`'s read of the agent's own `PLOT-BLOCKED.md` now distinguishes a marker file that exists but is empty from no marker at all — both used to read as an empty string, so an empty marker fell through to a holding-work ending instead of a blocked one.

<!--
plan: docs/plans/2026-10-17-desk-markers-and-the-reaper.md
bumps:
  skills:
    plot: patch
-->
