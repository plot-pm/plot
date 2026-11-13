---
'plot': patch
---

A story served from fleetd's snapshot counts the plans its plan table lists that have no plan file, as a board that reads the files does. `StoryRecord` gains `tablePlans`, which fleetd fills with `storyPlanTableSlugs` over the story file it reads, so `SNAPSHOT_PROTOCOL` is 5, and a board and a fleetd of different builds fall back to the board's own reads until both run the same build.

<!--
bumps:
  skills:
    plot: patch
-->
