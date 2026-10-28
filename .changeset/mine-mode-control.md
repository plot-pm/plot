---
'plot': patch
---

The six raw `isMine`/`mineOnly` call sites (`mine-filter.ts`, `lanes-for-reader.ts`, `chip-row.ts`) and every raw-flag reader in `AgentList.tsx` and `App.tsx` now read `mineMode()` instead of a boolean, so the stricter «mine» mode reaches every place the lenient one did. A new storage key, `plot-board:agents:mine-strict`, persists the strict toggle beside the existing `mine-only` key, read and written with the same silent-failure discipline. `mineChip`'s `hiddenCount`/label and the widened `MineChipReadings` now also count registry agents with no desk on this machine, not only rows; a matching hide/show-unknown control sits beside the Delivery chip (visible only in `mine-and-unknown`/`mine` with a non-zero unknown count) and beside the Planning/Discovery «Only my work» header checkbox, fed by `boardForReader`'s and `lanesForReader`'s own hidden counts, and disabled the same way the chip already was when `comparableLogin(reader)` is empty. `ticketsForReader` keeps its lenient `isMine` check in every mode except `all` — the plan's "the box wins" exemption — so *Waiting on you* does not shrink when «mine» tightens everywhere else. `isMine` and `isMineStrict` themselves are unchanged; removing `isMine` is wave 4's job.

<!--
plan: docs/plans/2026-10-28-mine-hides-rows-with-no-known.md
bumps:
-->
