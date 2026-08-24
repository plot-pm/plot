---
"@plot-pm/board": patch
---

Render a wave row as a wave row in every section, WORKING included

A row whose `kind` is `wave` rendered through the wave row in NOT STARTED — its
name leading slot 3 — but as a branch row in WORKING, where the branch took slot
3 and the wave's name was demoted to a badge. One function decided two
questions: `waveGroupsFor` skips grouping in WORKING on purpose (it orders by
agent and must not bury unrelated waves under plan heads), but `ungroupedRows` —
its complement — rendered everything it returned as a branch `<Row>`.

Skipping the group no longer skips the row's kind: an ungrouped `kind: 'wave'`
row now renders through `WaveRow` as a wave of one, so the same wave reads the
same way in every section. WORKING keeps its agent ordering and shows no plan
heads; the worker facts (`worker running (pid …)`, the live-worker status, the
activity dot) survive on the wave row. Because a WORKING wave now carries
`data-wave-row`, the *blocked by* jump has a wave list to descend from there —
the sibling `Found` wave builds on this.
