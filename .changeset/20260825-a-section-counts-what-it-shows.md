---
"@plot-pm/board": patch
---

board: a section header counts what it shows

A grouped section renders plan heads, each folded with its own wave count, so
`DONE (19)` sat above ten visible heads — the header counting waves while the
reader counted plans, a mismatch no test caught because none compared a
control's number against the section beneath it.

`sectionTally` now derives both figures the way the component renders, group by
group: `plans` is the visible-line count (a plan head where the group folds, its
own rows where it does not), `waves` the scope a reader reaches by expanding
every head. Where the two agree — an ungrouped or empty section — the header
renders one number, so `QUIET (0)` never grows into `QUIET (0 plans · 0 waves)`.
Where they differ it names both and says which: `DONE (10 plans · 19 waves)`.

WORKING is left as #403 made it: it renders the registry, one row per agent, and
its number stays `agents.length`.
