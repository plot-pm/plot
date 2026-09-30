---
'plot': patch
---

The worker monitor no longer publishes `idle` for a conversation that has not written yet. Past the quiet window it checks whether the worker's own transcript file (`<resumeId>.jsonl`, else `PLOT_SESSION_ID`) exists; where it does not, the verdict is `unspoken` and nothing is published, so a hop to a new branch is not ended on the previous slice's silence. The loop and the monitor share one handle (`session_handle`, now in `plot-agent-manifest.sh`) and one probe (`plot_transcript_exists`, now in `plot-transcript-quiet.sh`). A monitor started with no handle says so on stderr and judges the desk alone.

<!--
plan: docs/plans/2026-09-29-an-idle-reading-knows-the-conversation-started.md
bumps:
  skills:
    plot: patch
-->
