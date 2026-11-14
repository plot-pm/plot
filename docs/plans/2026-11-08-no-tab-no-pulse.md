# A board that no visible tab shows starts no process

> The board stops its 5 s pulse when no SSE client is attached, and the page closes its SSE stream and stops its polls while hidden. An idle board with no visible tab and no fleetd starts zero processes.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** nothing-runs
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3238 merged
- **Delivered:** 2026-11-08
- **Released:** 2026-11-11, v2.32.0

## Changelog

- A board that no visible browser tab shows starts no process. It stops its background refresh when the last tab closes or hides, and refreshes once when a tab opens or returns. A plain request such as `plot-board --status` gets one fresh read and does not keep the refresh running.

Board impact: the board server and page change; `board-server.mjs` rebuilds on `main`. The plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

On 2026-11-05 a 30-second sample counted about 75 direct children under the plot repository's board while nobody looked at it: 40 `git`, 8 × `git rev-parse --show-toplevel`, 4 × `plot-fleetctl.sh --status`, `plot-host.sh backend`, ref listings and per-desk worker-state probes. Across three repositories the boards and fleetds started about 225 processes per second, and `syspolicyd` checked each one at about 80 % CPU. The board does no work; it helps a person orient. With nobody looking it has no reason to cost the machine anything (story, Why Now).

The cause is one timer. `ensureCache` (`packages/board/src/server/fleet.ts:3178`) starts `startPulse(clockSystem(), REFRESH_MS)` at `:3232`, with `REFRESH_MS = 5_000` (`:178`), on the first request, and nothing in the server stops it: `stopFleetRefresh` (`:3392`) is for tests, and `pauseFleetRefresh` (`:3386`) is for a test that counts processes. The pulse drives two subscribers, the fleet scan (`refresh`) and the PR reader (`maybeRefreshPrs`), and every PR beat writes the board's reader-lock heartbeat (`:2755`), so a `plot-pr-reader.mjs` the board started keeps running as long as the board does. It is the only timer in `packages/board/src/server` that starts processes.

The page keeps the server watched. `openSharedEventSource` (`packages/board/src/app/lib/event-listener.ts:40-70`) shares one `EventSource` across a browser's tabs through a Web Lock and keeps it while a tab is hidden. `App.tsx` polls `/api/board` every 30 s (`POLL_MS`, `:50`, interval at `:541`) whatever the visibility, and `/api/fleet` every 4 s (`FLEET_POLL_MS`, `:51`, interval at `:555`) while the delivery tab is open, also when hidden. A forgotten tab keeps the board watched all night.

## Design

This plan depends on `process-census-gate`. It turns two of that plan's `it.fails` rows into required passes: slice *Server pulse* turns **S1** (idle board, no SSE client, no fleetd: 0 `execve` per minute), and slice *Hidden page* turns **S2** (idle board, one page that turns hidden, no fleetd: 0 `execve` per minute after the hide). S3 (one visible tab with fleetd running) stays expected-failing until Phase 4.

### Approach

**A shown tab is a visible SSE client** (story Decisions, 2026-11-05). The board counts clients on `GET /api/events` through `EventHub.clients()` (`packages/board/src/server/channel-events.ts:39`), and the hub is created once in `packages/board/src/server/index.ts:120`.

**Slice 1: the server runs its pulse only while a client is attached.**

- `startEventHub` takes an `onClients(count)` option and calls it on every attach and every detach. `index.ts` passes a function that tells the fleet cache.
- Whether the pulse runs is a domain rule: `pulseWanted({ clients })` in `packages/domain/src/rules/board-watch.ts`, an arrow function that answers `true` while `clients > 0`. It takes the reading as a value and imports no port.
- `ensureCache` no longer starts the pulse on its own. `fleet.ts` exports `watchFleet(opts, count)`: on `pulseWanted` true it starts the pulse (one per cache entry, as today), and on false it stops it with `pulseClock.stop()` and keeps the cache. An attach after a stop starts one `refresh` and one `maybeRefreshPrs` at once, so the page catches up within one scan.
- A plain request (`/api/board`, `/api/fleet`, `plot-boardctl.sh --status`) reads the cache. When the cache entry has no pulse running and its last scan is older than `REFRESH_MS`, the request starts one `refresh` and does not start the pulse. A polling script therefore gets fresh answers and does not keep the board watched (story Decisions: "a plain HTTP request gets one cold read").
- A stopped pulse writes no reader-lock heartbeat. `stillFollowed` (`packages/fleet/src/server/entry/pr-reader.ts:137-146`) reads a heartbeat older than `HEARTBEAT_STALE_MS` (2 min, `packages/domain/src/rules/reader-election.ts:137`) as no follower, so a `plot-pr-reader.mjs` the board started exits within about 2 minutes and releases the lock.
- New and changed functions are arrows. The `pulseWanted` rows are unit tests in `packages/domain`; the attach/detach rows are unit tests over `startEventHub` with a fake response.

**Slice 2: the page closes its stream and stops its polls while hidden.**

- `openSharedEventSource` reads `document.visibilityState`. On `hidden` the tab closes its real `EventSource`, releases the Web Lock and closes its relay; a hidden tab that waits for the lock cancels its request with an `AbortSignal`, so the browser never grants the lock to a hidden tab. On `visible` the tab requests the lock again and calls `refetch` once.
- With several tabs, a hidden lock holder releases the lock, and the browser grants it to the next waiting visible tab, which opens the stream. When every tab is hidden, no stream is open and `clients()` reads 0.
- The `/api/board` interval (`App.tsx:541`) and the `/api/fleet` interval (`:555`) run only while the page is visible. The existing `visibilitychange` handler (`App.tsx:787-794`) already reloads both on return; it stays.
- The decision "this page holds a stream and polls" depends on one reading, the visibility, and lives in one exported arrow function in `event-listener.ts` with unit rows under jsdom.

**What fails closed.** With no fleetd and no visible tab, nothing writes `index/github.json` or `.plot/state/default-branch.json`, so every board-free merge refuses as `default-branch-stale` until a tab opens or a fleetd starts. The index never says `pr: 'none'`, so no decision reads a wrong answer. jwloka accepted this on 2026-11-05 (story Decisions). Nobody loosens the staleness check to "fix" it.

**Order.** Slice 2 depends on slice 1: a hidden page that closes its stream lowers the count only once the server stops its pulse at zero clients.

### Open Questions

- [ ] The story's Phase 2 bullet says the board stops the pulse "when `clients()` is 0 and no plain request arrived within a bound, and restarts it on the next request". The settled Decision and *Target Shape* say a plain request gets one cold read and does not keep the board watched. This plan follows the Decision. A person confirms that the Phase 2 wording is the older one.
- [ ] Does the board warm its cache at server start, before any request? If so, the pulse must not start there either; slice 1 checks `index.ts` start-up.
- [ ] A browser without Web Locks or `BroadcastChannel` gets a stream of its own per tab (`event-listener.ts:41-44`). The hidden rule applies to that stream the same way; the rows cover both paths.
- [ ] The census S2 row needs a page that turns hidden; `process-census-gate` names how the census drives it (headless browser or a protocol-following SSE client).

## Done when

| Claim | Check | Slice |
|---|---|---|
| An idle board with no client and no fleetd starts nothing | census S1 is `it` (no longer `it.fails`) and reads 0 `execve` per minute | Server pulse |
| The pulse runs exactly while a client is attached | `pulseWanted` rows: 0 → false, 1 → true; hub rows: attach, attach, detach, detach call `onClients` with 1, 2, 1, 0 | Server pulse |
| An attach after a stop catches up | after detach and re-attach, one `refresh` and one `maybeRefreshPrs` run before the next beat | Server pulse |
| A plain request refreshes once and starts no pulse | with no client, two `/api/board` requests 6 s apart start two `refresh` runs and no pulse beat follows | Server pulse |
| A board-started PR reader exits | with no client, `plot-pr-reader.mjs` exits within `HEARTBEAT_STALE_MS` plus one reader beat | Server pulse |
| A hidden page holds no stream and sends no poll | jsdom rows: `hidden` closes the stream, releases the lock and clears both intervals; `visible` reopens, refetches once and restores the intervals | Hidden page |
| A hidden page leaves the server idle | census S2 is `it` and reads 0 `execve` per minute after the hide | Hidden page |
| Fail-closed merge holds | `plot-ask.mjs merge` with no fleetd and no tab refuses `default-branch-stale`; existing test unchanged | Server pulse |

## Slices

### Server pulse

- `feature/no-tab-no-pulse-server` — `pulseWanted` in `packages/domain/src/rules/board-watch.ts`; `onClients` in `channel-events.ts`; `watchFleet` and the cold-read path in `fleet.ts`; the wiring in `index.ts`; census S1 flipped to `it`; a changeset for `@plot-pm/board` <!-- builds: pulseWanted, a domain rule for when the board pulse runs --> → #3251

### Hidden page

- `feature/no-tab-no-pulse-page` — the visibility rule in `event-listener.ts` (stream, Web Lock, relay), the visible-only intervals in `App.tsx`, jsdom rows, census S2 flipped to `it`; a changeset for `@plot-pm/board` <!-- builds: a visibility-driven shared EventSource in event-listener.ts --> → #3252

### PR reader

- `feature/no-tab-no-pulse-reader` — a cold read starts no `plot-pr-reader.mjs`; the board starts the reader only while a client is attached and the reader ends within one beat after the last client detaches; census S1 and S2 flipped to `it` once they read 0; a changeset for `@plot-pm/board` <!-- builds: a PR reader that runs only while a client is attached --> → #3260

## Notes

- Phase 2 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `process-census-gate`.
- Line numbers checked against `origin/sprint/nothing-runs` on 2026-11-08. The story cites `fleet.ts:3225` for the pulse; `ensureCache` is at `:3178` and `startPulse` at `:3232`. It cites `App.tsx:48-49` for the polls; the constants are at `:50-51` and the intervals at `:541` and `:555`. It cites `event-listener.ts:31-66`; the doc comment is at `:30-39` and `openSharedEventSource` at `:40-70`. The 4 s fleet poll already runs only while the delivery tab is open (`App.tsx:553-558`), but it keeps running while that tab is hidden.
- Definition of Done: docs/definition-of-done.md.
- 2026-11-08: Slice *PR reader* added after the first Linux census run (CI on #3237 at `e78101194`). With *Server pulse* and *Hidden page* merged, S1 read 102 `execve` per minute on GitHub and 733 on Bitbucket, and S2 read 97 (merge base: 1466). The source is the detached `plot-pr-reader.mjs`: the first `GET /api/board` runs `maybeRefreshPrs` (`fleet.ts:3228`), which starts the reader (`fleet.ts:2584`, `:2789`); the reader runs a full PR pass every 60 s (`pr-reader.ts:207-219`) and exits only once the board's heartbeat is 2 minutes stale (`stillFollowed`, `pr-reader.ts:137`).
