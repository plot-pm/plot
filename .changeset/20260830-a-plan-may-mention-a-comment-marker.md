---
'plot': patch
---

A plan may print an HTML comment marker without the parser swallowing the rest of the file.

`plot-plan-meta.sh` read a comment-open marker as syntax wherever it appeared,
including inside inline code and fenced blocks. Such a line carries no closing
marker, so the parser consumed everything after it: the plan came back
`format: none`, with no phase, no type and no branches.

Two changes, one rule each. The fence toggle now runs **before** the comment
rules, so a fenced example is illustration rather than contract — the standing
rule the `## Waves` and `## Branches` headings already follow. And `mask_code()`
blanks backtick-delimited spans before the comment-open test, so a marker printed
as a literal is data. The raw line is untouched everywhere else, because branch
names live in backticks too.

A genuine multi-line comment is still skipped, placeholders still count as
absent, and a fence marker inside a real comment no longer toggles fence state.

**Measured against the whole plan estate, 2026-08-30:** 181 of 182 files in
`docs/plans/` parse identically. The one that changes is
`two-monitors-watch-the-agent`, which prints the marker inside backticks at line
1014 — the old parser ate the remaining 39 lines of its `## Slices` section,
including a heading. That file gaining a section **is** the fix.

<!--
bumps:
  skills:
    plot: patch
-->
