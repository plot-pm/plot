---
'plot': patch
---

The `relay-validate` job in `release.yml` waits for the dispatched `CI` run on the release PR's pinned head and copies its `success` or `failure` to a `validate` commit status written with `GITHUB_TOKEN`, so the release PR counts `validate` with no person approving the held `pull_request` run. It writes nothing for a cancelled run or a run on any other head, and fails the release run when it finds no run, two runs, or no result inside 33 minutes.

<!--
plan: docs/plans/2026-11-03-the-release-head-reports-validate-with.md
-->
