---
'plot': patch
---

The release gate now labels a plan-less Must, Should or Could Have by its tracker key — scoped to the repository's declared `Ticket prefixes` — instead of a bare Jira-shaped token that could match unrelated text, and `openShoulds`/`openCoulds` no longer report an empty string for a plan-less item. Richer resolution from a plan's `Issue:` line or `ticket:` frontmatter stays out of scope for this wire; `release-gate.ts` only has the item's own text to match against.

<!--
plan: docs/plans/2026-10-22-release-gate-labels-must-haves-by.md
bumps:
  skills:
    plot: patch
-->
