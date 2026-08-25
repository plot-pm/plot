---
"@plot-pm/board": patch
---

board: a busy worker names its wave

A running worker's row now names its wave, joined from `fleet.waves` even when
no branch row exists. Previously the unjoined shape (a scratch branch, `main`,
or an unlisted branch) had no wave link — the wave arrived only through the
branch row's `row.wave` field.

Silent where the branch belongs to no wave: a `main` worker or a scratch branch
has no wave to name, and `(unnamed)` is filtered out as noise — the same rule
`waveLabel` applies to a branch's wave badge.

Wave Named from plan `the-working-section-shows-every-worker`.

<!--
bumps:
  skills:
    plot: patch
-->
