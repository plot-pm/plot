---
"plot": patch
---

The sprint status step's Jira Release drift table now reports every non-empty finding instead of only the first match: `missingFromRelease`, `missingFromSprint` and `notCompared` are three independent lists on one verdict, so a sprint with both a Must-have the Release lacks and a different Must-have naming no key at all now prints both warnings rather than silently dropping the second. The owner-check call at the top of the skill now goes through `plot-sprint-release-gate.sh` instead of calling the bundle directly, so a missing or stale bundle fails with the launcher's own message rather than a raw Node stack trace. The sprint-gate eval gains two cases covering `Sprint owner: plot` overriding an external `Tracker`, and a non-`plot` `Sprint owner` value deciding nothing, mirroring `issue-source.test.ts`'s existing domain coverage.

<!--
plan: docs/plans/2026-10-24-sprint-release-gate-and-sprint-readers.md
bumps:
  skills:
    plot-sprint: patch
-->
