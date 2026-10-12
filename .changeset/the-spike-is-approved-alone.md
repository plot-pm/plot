---
'plot': minor
---

`plot-approve.mjs --spike <slug> --who <handle>` and `POST /api/approve {"slug":"<slug>","spike":true}` approve a Design plan's one `<!-- spike -->` branch alone. The command records `Spike approved: <date>, <who>, <channel>`, merges the plan PR pinned to the reviewed head, clears the spike branch's hold and leaves the plan in Design. A person named in `People` approves on every review channel. The state gate refuses a commit that adds, changes or removes the record without the receipt filed under `<plan path>#Spike approved`, and the board shows an Approve spike button on a card whose spike is approvable.

<!--
plan: docs/plans/2026-10-12-design-work-proves-the-path.md
bumps:
  skills:
    plot: minor
    plot-approve: minor
-->
