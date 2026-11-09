---
'@plot-pm/board': patch
---

The domain gains `objectsBatch`, a reader that answers object reads through one long-lived `git cat-file --batch-command` per repository, with a 10 s bound per request; a process that stops answering is replaced and its reads fail. Nothing installs the reader yet.

<!--
plan: docs/plans/2026-11-09-one-cat-file-batch.md
-->
