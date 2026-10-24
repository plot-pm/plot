---
'plot': patch
---

Bitbucket `pr-state` no longer asks Jenkins by default. A caller now opts in with `--with-checks`, the merge re-read (`pr-merge --match-head`) never asks, and a `--state all` pass binds Jenkins once across open/merged/declined rows rather than once per state. A named row whose Jenkins ask breaks mid-pass reads `checks: unknown` with `checksLookup: 'broken'`, distinct from a row the cap left unnamed (`'skipped'`).

<!--
plan: docs/plans/2026-10-24-bitbucket-pr-rows-run-per-row.md
bumps:
  skills:
    plot: patch
-->
