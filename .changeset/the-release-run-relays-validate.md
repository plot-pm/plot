---
'plot': patch
---

The `relay-validate` job in `release.yml` replaces the `release-validate-relay.yml` workflow, which GitHub never started because `dispatch-ci` dispatches with `GITHUB_TOKEN`. The job waits for the `validate` job of the dispatched `CI` run on the release PR's pinned head and copies its `success` or `failure` to a `validate` commit status, so a failure in a job that `validate` does not need, such as `macos-shell-contract`, does not block the release PR. It writes nothing for a cancelled job or a run on any other head, retries each API call 3 times, and fails the release run when it finds no run, two runs, or no `validate` result inside 50 minutes. The `Release` concurrency group now holds only the `release` and `board-release-candidate` jobs, so the relay's wait does not hold a pending publish run in the queue.

<!--
plan: docs/plans/2026-11-03-the-release-head-reports-validate-with.md
-->
