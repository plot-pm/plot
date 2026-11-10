---
'plot': patch
---

A pull request run skips `corpus`, `macos-shell-contract`, `helper-contracts`, `board-integration` and the process census when an earlier run of the same pull request passed them on the same base and the push changes none of their inputs. `select` names the source run, its head SHA and conclusion for each reused job, and the reason each other job runs; `validate` accepts a reused job only with a `reused:<40 hex>` value. A push to `main`, a dispatched run, the release pull request and a re-run reuse nothing.

<!--
plan: docs/plans/2026-11-09-ci-reuses-green-runs.md
-->
