---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

`@plot-pm/domain` no longer exports `isMine`. Its lenient `ownership(row, reader) !== 'theirs'` test is now inlined at each of its former call sites — `mine-filter.ts`'s five `mode === 'mine' ? isMineStrict : …` sites in `@plot-pm/board` and `lanes-for-reader.ts`'s own in `@plot-pm/domain` — rather than re-exported under a new name. `isMineStrict` is unchanged. No behaviour changes: every mode still keeps or hides the same rows it did before.

<!--
plan: docs/plans/2026-10-28-mine-hides-rows-with-no-known.md
bumps:
  skills:
    plot: patch
-->
