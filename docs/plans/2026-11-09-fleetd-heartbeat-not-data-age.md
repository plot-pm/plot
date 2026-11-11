# fleetd says it is alive on a timer

> fleetd writes a heartbeat file on an in-process timer, with observer fields, under a name that exists with no git host. The scan owner, the PR reader, the CLI controllers and the board read that heartbeat in place of three data-age checks, and the board stops running `plot-fleetctl.sh --status` on every beat while fleetd is alive.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** the-board-reads-the-channel
- **Issue:** #3170
- **Story:** nothing-changed-nothing-runs
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3278 merged
- **Delivered:** 2026-11-09

## Changelog

- fleetd now says it is alive every 10 seconds, whether or not anything changed and whether or not the repository has a git host. The board, the PR reader and the dispatch, continue and restart commands read that signal instead of the age of the last file fleetd wrote, and the board no longer asks the init system about fleetd on every refresh while fleetd is alive.

Board impact: the board server reads the heartbeat file and calls `plot-fleetctl.sh --status` only when the heartbeat is absent or stale. The page, the plan format, the template, the helper scripts and the `docs/plans` layout do not change.

## Motivation

Three checks infer that fleetd is alive from the age of data it wrote (story, Phase 3):

| Check | Bound | Where | What reads it |
|---|---|---|---|
| bridge age for scan ownership | `OWNED_BRIDGE_MAX_AGE_MS = 180_000` (`packages/domain/src/rules/scan-owner.ts:10`), with `OWNED_ATTEMPT_MAX_AGE_MS = 180_000` (`:19`) | `fleetOwnsScan` (`:53`), `bridgeIsFresh` (`:71`) | the board's `refresh` (`packages/board/src/server/fleet.ts:3004`) and its PR path (`:2505`) |
| reader-lock heartbeat | `HEARTBEAT_STALE_MS = 2 min` (`packages/domain/src/rules/reader-election.ts:137`) | `heartbeatIsFresh` (`:155`) | the board's `fleetdHeartbeatIsLive` (`fleet.ts:2539`) and the PR reader's `stillFollowed` (`packages/fleet/src/server/entry/pr-reader.ts:135-149`) |
| bridge age for the CLI controllers | `BRIDGE_MAX_AGE_MS = 15 min` (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:17`, applied at `:80`) | `fleetStateFile().readSync()` | `dispatch-command.ts:76`, `continue-command.ts:61`, `restart-command.ts:50`, `restart-stopped-command.ts:44` under `packages/fleet/src/server/entry/`, and the board at `packages/board/src/server/board.ts:508` |

fleetd writes the reader-lock heartbeat only on a PR beat (`fleetPrs`, `packages/fleet/src/shared/fleet-clock.ts:267`), every 60 s (`PR_READ_BEAT_MS`, `packages/domain/src/rules/pr-status.ts:132`), keyed by the connector word that `resolveBackend` returns (`packages/fleet/src/shared/pr-refresh.ts:1065-1078`), which is `''` for a repository with no git host. Under write-on-change (Phase 8) an idle repository writes no bridge and no PR answer, so all three checks age out while fleetd is healthy: the board and fleetd would both scan, and the CLI controllers would refuse.

The board also asks the init system about fleetd on every beat: `readSupervisor` (`fleet.ts:2931`) runs `plot-fleetctl.sh --status` (`packages/board/src/server/supervisor-reading.ts:52`), which walks every desk and took 0.46–1.42 s when measured on 2026-09-07 (`supervisor-reading.ts` header). Since `no-tab-no-pulse` the beat runs only while a tab is attached, plus one cold read per plain request (`packages/domain/src/rules/board-watch.ts`, `coldReadDue`), so this cost is part of census S3: 1212 `execve` per minute on the sprint head `ee3541cff` (GitHub, 0 desks, 5 open PRs).

## Design

This plan depends on `the-snapshot-entity`: the heartbeat names the snapshot's `generation`. `board-reads-the-channel` depends on this plan and on `the-channel-carries-readings`. This plan moves no census row. Slice 3 lowers S3's count, and the gate holds the lower figure; S3 stays `it.fails` until `board-reads-the-channel`.

### Approach

**Slice 1: the heartbeat.**

- `packages/domain/src/entities/fleetd-heartbeat.ts` declares `FleetdHeartbeatSchema`: `version`, `pid`, `startedAt`, `beatAt`, `generation` (the snapshot's), `protocol` (`SNAPSHOT_PROTOCOL` once `the-channel-carries-readings` lands; absent before), `bridgeAt` (the `at` of the last bridge fleetd wrote), `supervised` (`launchd`, `systemd` or `none`, from fleetd's own environment, no process), and the observer fields `watchesWanted`, `watchesArmed`, `lastEventAt`, `lastSafetyNetAt` and `lastPassAt` per loop (`tick`, `scan`, `pr-reader`, `issue-reader`).
- fleetd already writes `fleetd-start.json` once at start (`FleetdStartSchema`, `packages/domain/src/entities/fleetd-start.ts`; written at `packages/fleet/src/server/entry/registryd-main.ts:2780-2787`) with `pid`, `startedAt`, `spawnContract` and the bundle hash, and that record is written once and never again (#2728). The heartbeat is a second file because it is rewritten every 10 s; it repeats `pid` and `startedAt` so a reader can tell that both files describe one process.
- `packages/domain/src/ports/fleetd-heartbeat.ts` declares the port (`write`, `read`); `packages/domain/src/adapters/fleetd-heartbeat/fleetd-heartbeat-file.ts` implements it as `.plot/state/fleetd.json` under the repository root, beside `last-pulse.json`, written by temp file and `rename`. A file write is no process.
- `packages/domain/src/rules/fleetd-live.ts` holds two arrow functions over values. `fleetdLiveness(heartbeat, now)` answers `live`, `stale` or `absent`: `live` while `now - beatAt` is at most three beats (`missedBeatsTolerance`, `packages/domain/src/rules/channel.ts:218`), and never for a heartbeat from the future. `observerFresh(heartbeat, now)` answers whether each loop completed a pass within its own bound (the scan: twice `FLEET_SCAN_BUDGET_MS = 90_000`, `packages/fleet/src/shared/fleet-scan.ts:60`). In Phase 8 the same rule reads `watchesArmed` and `lastSafetyNetAt` instead; the story's failure mode "the watcher wedges while the host read keeps the heartbeat fresh" is what it answers.
- fleetd (`packages/fleet/src/server/entry/registryd-main.ts`) writes the heartbeat on an in-process `setInterval` of 10 s, the channel's own beat (`HEARTBEAT_MS`, `packages/domain/src/adapters/channel/channel-socket.ts:34`), whatever the host backend, and once more at start. `--once` writes none.

**Slice 2: the readers read the heartbeat.**

- `fleetOwnsScan` takes the heartbeat reading in place of `supervisor`, `bridgeAt` and `lastAttemptStartedAt`: the fleet owns the scan while `fleetdLiveness` is `live` and `observerFresh` holds. A stale or absent heartbeat hands the scan to the board, as a `down` supervisor does today. `ownedBridgeNote` names the loop whose pass is late.
- The board's `fleetdHeartbeatIsLive` and the PR reader's `stillFollowed` read `fleetdLiveness` from the heartbeat file. The reader lock's `fleetd` entry stays for the election itself (`fleet-clock.ts:259-267`), so two PR writers still cannot race; only the question "is fleetd alive" moves.
- The bridge readers keep the 15-minute bound for a bridge with no live fleetd and accept an older bridge while the heartbeat is `live` and its `bridgeAt` equals the bridge's `at`: fleetd vouches that the bridge is its latest write. The rule is `bridgeVouched(bridge, heartbeat, now)` in `packages/domain/src/rules/fleetd-live.ts`; `fleetStateFile` takes the heartbeat reading through an option, so `parseBridge` (`fleet-state-file.ts:73`) decides nothing new itself.

**Slice 3: the board stops asking the init system each beat.** `refresh` reads the heartbeat file first. While it reads `live`, the board derives the supervisor reading from the heartbeat (`supervised` and `live` → `up`) and does not run `readSupervisor`. When it reads `stale` or `absent`, the board runs `readSupervisor` as today, so `down` and `died` (`packages/domain/src/rules/supervisor-reading.ts`) keep their one source, `plot-fleetctl.sh --status`. The channel heartbeat that the board's hub already receives every 10 s counts as a second liveness fact: a hub that lost the channel while the file reads `live` reports both facts on `/api/fleet` rather than choosing one.

### Open Questions

- [x] The census S3 fixture starts fleetd directly, not under launchd or systemd (`packages/fleet/test/census/board.census.test.ts:146`). `plot-fleetctl.sh --status` derives `supervisor=up` only from `install_state=running` (`skills/plot/scripts/plot-fleetctl.sh:989-990`), so the board in S3 likely reads `down`, `fleetOwnsScan` answers false, and the board runs its own scan every 5 s. S3's top commands at `ee3541cff` (`git` ×432, `awk` ×144, `grep` ×144, `bash` ×120, `sed` ×84 per minute) fit a board-run scan. Slice 2 confirms this from the census log; if it holds, slice 2 is the largest single drop in S3. **Decided 2026-11-09, jwloka: Readers (#3286) confirmed it from code, and the census S3 fixture runs fleetd under a supervisor so that S3 measures the operator setup; the Census zero slice of `board-reads-the-channel` makes the change.**
- [ ] `supervised` comes from fleetd's environment (`XPC_SERVICE_NAME` under launchd, `INVOCATION_ID` under systemd). A person confirms that these variables are reliable on the operator's macOS version, or names a better process-free source.
- [ ] `packages/board/src/server/entry/delta-core.ts:66` repeats `BRIDGE_MAX_AGE_MS` to compute a pulse delta and reads no liveness. This plan leaves it, because a delta against a 15-minute-old pulse describes a different repository state whatever fleetd's health. A person confirms.
- [ ] The story says the reader-lock heartbeat is "written only on a PR beat with a host backend, so a repository with no git host has none". On the sprint head fleetd still writes it, under the key `''` that `resolveBackend` returns with no backend; whether `readerLockFile` stores a usable entry under that key is unverified. Slice 2 removes the dependency either way.
- [ ] Should a stale heartbeat with a live pid (a wedged fleetd) read differently from an absent one on the board? This plan shows both as "fleet not answering" and hands the scan to the board.

## Done when

| Claim | Check | Slice |
|---|---|---|
| fleetd beats with no host backend | fleetd test with a repository that has no git host: `.plot/state/fleetd.json` exists after start and its `beatAt` moves within 11 s on an injected clock | Heartbeat |
| fleetd beats while nothing changes | with the scan, PR and issue loops stubbed to no-ops, `beatAt` moves on every 10 s interval for 2 minutes | Heartbeat |
| A heartbeat ages out in three beats | `fleetdLiveness` rows: 0 s, 30 s → `live`; 31 s → `stale`; a future `beatAt` → `stale`; no file → `absent` | Heartbeat |
| A wedged loop shows | `observerFresh` false when the scan's `lastPassAt` is older than 180 s while `beatAt` is fresh | Heartbeat |
| The board and fleetd never both scan | `fleetOwnsScan` rows: `live` and observer fresh → true; `stale`, `absent` or observer late → false; a board test with a live heartbeat and an old bridge runs no `scanOnce` | Readers |
| An idle repository does not lose its owner | a heartbeat that stays `live` with a bridge 20 minutes old keeps `fleetOwnsScan` true | Readers |
| The CLI controllers accept a vouched bridge | `plot-dispatch-command.mjs` reads a 20-minute-old bridge while the heartbeat is `live` and names its `at`; it refuses the same bridge with a stale heartbeat, as today | Readers |
| A mismatched vouch refuses | a heartbeat whose `bridgeAt` differs from the bridge's `at`, with the bridge older than 15 minutes, refuses | Readers |
| A board-started PR reader exits when fleetd beats | with a `live` heartbeat file and no reader-lock heartbeat, `stillFollowed` answers `fleetd` | Readers |
| The board asks the init system only without a live heartbeat | board test: 12 beats with a `live` heartbeat run 0 `plot-fleetctl.sh`; 12 beats with a `stale` heartbeat run 12 | Board |
| S3 falls and stays held | census S3 reads below its merge base on the sprint PR; the gate holds the new figure | Board |

## Slices

### Heartbeat

- `feature/fleetd-heartbeat-not-data-age-beat` — `FleetdHeartbeatSchema`, the heartbeat port and file adapter, `fleetdLiveness` and `observerFresh` in `rules/fleetd-live.ts`; fleetd writes `.plot/state/fleetd.json` every 10 s on an in-process timer <!-- builds: fleetdLiveness, a domain rule over a timer heartbeat with observer fields --> → #3287

### Readers

- `feature/fleetd-heartbeat-not-data-age-readers` — `fleetOwnsScan`, `fleetdHeartbeatIsLive`, `stillFollowed` and the four CLI controllers read the heartbeat; `bridgeVouched` accepts a bridge fleetd vouches for; a changeset for `@plot-pm/board` <!-- builds: bridgeVouched, heartbeat-based scan ownership and bridge trust --> → #3286

### Board

- `feature/fleetd-heartbeat-not-data-age-board` — `refresh` runs `readSupervisor` only when the heartbeat is not `live`, and `/api/fleet` reports the file and channel heartbeats; a changeset for `@plot-pm/board` <!-- builds: a board refresh that runs plot-fleetctl.sh --status only without a live fleetd heartbeat --> → #3284

### Follow-ups

- `feature/fleetd-heartbeat-not-data-age-followups` — `fleetOwnsScan` follows the scan loop only; the bridge resolves to the main checkout through the shared `mainRootOf`; decided 2026-11-09 (see Notes); a changeset for `@plot-pm/board` <!-- builds: scan ownership by the scan loop, and the bridge at the main checkout --> → #3298

### Issue index

- `feature/fleetd-heartbeat-not-data-age-issue-index` — the board reads the issue index while fleetd's heartbeat is `live` and its `issue-reader` loop is on time, instead of following the scan loop; decided 2026-11-09 by jwloka <!-- builds: an issue-index gate that follows the issue-reader loop --> → #3302

## Notes

- **Decided 2026-11-09, jwloka — three follow-ups from the Readers reviews (#3286).**
  - **Phase 8:** fleetd writes a bridge after every successful scan today, so a scan passes only when its bridge write lands (`trackBridgeWrites`). Once Phase 8 (`triggers-replace-the-tick`) stops writing an unchanged bridge, a scan pass must mean "the scan ran and succeeded", not "a bridge was written"; otherwise an idle repository reads its scan loop as late after 180 s and loses scan ownership and the bridge vouch.
  - **Scan ownership:** a late `tick` or `issue-reader` loop must not hand the scan to the board. `fleetOwnsScan` follows the scan loop only; the PR reader follows the `pr-reader` loop. Branch `feature/fleetd-heartbeat-not-data-age-followups`.
  - **The bridge:** `.plot/state/last-pulse.json` resolves to the main checkout, as the heartbeat does since #3286, so a board in a linked worktree reads the bridge fleetd writes. Same branch.
- Phase 3 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `the-snapshot-entity`.
- Line numbers checked against `origin/sprint/nothing-runs` at `8437242ef` on 2026-11-08. The story cites `fleet.ts:2873` for the per-tick `plot-fleetctl.sh --status`; `refresh` starts at `:2863` and `readSupervisor` is called at `:2931`. It cites `channel-socket.ts:33` for the channel heartbeat; `HEARTBEAT_MS = 10_000` is at `:34`. The 180 s, 2 min and 15 min bounds are at the lines the story names.
- Since `no-tab-no-pulse` (#3251, #3260) the board runs `refresh` only while an event stream is attached, or once per plain request through `coldReadDue`. The story's "on every tick" therefore holds only while a tab is visible.
- S3 figure from the `process-census` job on CI run 42510574702 (`ee3541cff`, 2026-11-08).
- Definition of Done: docs/definition-of-done.md.
