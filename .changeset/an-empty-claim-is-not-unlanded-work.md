---
'plot': patch
---

A worker-less checkout holding only a `plot: claim ...` marker, pushed and then left with no `@{upstream}` once its remote ref was deleted, now yields its branch instead of keeping it forever. The `unpushed` reading is measured against `origin/<default>` and excludes only commits proven to be empty claim markers; any commit that changes a file, whatever its subject, still keeps the checkout.

<!--
plan: docs/plans/2026-10-03-every-desk-state-has-an-exit.md
bumps:
  skills:
    plot: patch
-->
