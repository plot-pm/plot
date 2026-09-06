---
'plot': patch
---

Four files stop stating a state their schema rejects. Three stories carried `status: archived` and one sprint carried `Phase: Planned`; `StoryStatusSchema` admits `draft ready active in-review paused done` and `SprintStateSchema` admits `Planning Committed Active Closed`, so neither value parsed.

The stories are archived through `archiveStory`, which decides the status and the `archived:` date together. Editing the status word alone would have produced the half-archived story `plot-story-lint.sh` reports as S3 — one invalid state swapped for three lint findings. The date recorded is 2026-09-04, the day the archival was first asserted, because `archiveStory` refuses to replace the day knowledge was closed with today's.

All three are archived in fact — 6 of 6, 15 of 15 and 1 of 1 plans Released — so `derivedStanding` agrees with what the files assert.

`archived` stays derived and no schema changes. What changes is that four files stop asserting by hand what the board computes.

<!--
plan: docs/plans/2026-09-06-a-stated-state-is-one-the-domain-admits.md
-->
