---
"@plot-pm/board": patch
---

Test: the blocked-by jump finds a blocker in WORKING

The *blocked by* ⓘ now finds a blocker that is being worked on right now.
Wave #392 ("a wave renders as a wave row in every section") rendered
WORKING waves through `WaveRow`, which carries `data-wave-row` and sits
inside a `data-wave-list` wrapper. This wave adds the test proving the
`Spoken` → `Named` case works: clicking ⓘ on a blocked wave scrolls to
and flashes the blocker in WORKING, the section a blocker is most often in.

<!--
bumps:
  board: patch
-->
