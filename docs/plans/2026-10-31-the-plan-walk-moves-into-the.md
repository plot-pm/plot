# The plan walk moves into the domain

> fleetd's scan gathers its readings in one in-process domain walk, re-reads only the git answers whose object ids changed, and `plot-fleet-scan.sh` becomes a launcher for every caller mode.

## Status

- **State:** Approved
- **Type:** feature
- **Issue:** #2980
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Started:** 2026-10-31, Jan Wloka, `feature/the-walk-reads-the-estate`
- **Started:** 2026-10-31, Jan Wloka, `feature/the-walk-reads-the-branches`
- **Started:** 2026-10-31, Jan Wloka, `feature/the-walk-reads-the-desks`

## Changelog

- fleetd's scan runs in-process as a domain walk with batched git reads, and a beat on an unchanged repository re-asks git nothing it already knows. `plot-fleet-scan.sh` keeps every caller mode as a launcher.

<!-- Board impact: the board fallback calls the walk in-process instead of spawning the scan; the pulse, the bridge and the streamed rows keep their shape, proved by the assembly slice's comparisons. No plan format or template change. -->

## Motivation

`skills/plot/scripts/plot-fleet-scan.sh` (5438 lines, 51 functions, 2208 lines by `scripts/check-shell-lines.sh --per-file`) re-derives every reading on every beat.

Measured 2026-10-31, CPU as user + sys from `/usr/bin/time -p`:

- A scan costs 27.7 to 30 s CPU at load 8 to 10.
- `origin/main` moved 182 times in 24 hours; fleetd scans about once a minute, so most beats see no change.
- `git for-each-ref` (454 refs) and `git ls-tree -r origin/main -- docs/plans` (1244 entries) each cost under 0.01 s CPU.
- One `git cat-file --batch` over all 621 plan blobs costs 0.03 s CPU. One `plot-plan-meta.sh` parse of all 620 plans costs 0.52 s CPU.

So the cost is not the parse. It is per-plan process starts and per-pair git calls (#2979 measured 15.6 s in the merge-subject loop and 7.7 s in ancestry), which one process with batched reads removes before any cache exists. Plan `the-fleet-scan-re-reads-what` (#2979, issue #2978) cuts the per-plan starts inside the shell; this plan moves the walk.

## Design

### Approach

1. **The walk has one shape.** Pure synchronous domain stages take readings as values and compose the rules that exist today: `sliceVerdicts` and `waitVerdict` (`rules/eligible.ts`), the branch-state, merge-subject and verdict rules the shell already calls through `plot-branch-state.mjs`, `plot-merge-subject.mjs` and `plot-verdicts.mjs`, `agentState` and `deskState`. The walk adds enumeration and reading, and no verdict arithmetic. One async gatherer reads through the ports (`Refs`, `PlanStore`, `Trees`, `Host`, `Processes`, `Desk`, `Agents`) and hands the stages their readings.
2. **The walk is cut at the seams the shell already has.** Estate (plans from the ref, branch-only plans, the index, the parse), branch readings (refs, ancestry, merge subjects, landed commits, conflicts, changed paths), desks (worktrees, worker, markers, quiet time), assembly (rows and output modes). Each slice has a byte-comparable oracle. A `PLOT_SCAN_WALK=shell|domain` switch selects the walk while both exist, so the 31 `test/reconcile/` files that spawn the scan run against both.
3. **`scanOnce` calls the walk in-process before any cache.** fleetd and the board fallback call the walk from `scanOnce` (`packages/fleet/src/shared/fleet-scan.ts:717`) and stop spawning the shell. One time budget covers the whole beat and every git call honours it. Every git call is async, so no call blocks fleetd's event loop or heartbeat. The walk keeps writing #2979 slice 2's scan-attempt record. The slice measures CPU with no cache.
4. **The cache holds answers keyed by object id, in fleetd's `ScanState`.** The input table below sets the rule for each reading. Rules:
   - A cached answer is a function of the objects in its key, read through those oids and never through a ref name.
   - `unknown` and failed reads are never cached.
   - Ancestry entries are refused on a shallow repository or when `refs/replace` is not empty.
   - A parse key holds the blob oid, a hash of the parser file on disk, and a digest of the Plot Config. A parse cache ships only if the measurement in slice 6 shows it pays.
   - After each completed beat, entries no reading touched are removed (mark and sweep), so the cache is bounded by the live estate.
   - The dirty set bounds reads only. Verdicts stay a function of all readings on every beat, and every output carries every plan.
   - The board fallback runs cold. The cache is not shared with `plot-dispatch.sh --list-eligible`, which stays an independent check that can only refuse a start.
5. **The script becomes a launcher in three steps.** The read-only CLI modes go through one node entry. `--log-pulse` and its writes move. Then the shell walk is removed and the corpus pairs that compare the domain with itself retire by name. `plot-fleetctl.sh` recognises the new scan process before the shell walk goes.

### Inputs

From the #2979 safety verdict (`.plot/panels/the-fleet-scan-re-reads-what/safety.md` on `origin/main`, section 2):

| Rule | Inputs |
|---|---|
| Object-id key | `origin/<main>` tip with each main-relative reading keyed by (main oid, branch oid); remote and local refs, where creation and deletion count as moves; the plan tree with modes and symlink targets; plans only on a prefix branch (the set is recomputed when any prefix ref moves); the parse (blob oid, parser hash, config digest); merge subjects (raw subject only); the commits that added each plan |
| Every beat | the fetch result; `remote.origin.url` and the host backend; the Plot Config; `PLOT_PR_LISTING` and `PLOT_TERMINAL_CACHE`; `git worktree list`; each worktree's status and lock; worker pid, exit, registry and process table; `PLOT-*` markers; log and file mtimes and `now` |
| Derived every beat | cross-plan `waits:` edges, through verdicts over all readings |
| Output only | the previous `last-pulse.json`, read for the delta |

### Decisions

- **`plan-store-ref.ts` is fixed in slice 1.** It reads plans through the ref name `origin/main`, calls the parser without `--prefixes`, and returns an empty list for an unreadable tree where the scan falls back to the working tree (`plot-fleet-scan.sh:2716`). Slice 1 reads by oid, passes the configured prefixes, and reports an unreadable tree as a failure.
- **New port operations:** a parse of plan text read by blob oid (`PlanStore`), a batched `containsMany` (`Refs`), ref-to-oid pairs with symlink targets for the snapshot (`Refs`), and one whole-config read.
- **The sourced shell stays.** `plot-worker-state.sh`, `plot-plan-meta.sh` and their corpus pairs (`agent-state`, `desk-waits-free`, `tree-reading`, `plan-store`) stay, because other scripts still call them.
- **`Refs.pulse()`** calls the walk once the read-only CLI slice lands; its one caller is `adapters/sprint-scope-ref.ts:103`.
- **The duplicate lives until the removal slice.** The shell walk is the declared duplicate while any caller mode still runs it; the release boundary does not matter.
- **Bitbucket.** The branch-readings slice proves the Bitbucket merge-subject form (`Merged in <branch> (pull request #N)`) on a sandbox fixture, and the read-only CLI slice names the listing reader per host for callers with no carried listing: fleetd's `readGithubListing` and `readBitbucketListing`.
- **Merge and delivery stay out of reach.** `plot-ask.mjs merge` and `plot-pr-merged.sh` ask the host again.

## Slices

### Estate

- `feature/the-walk-reads-the-estate` — the estate stage: plans from the ref by oid, branch-only plans, the index links and the parse, with the `PlanStore` parse-by-oid operation and the `plan-store-ref.ts` fixes <!-- waits: feature/the-subject-walk-skips-settled-plans --> <!-- builds: planWalk estate stage --> → #2987

### Branch readings

- `feature/the-walk-reads-the-branches` — the branch-readings stage: refs, batched ancestry (`containsMany`), merge subjects on both hosts, landed commits, conflicts and changed paths <!-- waits: feature/the-walk-reads-the-estate --> <!-- builds: planWalk branch-readings stage --> → #2988

### Desks

- `feature/the-walk-reads-the-desks` — the desk stage: worktrees, worker state, markers, unpushed commits and quiet time <!-- waits: feature/the-walk-reads-the-branches --> <!-- builds: planWalk desk stage --> → #2989

### Assembly

- `feature/the-walk-assembles-the-reading` — the assembly stage composes the existing rules into rows and the `FleetReading`, behind `PLOT_SCAN_WALK=shell|domain`, and records which readings each caller mode consumes <!-- waits: feature/the-walk-reads-the-desks --> <!-- builds: planWalk assembly and the walk switch -->

### In-process

- `feature/scan-once-walks-in-process` — `scanOnce` calls the walk in-process for fleetd and the board fallback, with one beat budget, async git calls and the scan-attempt record, and no cache <!-- waits: feature/the-walk-assembles-the-reading -->

### Cache

- `feature/the-walk-caches-by-oid` — the per-beat snapshot and the oid-keyed caches in `ScanState`, with mark-and-sweep pruning and the full-versus-incremental corpus <!-- waits: feature/scan-once-walks-in-process --> <!-- builds: beat snapshot and oid caches -->

### CLI modes

- `feature/the-scan-modes-run-the-walk` — `--json`, `--next`, `--list-eligible`, `--why-nothing`, `--slice-names`, `--loose` and `<slug>` run through one node entry, `--offline --next` keeps its host ask, `Refs.pulse()` calls the walk, and `plot-fleetctl.sh` recognises the new scan process <!-- waits: feature/the-walk-caches-by-oid -->

### Pulse log

- `feature/the-pulse-log-runs-the-walk` — `--log-pulse` runs the walk and keeps its bridge write and its pulse line in each reported plan's `## Notes` <!-- waits: feature/the-scan-modes-run-the-walk -->

### Removal

- `feature/the-scan-script-is-a-launcher` — remove the shell walk, retire by name the corpus pairs that compare the domain with itself, and shrink `plot-fleet-scan.sh` to a launcher <!-- waits: feature/the-pulse-log-runs-the-walk -->

## Done when

Comparisons run with `--offline`, no host token, no `PLOT_PR_LISTING` and no `PLOT_TERMINAL_CACHE`, and normalise with `jq -S 'walk(if type=="object" then del(.changed_ago_seconds) else . end)'`; `changed_ago_seconds` and `worker_activity` compare by the tolerance in `packages/domain/corpus/README.md`. CPU is user + sys from `/usr/bin/time -p` with the load, against the 28 to 30 s baseline.

- **Estate:** `pnpm --filter @plot-pm/domain exec vitest run corpus/plan-walk-estate.corpus.test.ts` passes: the stage's plan set and records equal `readEstatePlanMeta` and `readSliceNames` in `corpus/production.ts` on the pinned clone. Adapter tests prove the `plan-store-ref.ts` fixes.
- **Branch readings:** `pnpm --filter @plot-pm/domain exec vitest run corpus/plan-walk-readings.corpus.test.ts` passes: the stage's readings byte-equal the shell's stdin to `plot-merge-subject.mjs` and `plot-branch-state.mjs`, on the pinned clone and on a Bitbucket-form sandbox.
- **Desks:** `PLOT_SCAN_WALK=domain node --test` over the named desk files in `test/reconcile/` passes, with sandbox fixtures for a live desk, a dead worker, a lock and each marker.
- **Assembly:**
  - `PLOT_SCAN_WALK=domain node --test test/reconcile/fleet*.test.mjs test/reconcile/scan*.test.mjs` passes.
  - The normalised `--json`, `--list-eligible`, `--slice-names`, `--next` and `<slug>` outputs equal the shell's on the pinned clone.
  - The slice records which readings each mode consumes.
- **In-process:**
  - A `scanOnce` test with a `Scripts` fake that fails on any `plot-fleet-scan.sh` call passes.
  - `pnpm --filter @plot-pm/domain exec vitest run test/scan-owner.test.ts` passes with an in-process attempt record.
  - A test shows a beat that exceeds its budget ends with a failure and leaves the heartbeat running.
  - CPU per beat is reported against the baseline.
- **Cache:**
  - A full-versus-incremental corpus test passes over successive states built in temporary repositories:
    - main moves while a branch stays;
    - a ref is pruned;
    - an `active/` link is retargeted;
    - a `waits:` prerequisite merges;
    - a listing row changes only CI or draft;
    - an unreadable commit becomes readable;
    - the branch prefixes change;
    - the parser file changes.
  - A race test moves a ref between the snapshot and the reads, and finds no entry whose key differs from the oid read.
  - A test proves the cache holds no `unknown`.
  - A prune test shows the entry count returns to the live estate's after a plan is removed.
  - A warm no-change beat costs at most 2 s CPU at load up to 10.
  - The slice records how many beats in one hour of fleetd changed any reading.
- **CLI modes:** each mode's normalised output equals the shell walk's on the pinned clone, and `node --test test/reconcile/fleetctl.test.mjs` passes with the new process argv.
- **Pulse log:** a test of `--log-pulse` reads `last-pulse.json` and the plan's `## Notes` line after one run.
- **Removal:**
  - `scripts/check-shell-lines.sh --per-file` reports at most 25 lines for `plot-fleet-scan.sh`.
  - Each retired corpus pair is named in the commit.
  - The remaining corpus tier passes in CI.

## Notes

- Source: issue #2980. Related: `the-fleet-scan-re-reads-what` (#2979, issue #2978), which ships first, and `2026-10-26-the-fleet-scan-re-reads-all` (Released), which owns the PR listing's cost.
- Panel round 1, 2026-10-31: unanimous amend (layering, safety, testability, seams); verdicts and moderation in `.plot/panels/the-plan-walk-moves-into-the/`.
- Corpus files that reach the scan through `corpus/production.ts`: `branch-state`, `branch-state-waits`, `branch-state-waits-open-pr`, `eligible`, `finished-estate`, `refs`, `scan-listing`, `tracked-branches`. The removal slice retires each that compares the domain with itself; `scan-listing` and `tracked-branches` stay while the shell listing code stays.
- Definition of Done: docs/definition-of-done.md
