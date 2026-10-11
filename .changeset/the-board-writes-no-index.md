---
'plot': patch
---

`refreshPrs` takes its PR-index store as a required parameter, so no board caller reaches the real file by omission. The fleet bridges its last PR-read failure as `prError` on `BridgedPulse`, and the board shows it in owned mode; a board that finds no index to serve reports that instead of a healthy reader. An owned refresh skips the release-version, unmerged-branch and worker-question reads while the bridge `at` is unchanged, and reads the supervisor on every tick, so a stopped fleet hands the scan back to the board at once. The tests that write the real PR index live in `packages/fleet`, and `one-pr-index-writer.test.ts` fails when a board source writes through `prIndexFile` or `prStoreFor`.

<!--
plan: docs/plans/2026-10-10-the-fleet-closes-its-review-findings.md
bumps:
  skills:
    plot-fleet: patch
-->
