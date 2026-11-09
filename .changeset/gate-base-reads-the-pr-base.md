---
'plot': patch
---

The shell-line, decision-count and sprint-member gates compare a pull request with the branch it targets, so a slice PR into a sprint branch is measured against that sprint branch and not against main. The bundle-diff gate compares every pull request with its merge base against main, as the commit-time gate does, so a merge of main into a sprint branch with main's bundles passes it.

<!--
plan: docs/plans/2026-11-09-sprint-prs-run-ci.md
-->
