---
'@plot-pm/board': minor
---

The tests select a Slice. Every `data-wave-*` attribute becomes `data-slice-*` — fifteen names, 138 occurrences — together with every selector that grips it, in one commit. Five source files write the attributes and 21 test files select on them; the post-rename census matches the pre-rename one name for name, and no `data-slice*` attribute existed before.

The two halves cannot land apart. A renamed attribute with an un-renamed selector produces a test that finds nothing and passes: `querySelectorAll` returning an empty list is not an error, so `count()` returns 0 and every negative assertion in the suite goes green.

So the guard is a count, not a match. `countSliceRows` in `helpers.mjs` asserts that a fixture known to render N rows still yields N, and two assertions bind the two sites that write `data-slice-row`: `one-row-per-kind` yields `RowKindSchema.options.length` agent rows carrying the slice hook, `a-plan-in-waves` yields 2 rows through `SliceRow` itself. Verified 2026-09-03 by breaking each site alone — each turns exactly its own assertion red with `expected +0`.
