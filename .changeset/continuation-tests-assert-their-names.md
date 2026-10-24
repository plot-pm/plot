---
"@plot-pm/board": patch
"@plot-pm/domain": patch
"@plot-pm/fleet": patch
---

Continuation tests now assert the specific refusal or ending reason their name states, rather than bare truthiness, and new coverage closes three gaps: an unreadable `.plot-worker.ending.json` refuses `no-manifest` on `/api/continue`, `continueTarget` accepts a `write` fallback for the `spend-limit`, `run-limit` and `checks-unanswered` endings, and `correctionHasContinuation` is proven to skip an identical second answer within one slice rather than only its file-read mechanics.

<!--
plan: docs/plans/2026-10-24-a-desk-continuation-skips-its-run.md
-->
