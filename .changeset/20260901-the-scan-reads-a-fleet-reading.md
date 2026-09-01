---
'@plot-pm/board': patch
---

`FleetPulse` becomes `FleetReading` across the estate, and the `--stream` protocol's terminal line becomes `{"kind":"reading",…}` with it. The board's `FleetScanLineSchema` literal, the scan's own `printf` and the derived-state tests all move together, so the contract is unchanged — a consumer that sees no terminal line still reads the scan as unfinished, which is what `fleet.ts` throws on. Only the word moved: a reading is what a scan produces at a moment, while the pulse is the clock that asks for one, and `the-pulse-is-an-entity` needs that word free for the thing every poller subscribes to.
