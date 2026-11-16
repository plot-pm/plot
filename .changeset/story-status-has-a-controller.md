---
'plot': minor
---

A story's front-matter `status:` has a controller: `plot-story-status.mjs [--who <name>] <slug> <status>` and the board's `POST /api/story-status {"slug","status"}` ask the domain's `setStoryStatus`, write only `status:` (and `archived:` on a move to `done`), and push to the default branch. Each refusal prints its name and reason and writes nothing; the move refuses under `PLOT_UNATTENDED=1`, and the controller gate refuses an HTTP `POST /api/story-status` from a shell.

<!--
bumps:
  skills:
    plot: minor
-->
