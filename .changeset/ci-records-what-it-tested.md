---
'plot': patch
---

A pull request's CI run now uploads an artifact `ci-inputs-<base>-<head>` from `select`: the base SHA and head SHA of the merge it tested, the paths the merge changed, and the selection outputs, kept 7 days. The upload never changes a job's result.

<!--
plan: docs/plans/2026-11-09-ci-reuses-green-runs.md
-->
