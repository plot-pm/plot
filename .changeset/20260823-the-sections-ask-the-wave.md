---
'@plot-pm/board': minor
---

board: the sections ask the wave for their membership

`waveGroupsFor` was a computation: four grouping sections each re-derived which
section a wave belongs in from a row's `state`, three of them spelling the
identical predicate `r.state !== 'merged'` and DONE its inverse. That is one of
the five derivations `the-wave-is-a-thing-the-board-can-hold` exists to end — a
wave the server calls done but holding a not-yet-merged row, or a not-started
wave with one stray merged branch (`Inverted`), was placed by the row's own
state and disagreed with the wave.

`waveGroupsFor` and `ungroupedRows` now take the server-derived `Wave[]` (added
in `the-contract-carries-a-wave`) and select a section's waves by the wave's own
`section`: DONE claims a wave iff `Wave.section === 'done'`, the grouping
sections iff it is not. The real distinction — done versus not-done — moves onto
the wave; WORKING and WAITING ON A MACHINE stay excluded by the grammar
(an agent works and a build runs; neither is a wave).

The client CASTS the fleet payload, so `fleet.waves` is `undefined` on a pulse
from a server predating the wave field — a Zod `.default([])` never fires on a
cast. An absent wave list, or a wave a partial pulse has not carried yet, falls
back to the old row-state predicate byte-for-byte, so a pre-wave board renders
exactly as before rather than dropping every wave.
