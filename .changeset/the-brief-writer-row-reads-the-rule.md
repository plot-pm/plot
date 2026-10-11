---
'@plot-pm/board': patch
---

The agent row field `briefWriting` is now `briefWriter`, so it no longer shares a name with the `briefWriting` helper, and its schema enum derives from the domain's `BRIEF_WRITER_STATES`. A new domain rule, `briefWriterNote`, decides the row's brief note and its age from `briefWriter`; the renderer only formats it. A running brief writer's note shows the age of its ask (`the brief writer has been working for 42s`). A run's `running` marker records its process start time, every reader parses the marker through one `parseRunMarker`, and on Linux a live pid that started more than 5 s after the record reads as failed.

<!--
plan: docs/plans/2026-10-10-the-channel-closes-its-review-findings.md
-->
