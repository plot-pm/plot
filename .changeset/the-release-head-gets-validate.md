---
'plot': patch
---

A `workflow_run` workflow, `release-validate-relay.yml`, copies a completed dispatched `CI` run's `success` or `failure` to a `validate` commit status on the release PR's head, so the release PR counts `validate` with no person approving the held `pull_request` run. It writes nothing for a cancelled run or a head that is not the current head of `changeset-release/main`.

<!--
plan: docs/plans/2026-11-03-the-release-head-reports-validate-with.md
-->
