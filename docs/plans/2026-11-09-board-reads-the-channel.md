# The board reads fleetd's snapshot and starts nothing

> While fleetd's heartbeat is live and the channel speaks the board's protocol, the board serves every view from the snapshot it receives over the channel, derives its verdicts with the domain rules, and starts no process. With no live fleetd, a visible tab keeps the board's own reader, as today.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** the-board-reads-the-channel
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3278 merged

## Changelog

- A board with an open tab no longer reads the repository itself while fleetd runs: it shows what fleetd last read and sent over the channel, and starts no process. With fleetd stopped, or from a different release, the board reads for itself as before and says why.

Board impact: the board server and its fleet view change source; `board-server.mjs` rebuilds on `main`. The page, the plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

A board with one visible tab and fleetd running (census S3) starts 1212 `execve` per minute on the sprint head `ee3541cff` and 1429 on `main` (GitHub, 0 desks, 5 open PRs; top on the sprint head: `git` ×432, `awk` ×144, `grep` ×144, `bash` ×120, `sed` ×84). The board does no work; it helps a person orient (story, *Why Now*). While fleetd already reads the repository, every process the board starts reads a second time what fleetd knows.

The board's `refresh` (`packages/board/src/server/fleet.ts:2863`) reads on every 5 s beat while a tab is attached: the agent registry through `readAgentRegistryWithInfo` with `bashCleanliness` (`:2906-2912`), the bridge (`:2927`), the supervisor (`:2931`), its own scan when it does not own the scan (`scanOnce`, `:3015-3046`), branch ages (`:3094`), release versions (`:3102`), unmerged branches (`:3108`), worker questions (`:3118`) and the estate measure (`:3152`). `GET /api/board` reads plans from the ref (`readPlansFromRef`, `packages/board/src/server/board.ts:849`, called at `:1051` and `:1876`).

S3 is the story's Phase 4 target: 0.

## Design

This plan depends on `the-channel-carries-readings` (the board receives `RepoSnapshot` and detects a version mismatch) and on `fleetd-heartbeat-not-data-age` (the board knows fleetd is alive without data age and without `plot-fleetctl.sh --status`). Both depend on `the-snapshot-entity`. This plan moves census row **S3** from `it.fails` to `it`.

### Approach

**The rule: render from readings, decide in the domain.** *Every rendered state is a domain property* (`CLAUDE.md`, *The Layering Rule*). The board holds the snapshot as values and calls the same domain rules fleetd calls. No verdict travels on the channel (story Decisions, 2026-11-05).

**Which source the board reads is a domain rule.** `boardSource({ heartbeat, channel, clients, now })` in `packages/domain/src/rules/board-watch.ts`, beside `pulseWanted` and `readerWanted`, answers `snapshot` when `fleetdLiveness` reads `live`, `observerFresh` holds, and the channel state is `current`; `own` when a tab is attached and any of those fails; `idle` with no client. A `mismatch` or `resyncing` channel answers `own`, so a board and a fleetd from different commits never render a snapshot the board cannot read.

**Slice 1: the view from a snapshot.** `packages/domain/src/workflows/board-view.ts` exports `fleetViewFrom(snapshot, now)`, which returns the values the board's cache entry holds today: the `FleetReading`, branch ages, approval dates, idea plans, the PR maps, the issue rows, the agent entries and the registry info. It calls the existing walk rules (`packages/domain/src/workflows/plan-walk-*.ts`) over the snapshot's readings rather than over ports. Where the snapshot lacks a value the board renders (release versions, unmerged branches, worker questions, the estate measure; see `the-snapshot-entity`'s Open Questions), this slice adds the reading to `RepoSnapshot` and fleetd fills it from the read the board makes today, so the read moves rather than repeats. A parity corpus test renders both paths over recorded fixtures and compares field by field. The risk is high: `fleet.ts` holds 8,332 lines, and a field missed here is a silent wrong row.

**Slice 2: the board serves from the snapshot.** `refresh` asks `boardSource` first. On `snapshot` it installs `fleetViewFrom(held, now)` into the cache entry and returns: no `readAgentRegistryWithInfo`, no `readSupervisor`, no `scanOnce`, no `branchAges`, no `releaseVersions`, no `unmergedBranches`, no `workerQuestions`, no `measureEstate`, and no PR read or `plot-pr-reader.mjs` start. A delta arriving on the channel re-derives the view and sends one SSE event, so the page's refetch reads the new view. `GET /api/board` reads plans from the snapshot's `plans` reading on `snapshot`, and from the ref otherwise. On `own` the board runs today's path unchanged. Action endpoints (`dispatch`, `approve`, `deliver`, `continue`, `restart` and the rest) keep their own reads: an action is a trigger, and it re-reads its evidence before it acts (story, *Re-ask before acting*).

**Slice 3: the census reads zero.** This slice removes what S3's log still names after slice 2, and flips the row:

- `packages/fleet/test/census/census-rows.ts`: S3 gets `green: true`, and its `greenBy` becomes `{ plan: 'board-reads-the-channel', slice: 'Census zero' }`.
- `packages/fleet/test/census/board.census.test.ts:160`: `it.fails` becomes `it`.
- S3 must read **0 `execve` per minute** over the board's process tree, with one visible SSE client attached and fleetd running untraced on the system clock, on the GitHub fixture with 0 desks and 5 open PRs. P3-board in the same window stays 0. The row is `'strict'`, so the gate allows 0 once the merge base reads 0.
- The `process-census` job on Linux CI on the sprint PR verifies it; a local macOS run skips the census (`census-setup.ts`).

**With no fleetd.** A visible tab keeps the board's own reader, at the cost Phase 1 measures; the last tab leaving stops it. `no-tab-no-pulse` already delivers both halves (`watchEntry`, `fleet.ts`; `readerWanted`, `board-watch.ts`), so this plan only keeps them: a regression row holds them.

### Open Questions

- [ ] The story's Phase 4 second bullet ("With no fleetd and a visible tab, the board keeps its own reader … When the last tab leaves, it stops that reader") is already true on the sprint head: `no-tab-no-pulse` stops the pulse at zero clients and starts the PR reader only while a client is attached and no fleetd heartbeat is live. This plan treats it as delivered and adds only a regression row. A person confirms.
- [ ] The S3 window attaches an SSE client and sends no `GET /api/board` (`packages/fleet/test/census/board-driver.ts`), while a visible page polls `/api/board` every 30 s (`POLL_MS`, `packages/board/src/app/App.tsx:50`). A zero in S3 therefore does not prove that `/api/board` starts nothing. Slice 3 either adds one `/api/board` request to S3's window or adds a test outside the census; a person decides whether S3's definition changes.
- [ ] The board shows the supervisor's state in its header. With `snapshot` as the source, the board derives it from the heartbeat (`fleetd-heartbeat-not-data-age`, slice 3). A person confirms that the header needs no reading that the heartbeat lacks.
- [ ] The registry the board reads is the `Agent registry` path from config, which can lie outside the repository (this repository's config names `/Users/jwloka/Quatico/Agentic-Tools/plot/.plot/agents`). fleetd reads the same path; slice 1 confirms that both read one directory.
- [ ] Render parity: slice 1's corpus fixtures come from the census sandboxes (GitHub and Bitbucket, 0 and 3 desks). A person names any board view that those fixtures do not reach.

## Done when

| Claim | Check | Slice |
|---|---|---|
| The board picks its source in the domain | `boardSource` rows: `live` + fresh + `current` + 1 client → `snapshot`; `stale`, `absent`, `mismatch` or `resyncing` + 1 client → `own`; 0 clients → `idle` | View from snapshot |
| The snapshot renders what the board renders | parity corpus test over the census fixtures: `fleetViewFrom` and today's `refresh` path agree on every cache field the views read; a disagreement names the field and both answers | View from snapshot |
| No rendered value lacks a reading | every cache field `refresh` writes maps to a `RepoSnapshot` key; a field with none fails the test by name | View from snapshot |
| The board starts nothing while fleetd serves | board test with a stub channel and a `live` heartbeat: 12 beats spawn 0 processes (spawn spy over `Scripts`, `Refs`, `Processes` and `child_process`) | Serve from snapshot |
| A delta reaches the page | a delta on the stub channel produces one SSE event, and the next `GET /api/fleet` shows the changed row | Serve from snapshot |
| A version mismatch falls back | with the channel in `mismatch`, the board runs its own scan and `/api/fleet` names both protocol versions | Serve from snapshot |
| A dead fleetd falls back | the heartbeat turns `stale` while a tab is attached; the next beat runs the board's own scan | Serve from snapshot |
| Actions still re-read | `POST /api/dispatch` with a `snapshot` source still runs its own reads before it acts; existing controller tests unchanged | Serve from snapshot |
| No fleetd, no tab, nothing runs | census S1 and S2 stay 0 | Census zero |
| No fleetd, visible tab, own reader; last tab leaves, reader stops | existing `no-tab-no-pulse` rows pass unchanged | Census zero |
| A board with a visible tab and fleetd running starts nothing | census S3 is `it` with `green: true` and reads 0 `execve` per minute on Linux CI on the sprint PR | Census zero |

## Slices

### View from snapshot

- `feature/board-reads-the-channel-view` — `boardSource` in `packages/domain/src/rules/board-watch.ts`; `fleetViewFrom` in `packages/domain/src/workflows/board-view.ts`; the readings the board still reads alone added to `RepoSnapshot` and filled by fleetd; a parity corpus test <!-- builds: fleetViewFrom, the board's fleet view derived from a RepoSnapshot -->

### Serve from snapshot

- `feature/board-reads-the-channel-serve` — `refresh` and `GET /api/board` serve from the held snapshot when `boardSource` answers `snapshot` and fall back on `own`; a delta sends one SSE event; spawn-spy board tests; a changeset for `@plot-pm/board` <!-- builds: a board server that serves from the channel snapshot and spawns nothing while fleetd lives -->

### Census zero

- `feature/board-reads-the-channel-census` — the residual sources S3's log names removed; S3 set `green: true` with `greenBy` this plan and slice in `census-rows.ts`, and `it.fails` changed to `it` in `board.census.test.ts`; a changeset for `@plot-pm/board` <!-- builds: census S3 at zero, a required pass -->

### Vendor gate

- `bug/board-reads-the-channel-vendor-gate` — `branchUrlBase` names `github` and `bitbucket` in `packages/domain/src/rules/branch-url.ts` since #3289, and CI's "The domain names no vendor" gate refuses it on the sprint PR (#3277, run 42578481530); move the host knowledge behind an adapter, as #3232 did for tracker keys <!-- builds: branchUrlBase outside the domain's rules -->

### Main merge

- `bug/board-reads-the-channel-main-merge` — the sprint PR's CI (run 42589744654) fails three fleet tests after `main` merged in: the snapshot's `config` reading drops the `State branch` key `main` added, and two heartbeat `run` tests time out waiting for a beat under coverage <!-- builds: a config reading that carries every Plot Config key, and heartbeat run tests that wait on the beat itself -->

## Notes

- Phase 4 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `the-channel-carries-readings` and `fleetd-heartbeat-not-data-age`.
- Line numbers checked against `origin/sprint/nothing-runs` at `8437242ef` on 2026-11-08. The story cites `fleet.ts:2836-2875` for the per-beat reads of the registry, the supervisor and plan content; `refresh` starts at `:2863`, the registry read is at `:2906-2912`, the supervisor read at `:2931`, and plan content is read inside `scanOnce`'s walk at `:3020-3021` only when the board does not own the scan. `fleet.ts` holds 8,332 lines, not 8,151.
- S3 figures: `main` 1429 and sprint head 1212 from the `process-census` job on CI run 42510574702 (`ee3541cff`, 2026-11-08); the story's Measures row records 1248 from #3237 at `d1117a0a8`.
- The census row S3 is declared in `packages/fleet/test/census/census-rows.ts` with `greenBy: { plan: 'board-reads-the-channel', phase: 'Phase 4' }`; `docs/process-census.md` describes the `green: true` marking.
- Definition of Done: docs/definition-of-done.md.
