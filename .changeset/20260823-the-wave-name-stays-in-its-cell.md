---
'@plot-pm/board': patch
---

A regression lock pins that a long wave name stays inside its cell and never paints over the status column. Since `a-wave-is-one-row` the wave name is projected as an ordinary `plan` link and clipped by the shared `min-w-0 truncate` chain, so the overlap the board reported is already prevented — on both the fixed `12rem` name track and the `minmax(12rem,auto)` track `the-name-track-holds-the-name` introduces, and at viewports narrow enough that the links track has no slack left to absorb the name. The lock asserts the geometry (the name cell's box against the status cell's) rather than the rendered string, since a string that is merely shortened can still overlap, and that the full name is recoverable on hover.
