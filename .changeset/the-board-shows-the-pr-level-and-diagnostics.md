---
"@plot-pm/board": patch
---

The PR status banner now reads the domain's `prStatus` classification instead of splicing `plot-host`'s raw stderr into the sentence. The banner states a level and a cause in one line; `plot-host`'s own notices (`ignores --limit`, `page complete`) move into a "Show details" disclosure instead of the sentence. A banner is absent when the level is `info`, even if the last call reported an error, and a stale cache with no active refusal now shows as "PR data stale" rather than "PR data unavailable" — "unavailable" is reserved for a board that has no PR data at all.

<!--
plan: docs/plans/2026-10-23-info-vs-warning-vs-error-and.md
bumps:
  skills:
    plot: patch
-->
