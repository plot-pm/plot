---
'plot': patch
---

The branch-section sed ranges read the same on BSD and GNU sed. `\|`
alternation is a GNU BRE extension: BSD sed reads it as a literal pipe, so on
macOS `plot-deliver.sh` and `plot-impl-status.sh` extracted an EMPTY branch
list from every plan, and `plot-dispatch.sh` never saw `autoDispatch: true`.
The delivery gate that refuses a plan with unmerged branches reads "no unmerged
branches" from that emptiness and passes — the same silent failure
`deliver-headings.test.mjs` was written for on 2026-08-30, arriving by a
different route. CI runs GNU sed and stayed green throughout.

<!--
bumps:
  skills:
    plot-deliver: patch
    plot-dispatch: patch
-->
