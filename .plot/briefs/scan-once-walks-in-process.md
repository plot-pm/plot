## Implementation brief — the-plan-walk-moves-into-the (wave: In-process)

- **Plan (canonical):** [docs/plans/2026-10-31-the-plan-walk-moves-into-the.md](../../docs/plans/2026-10-31-the-plan-walk-moves-into-the.md) on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/scan-once-walks-in-process` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR review channel: `pr`)

This is the fifth of eight slices. It waits on `feature/the-walk-assembles-the-reading` (#2991, merged). One slice waits on it in turn: `feature/the-walk-caches-by-oid` — the cache cannot start until `scanOnce` has an in-process call site to attach cache reads to.

### What to build

`scanOnce` (`packages/fleet/src/shared/fleet-scan.ts:633-786`) today spawns the shell: `await world.scripts.stream(FLEET_SCAN, ['--stream'], ...)` at `:717`, parsing `reading:`/`terminal:`/`listing:`/`spend:` lines off its stdout/stderr, inside a `timeoutMs: FLEET_SCAN_BUDGET_MS` (90 000 ms, `:48`) that the `Scripts` adapter enforces by killing the child process.

Replace that one call site with a direct, in-process call into the four already-merged domain stages — `readEstate`, `readBranchReadings`, `readDeskReadings` (all async, all under `packages/domain/src/workflows/`) and `assemblePlanWalk` (`plan-walk-assembly.ts:205`, synchronous) — then build `FleetReading` from the `Assembly` the same way `fleetReading` (`plan-walk-assembly.ts:436`) already does it. The board fallback's call path into `scanOnce` gets this for free; there's no separate wiring needed there.

**Do not reach for `PLOT_SCAN_WALK` or `plot-scan-walk.mjs`.** The assembly slice wired that switch, but only as a value `plot-fleet-scan.sh` reads to decide whether to exec a brand-new standalone process (`skills/plot/scripts/board/plot-scan-walk.mjs`, wrapping `packages/board/src/server/entry/scan-walk.ts`) for the shell's own CLI modes (`--json`, `--next`, etc). That is a separate subprocess, spawned by the shell, for a different caller. It gives `scanOnce` nothing to call — fleetd still can't import a subprocess. This slice's job is a second, independent call site: real adapters, called directly from TypeScript inside `fleet-scan.ts`, never touching the shell or that CLI wrapper.

### The decisions the plan settles — do not re-derive them

**The git-reading ports are already async — there is no conversion work here.** `readEstate`, `readBranchReadings` and `readDeskReadings` already return `Promise<PortResult<...>>` and already await their ports (`Refs`, `PlanStore`, `Trees`, `Agents`, `Processes`). The plan's "async git calls... no call blocks fleetd's event loop" requirement (Design point 3) is satisfied by code that already merged. Your work is sequencing four existing calls and handling their `PortResult` failures, not making anything async that wasn't.

**No cache. None.** The plan's own slice line is explicit: "with one beat budget, async git calls and the scan-attempt record, and no cache" — and Design point 3 repeats it: "The slice measures CPU with no cache." `feature/the-walk-caches-by-oid` is the *next* slice and owns every oid-keyed cache field in `ScanState`, the snapshot, and mark-and-sweep pruning. Every readthrough this slice does is a cold read, every beat, exactly like the shell was. Resist memoizing anything "since you're already in here" — that is the next slice's PR to write and review, and folding it into this one repeats the mistake the seams juror flagged on the original unsplit slice 1 (per the assembly slice's own brief).

**The 90-second budget has no process to kill anymore — build the in-process equivalent.** Today `FLEET_SCAN_BUDGET_MS` is enforced entirely by the `Scripts` adapter's spawn timeout: no other code in `fleet-scan.ts` watches a clock. Once the walk is a sequence of in-process `await`s, nothing kills a hung `git` call for you. Wrap the walk's four-stage sequence in your own bound (`Promise.race` against a timer, or an `AbortController` threaded into the ports if they already accept one — check before adding a new port parameter) so a beat that exceeds `FLEET_SCAN_BUDGET_MS` fails the same way a killed subprocess used to: `scanOnce` throws, the bridge keeps its last good write (the existing `finally` discipline already does this for the thrown-error path), and fleetd's heartbeat keeps running. The plan's Done-when asks for a test proving exactly this: "a beat that exceeds its budget ends with a failure and leaves the heartbeat running."

**The scan-attempt record is `writeScan`'s existing `attempt` field — write it the same way.** `writeScan` (`fleet-scan.ts:802-820`) already writes `attempt: { startedAt, endedAt: at, outcome: 'ok', error: null }` to the bridge, called only after `scanOnce` returns (never after it throws). Keep that contract: a successful in-process walk writes the same shape; a thrown error (budget exceeded, or any stage failing) means `writeScan` is never called for that beat, same as today. `packages/domain/test/scan-owner.test.ts` already exercises this shape at the rule level (`fleetOwnsScan`, `ownedBridgeNote`) — extend it if the in-process path needs a new scenario, don't rewrite it.

**Build the `Scripts`-fails fake yourself; none exists yet.** The plan's Done-when wants "a `scanOnce` test with a `Scripts` fake that fails on any `plot-fleet-scan.sh` call." No such fake exists in the repo today (checked: only an unrelated fake in `packages/fleet/test/unit/auto-deliver.test.ts`). Write a minimal `Scripts` port implementation whose `stream`/`start`/etc. throw if called with `FLEET_SCAN` (`'plot-fleet-scan.sh'`) or any argument naming it, and assert `scanOnce` under the new code path never touches it. That test is the proof this slice actually removed the spawn rather than leaving it as a fallback.

**The listing read (PR backoff, `readGithubListing`/`readBitbucketListing`) is untouched.** `scanOnce`'s first half — everything before the `try { await world.scripts.stream(...) }` block — already reads the PR listing host-side with its own backoff/spend logic, independent of the shell spawn. Leave it exactly as it is; only the walk-producing block changes.

### Done when

The plan's `## Done when` (In-process bullets) is the specification:

- A `scanOnce` test with a `Scripts` fake that fails on any `plot-fleet-scan.sh` call passes.
- `pnpm --filter @plot-pm/domain exec vitest run test/scan-owner.test.ts` passes with an in-process attempt record.
- A test shows a beat that exceeds its budget ends with a failure and leaves the heartbeat running.
- CPU per beat is reported against the 28–30 s shell baseline (measured in the plan's Motivation section) — a warm in-process beat with no cache is expected to still cost real CPU (no caching yet), but should not regress past the shell's own cost; report what you measure.

Plus: the repo's gates — build artifacts (no committed `board-server.mjs` diff), a changeset naming `plot` or `@plot-pm/board`, and the usual TypeScript/domain gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps changed paths (`packages/fleet/**`, `packages/domain/**`) to the right suites and gate tests. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. List no full suite here.

This slice touches no `.sh` file under `skills/` (the call site change is entirely in `packages/fleet/src/shared/fleet-scan.ts` and `packages/domain`), so `scripts/check-shell-lines.sh` should have nothing to ratchet — confirm this stays true; if a change does touch shell, the growth is paid for in the same change per that gate's usual rule.

### Bookkeeping

Open the PR through the controller once real work exists:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Never `gh pr create` directly. Push the first real commit as soon as it exists — do not wait for the whole slice to be done before the branch shows activity.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`feature/scan-once-walks-in-process` under `### In-process`).

### Scope guard

This branch owns: the `scanOnce` call site in `packages/fleet/src/shared/fleet-scan.ts` (replacing the `world.scripts.stream(FLEET_SCAN, ...)` block), the in-process beat-budget mechanism, the `Scripts`-fails-on-shell-call test fake, and whatever `scan-owner.test.ts` additions the in-process attempt record needs.

It does not own: the four domain workflow stages themselves (`readEstate`, `readBranchReadings`, `readDeskReadings`, `assemblePlanWalk` — all merged, all `feature/the-walk-*` slices), the `PLOT_SCAN_WALK` shell switch or `plot-scan-walk.mjs` (assembly slice, merged, serves only the shell's own CLI modes), any oid-keyed cache or `ScanState` cache fields (`feature/the-walk-caches-by-oid`, the next slice, currently blocked on this one), and the CLI-modes/pulse-log slices that follow (both wait on the cache slice, not on this one directly).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
