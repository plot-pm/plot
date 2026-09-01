---
'@plot-pm/board': patch
---

A read route cannot reach a synchronous spawn, and a test fails the build when
one does.

The gate walks a CALL GRAPH from what `/api/board` and `/api/fleet` actually
call, not a list of files, and both halves of that matter. Three read-path files
keep a documented synchronous twin for the write routes that cannot await yet —
`board.ts:readConfig`, `registry.ts:readManifestDirConfig`,
`agent-log.ts:readWorktreeRoot` — so a per-file grep reddens files a later plan
owns, and it is a gate somebody turns off. It also passes on the guilty case:
`fleet-state.ts` holds no spawn and reaches 165 functions across fourteen
modules, any of which could gain one.

`await` is the boundary, and that is the measurement's definition rather than a
convenient one. `sample <pid> 5` found the defect BELOW the request handler, so
a spawn on a later tick is a different problem with a different blast radius. An
awaited call is still followed, because an async function runs synchronously to
its own first await — `fleet.ts:refresh` records that trap in its own comment.

Beside it, the behaviour the absence buys: `/` answered back to back with both
read routes IN FLIGHT, started and deliberately not awaited, because a board
with nothing to do is fast and that was never the question. Freshness is
asserted with it, and the two are load-bearing together — every latency
assertion gets faster if the board stops reading the estate, so a frozen
snapshot would pass them all and be worse than what this replaced.

**Measured 2026-09-01 with the same instrument that found the defect:**
`node::SyncProcessRunner::Spawn` holds **0 of 4012** main-thread samples, against
4258 of 4262 before. `ProcessWrap::Spawn` holds 139 — the calls moved to the
asynchronous path, they were not removed, which is what the plan asked for.

**The board is not much faster, and saying so is part of the result.**
`/api/board` reads 429–616 ms against ~770 ms, and most of that came from caches
shipped earlier. What changed by three orders of magnitude is what a second
request costs while the first runs: `/` went from timing out at 15 000 ms to
3–28 ms. That was always the defect.

**A finding, not fixed here:** with the spawns gone, `buildBoard`'s per-request
plan staging is the top of the profile — `WriteFileUtf8` 449, `RmSync` 445,
`MKDirpSync` 218 of 4012 samples, ~28 % of the main thread. Same defect class,
smaller instance, and its own change.
