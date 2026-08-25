---
"@plot-pm/board": patch
---

board: a filtered section says what it hid

A section that says `(3)` while hiding 5 looks complete when it is not — a
reader who has forgotten the toggle is on sees an empty estate and no reason
for it. The spec says a filtered section must say what it withheld.

Each section now reports how many rows the filter withheld when any are hidden:
`DONE (10 plans · 19 waves) — 23 hidden by Sprint only`. Where genuinely nothing
exists, the section still says `none` — `0 hidden` never appears on an unfiltered
section, so the two cases stay distinguishable.

The hidden count is computed per section by comparing the filtered rows against
the unfiltered rows, only when the sprint filter is active. When no filter
applies, `unfilteredSectionedRows === sectionedRows` by construction, so
`hiddenCount` is zero and the suffix does not render.
