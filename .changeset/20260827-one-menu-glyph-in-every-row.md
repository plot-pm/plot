---
'@plot-pm/board': patch
---

The broken-agent row's menu uses the same `⋯` trigger and the same panel as
every other row's menu.

It drew its own SVG of three circles while the other four menus in `menus.tsx`
used the `⋯` glyph, and its panel diverged on five properties —
`min-w-[160px]` vs `min-w-max`, `rounded` vs `rounded-md`, `py-1` vs `p-1`, and
`dark:bg-slate-800` vs `dark:bg-slate-900`. Each difference is small; together
they read as a different KIND of control, in the one row where a reader is
already unsure what is wrong.

Reported by an operator: *"why do we use a new type of menu for these broken
workers"*. A menu is a menu — the row says what is exceptional, the trigger says
only that there are acts here.
