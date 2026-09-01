## Implementation brief — the-read-path-stops-spawning (wave 2: Fleeting)

- **Plan (canonical):** `docs/plans/2026-08-31-the-read-path-stops-spawning.md` on `main`
- **Branch:** `feature/the-fleet-reads-through-the-port` (base: `main`)
- **Ends as:** one PR to `main`

**Second of four. Wave 1 (`board.ts`) merged as #580 and proves the pattern — read its diff before starting.**

### What to build

`fleet.ts`, `server-info.ts` and `agent-log.ts` read through the `Refs` port instead of spawning. The `/api/fleet` half of the read path.

### The measurement that licenses this

`sample <pid> 5` on a wedged board: **4258 of 4262 main-thread samples** under `node::SyncProcessRunner::Spawn`, below the request handler. A synchronous spawn cannot yield, so a static file timed out at 15 s beside it. That reading is what separated this from every "the board is slow" theory.

### The surface, measured 2026-09-01

| file | lines | `execFileSync` | spawns |
|---|---|---|---|
| `fleet.ts` | 5989 | **3** | `git` |
| `server-info.ts` | 137 | **3** | `git`, `bash plot-config.sh` |
| `agent-log.ts` | 345 | **2** | `bash plot-config.sh` |

**These call `execFileSync` DIRECTLY — there is no `git()` helper to replace.** `board.ts` had 13 call sites behind two helpers; here the spawns are inline, so each one is its own decision about which port answers it. Count them before planning the shape: 8 total, and `fleet.ts` is 5989 lines, so finding them is the first task rather than an assumption.

### What wave 1 already settled — do not re-derive

**The port exists and is async.** `packages/domain/src/ports/refs.ts`, twelve methods, `PortResult` returns. `refs-git.ts` implements it; `refs-fixture.ts` stands in for tests. Both are now covered (93%/100%) — extend them rather than writing a second adapter.

**`PortResult` does not swallow errors, and the old code did.** Translating a failure back to `''` at each call site preserves today's behaviour and throws away the reason. Decide per site whether an empty answer is legitimate, and say so where it is.

**The async ripple lands in the TESTS, not production.** Wave 1 needed one production change and cost 23 test failures across 5 files, every one a Promise read as its value: `f.rows` undefined rather than empty, `.sort is not a function`, a payload serialising as `'{}'`. **Expect the same here** and do not read a green production diff as done.

**A poll helper that takes a producer owns that producer's asyncness.** Wave 1's `until(read, want)` fixed every call site at once by awaiting its reader; a predicate handed a Promise answers false forever, so the poll times out and returns the Promise. Look for that shape before awaiting call sites one at a time.

**`tiny-garden.browser.test.ts` renders the shipped artifact.** Any `src/server` change fails it until `pnpm build:board` runs. That is a rebuild, not a regression.

### `buildFleet` is the ripple point

Wave 1 made it async (`fleet.ts:5832`) as collateral. Its callers and their tests are already awaited; this slice owns whatever else the remaining spawns force.

### Done when

- No read route's handler spawns a child process on the event loop from these three files.
- `/` answers in single-digit ms **while `/api/fleet` is in flight**, asserted back to back rather than on a timer.
- The fleet still shows a branch pushed since the last request — asserted, because the tempting wrong fix for latency is a cache that freezes content.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, `pnpm test`, changeset. Node 24 (`nvm use`), `corepack pnpm`.
- **Do not run `pnpm run test:e2e` locally** — it is CI's gate; it dispatched 53 concurrent node processes here and took the board down.

### Scope guard

These three files and what their signature changes force. `registry.ts` and `agent-panel.ts` are wave 3; the write routes (`idea.ts` 7 spawns, `deliver.ts` 3, `dispatch.ts` 3) are a later plan — they block only the operator who clicked, not every viewer.
