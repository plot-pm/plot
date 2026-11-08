# One snapshot of answers per repository

> A domain entity holds every reading the fleet and the board derive their verdicts from, a domain rule maps a change to the readings it makes stale, and a watch port with a directory-watcher adapter exists for Phase 8. In this plan fleetd's existing tick fills the snapshot; no watch arms.

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

- fleetd keeps one in-memory snapshot of what it last read about the repository: refs, desks, worker records, plans, the agent registry, PR and issue rows, the default-branch reading and the config. Nothing changes for an operator yet; the snapshot is what the board will read from the channel in a later release.

Board impact: none in this plan. The board, the plan format, the template, the helper scripts and the `docs/plans` layout do not change. `@plot-pm/domain` gains an entity, two rules, a port and an adapter; `@plot-pm/fleet` fills the entity in fleetd's composition root.

## Motivation

The story's target is one observer and one snapshot (story, *Target Shape*). Today each reader reads the world for itself. fleetd's scan, PR reader, issue reader and tick each keep their own state (`scanState`, `prState`, `issueState`, `tally` at `packages/fleet/src/server/entry/registryd-main.ts:3251-3254`), and the board repeats the reads on every beat while a tab is attached: the agent registry (`packages/board/src/server/fleet.ts:2906`), the supervisor through `plot-fleetctl.sh --status` (`:2931`), branch ages (`:3094`), release versions (`:3102`), unmerged branches (`:3108`) and worker questions (`:3118`).

CI on the sprint head `ee3541cff` counts the cost. A board with one visible tab and fleetd running (census S3) starts 1212 `execve` per minute on GitHub with 0 desks and 5 open PRs (top: `git` ×432, `awk` ×144, `grep` ×144, `bash` ×120, `sed` ×84). An idle fleetd pass (S4) starts 1099.5 (0 desks) and 2560.5 (3 desks). The board cannot stop reading until something else holds the answers and hands them over. This plan builds that holder.

A snapshot alone starts and saves no process. It is the precondition for three later plans: `the-channel-carries-readings` sends it, `fleetd-heartbeat-not-data-age` vouches for it, and `board-reads-the-channel` renders from it.

## Design

This plan depends on `process-census-gate` (delivered). `the-channel-carries-readings` and `fleetd-heartbeat-not-data-age` depend on this plan, and `board-reads-the-channel` depends on both of those. This plan moves no census row: the tick still runs and still starts every process it starts today.

### Approach

**Placement under *The Layering Rule*** (story, *Placement*):

- The snapshot is a domain entity of readings in the "readings as values" shape. It holds answers, never verdicts (story Decisions, 2026-11-05: "The channel carries answers (readings); each reader derives its verdicts"). fleetd's composition root (`registryd-main.ts`) holds the one instance.
- The table "which change makes which reading stale" is a pure domain rule. It never lives in `packages/fleet/src/shared/`.
- A file watch reaches the world through a new port the domain owns, and a watcher adapter implements it. `packages/*/src` holds no `fs.watch` today, so this is a new adapter kind.

**Slice 1: the entity and the staleness rule.** `packages/domain/src/entities/snapshot.ts` declares `RepoSnapshotSchema` (zod) with one keyed reading per source:

| Reading key | Holds | Existing type it reuses |
|---|---|---|
| `refs` | every ref and its SHA, with the digest | `RefSnapshot` (`packages/domain/src/workflows/plan-walk-cache.ts:176`) |
| `desks` | worktrees and their `HEAD`s | the `Trees` port's answer |
| `deskFiles` | `PLOT-BLOCKED`, `PLOT-CORRECTION.md` and other desk markers per desk | the `Desk` port's answer |
| `workers` | `.plot-worker.*` records and the liveness answer per desk | the `Processes` and `Agents` port answers |
| `plans` | plan, sprint and story content at the read ref | the `PlanStore` port's answer |
| `registry` | agent manifests | `AgentEntry` |
| `prs` | PR rows | `pr-index.ts` rows |
| `issues` | issue rows | `issue-index.ts` rows |
| `defaultBranch` | the default-branch reading | `default-branch.ts` |
| `config` | the `## Plot Config` values the rules read | — |

Every reading carries `readAt` (epoch ms) and a state: `read`, `unread` or `failed` with a reason. An unread reading is never an empty one, for the reason the index never says `pr: 'none'` (`CLAUDE.md`, *A Decision Reads The Index*). The snapshot carries a `generation` that grows by one whenever a reading's content changes.

Two arrow-function rules sit beside it:

- `recordReading(snapshot, key, reading)` in `packages/domain/src/rules/snapshot-record.ts` returns the new snapshot and the changed keys. It compares by content: a reading equal to the held one changes nothing and keeps the generation. This is the story's *Self-caused events* rule ("a ref event whose SHA equals the snapshot's … changes nothing"), and it never ignores an event for a time window.
- `staleReadings(change)` in `packages/domain/src/rules/snapshot-stale.ts` maps a change to the reading keys it makes stale, one row per trigger in the story's *Triggers* table: a ref or `packed-refs` change → `refs`; a desk's git state → `desks` for that desk; a desk's own files → `deskFiles` and `workers` for that desk; a worker log → `workers` (activity) for that desk; a host answer → `prs`, `issues` or `defaultBranch`; a remote change → `refs` through one fetch; a deadline → no reading (the owning rule runs); plan, sprint or story content → `plans`; the registry directory → `registry`; `CLAUDE.md` → `config`; the safety net → every key.

**Slice 2: the watch port and the watcher adapter.** `packages/domain/src/ports/watch.ts` declares `Watch` with `arm(dir, { recursive })` that returns a handle with `close()`, delivers `{ dir, name, kind }` events, and reports `degraded` when a watch fails to arm. `packages/domain/src/adapters/watch/watch-fs.ts` implements it over `fs.watch` on directories only, never on files, and re-arms a watch on `rename` (story, *Failure modes*: git renames a lock file over the target, so a file watch follows the old inode). It never watches `.git/` recursively. No production caller arms it in this plan; Phase 8 (`triggers-replace-the-tick`) does.

**Slice 3: fleetd fills the snapshot from the tick.** `registryd-main.ts` creates one snapshot at start and hands each loop a `record(key, reading)` callback: the scan records `refs`, `desks`, `deskFiles`, `workers`, `plans` and `config` from the readings it already takes in `fleetScan` (`packages/fleet/src/shared/fleet-scan.ts`); the PR reader records `prs`; the default-branch beat records `defaultBranch`; the issue reader records `issues`; the tick records `registry`. The callbacks call `recordReading` and add no read: every value comes from a read the loop makes today. A `--once` run fills it too, so a test can assert the snapshot after one pass.

### Open Questions

- [ ] The board reads four values the fleetd scan does not take today: release versions (`fleet.ts:3102`), unmerged branches (`:3108`), worker questions (`:3118`) and the estate measure (`measureEstate`, `:3152`). This plan declares no reading for them. `board-reads-the-channel` either adds them as readings that fleetd fills, or derives them from readings already declared. A person confirms which plan owns that.
- [ ] The supervisor reading (`plot-fleetctl.sh --status`) is a machine answer about fleetd, not a repository answer. It stays out of the snapshot; `fleetd-heartbeat-not-data-age` replaces it as the liveness signal. A person confirms that the snapshot does not need it.
- [ ] `fleetScan` already reads a ref digest per beat (`readRefSnapshot`, `fleet-scan.ts:718`) for its walk cache. Slice 3 records that value as `refs` rather than a second read. If the walk cache's lifecycle (`cache.begin()`, `:721`) makes that awkward, slice 3 says so and keeps one read.
- [ ] The story places the per-desk liveness and cleanliness reads behind the `Processes` port, including the board's path through `registry.ts` (`bashLiveness` at `packages/fleet/src/shared/registry.ts:1147`, `bashCleanliness` at `:1319`, `execFile` at `:510`). This plan records what `registry.ts` answers today and moves no read; `desk-probes-in-domain` (Phase 5) moves them.

## Done when

| Claim | Check | Slice |
|---|---|---|
| Every source the story names has a reading key | schema rows: the ten keys above parse; a snapshot with a missing key fails to parse | Entity |
| An unread reading is not an empty one | rows: `prs` `unread` and `prs` `read` with zero rows are different values; a rule reading `unread` answers `unknown` | Entity |
| An equal reading changes nothing | `recordReading` with the same refs returns no changed key and the same `generation` | Entity |
| A changed reading moves the generation once | `recordReading` with one moved ref returns `['refs']` and `generation + 1` | Entity |
| Every trigger row maps to its readings | one `staleReadings` row per row of the story's *Triggers* table; the safety net returns every key | Entity |
| A directory watch survives git's rename | adapter test: two commits in a temporary repository each deliver an event for `refs/heads/` | Watch port |
| A watch that cannot arm says so | adapter test: arming a missing directory reports `degraded`, and throws nothing | Watch port |
| The domain stays pure | the purity gate (`ci.yml`) reads 0 violations; `ports/watch.ts` names `adapters/` zero times | Watch port |
| fleetd's tick fills every key | `--once` test: after one pass every key reads `read` or `failed`, none `unread`, on the GitHub census fixture | Fleetd fills |
| Filling adds no process | census S4 on every fixture stays within the gate's tolerance against the merge base | Fleetd fills |

## Slices

### Entity

- `feature/the-snapshot-entity-entity` — `RepoSnapshotSchema` in `packages/domain/src/entities/snapshot.ts`, `recordReading` in `rules/snapshot-record.ts`, `staleReadings` in `rules/snapshot-stale.ts`, unit rows for each <!-- builds: RepoSnapshot, a domain entity of readings with a generation -->

### Watch port

- `feature/the-snapshot-entity-watch` — the `Watch` port in `packages/domain/src/ports/watch.ts` and the `watchFs` adapter in `packages/domain/src/adapters/watch/watch-fs.ts`: directories only, re-arm on `rename`, `degraded` on a failed arm; adapter tests in a temporary repository <!-- builds: Watch, a domain-owned file-watch port with an fs.watch directory adapter -->

### Fleetd fills

- `feature/the-snapshot-entity-fill` — one snapshot in `registryd-main.ts`; the scan, PR reader, issue reader, default-branch beat and tick record their existing readings through `recordReading`; a `--once` test over the census fixture; a changeset <!-- builds: fleetd's in-memory RepoSnapshot filled by the existing tick -->

## Notes

- Phase 3 of the story [`nothing-changed-nothing-runs`](../stories/nothing-changed-nothing-runs/STORY-nothing-changed-nothing-runs.md); depends on `process-census-gate`.
- Line numbers checked against `origin/sprint/nothing-runs` at `8437242ef` on 2026-11-08. The story cites the board's per-beat reads at `fleet.ts:2836-2875`; `refresh` starts at `:2863`, the registry read is at `:2906-2912`, the bridge read at `:2927` and the supervisor read at `:2931`. The four fleetd loops sit at `registryd-main.ts:3251-3254`, as the story's Phase 1 bullet says.
- S3 and S4 figures are from the `process-census` job on CI run 42510574702 (`ee3541cff`, 2026-11-08).
- Definition of Done: docs/definition-of-done.md.
