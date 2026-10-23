---
'plot': patch
---

Adds `prStatus` and `prStatusLevel` to `@plot-pm/domain` (`packages/domain/src/rules/pr-status.ts`): a pure decision for the PR footer's severity (info/warning/error), cause and backoff end, with `plot-host`'s own notices (`ignores --limit`, `page complete`) split out from the failure text via `extractHostNotices` rather than folded into it.

<!--
plan: docs/plans/2026-10-23-info-vs-warning-vs-error-and.md
bumps:
  skills:
    plot: patch
-->
