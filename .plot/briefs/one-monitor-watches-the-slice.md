## Implementation brief — one-monitor-watches-the-slice (slice: The fleet runs lean)

- **Plan (canonical):** `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md` on `main`
- **Design:** `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md` §8
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/one-monitor-watches-the-slice` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 merged as **#708** (an agent is started by a command).

## What this delivers

Three per-agent monitors become one, taking fleet control from `1 + 4N` to the `1 + 2N` the design sets.

**At three agents: seven processes instead of thirteen.** Measured against `DESIGN-machine.md`'s own numbers, halving the per-agent count is the difference between a machine holding five agents and holding ten.

## The rule is already one; only the loop is three

`packages/domain/src/rules/sample.ts` exports `sample(previous, current)` and `publication(...)`. `monitoring-is-a-domain-concept` is **Released**. `plot-monitor-subject.sh` calls itself *"the ONE answer to 'is this monitor's subject still there?'"* and is sourced by two of the three.

**What differs is the subject, not the logic** — read from the live logs 2026-09-05:

| monitor | findings | subject |
|---|---|---|
| `plot-worker-monitor.sh` | `gone`, `idle` | the **process** |
| `plot-agent-monitor.sh` | `clear`, `owes a review`, `owes an answer`, `holds unlanded work` | the **desk** |
| `plot-build-monitor.sh` | `build passed`, `build failed`, `head moved` | **CI** |

All four scripts still exist on `main` (verified 2026-09-06), `plot-monitor-subject.sh` among them.

## The split follows the findings, not the file layout

**`WorkerMonitor` MOVES TO THE SUPERVISOR**, which already reads what it reports: session, tokens and cost became manifest fields when `an-agent-remembers-its-session` and `an-agent-knows-what-it-spent` landed, and the supervisor re-reads every manifest each tick. One process per agent duplicating a read one process already makes.

**`AgentMonitor` and `BuildMonitor` MERGE** into one loop with two subjects — the desk and CI. Both are genuinely per-slice, because the slice is.

## The trade is granularity, and it is accepted

The supervisor ticks at **60 s** where `WorkerMonitor` samples faster. Measured 2026-09-04: four agents sat wedged for **6–8 hours** at 0.3–0.7 s of CPU and nothing noticed, because no supervisor was running. 60 s would have found them with room to spare.

**A prompt that dies in ten seconds is noticed one tick later than today.** The cost of that miss is bounded by the tick; the cost of N duplicate readers is paid continuously.

## What this must not become

**Removing observation.** `DESIGN-process.md` §0 is explicit: *"the cheapest topology is no monitors at all, and it is worthless."* The aim is one watcher doing what three did, not none.

**The monitors must still end themselves.** `monitors-end.test.mjs` asserts *"after its subject finishes, no monitor of THAT worker remains"* — there is no parent to reap them, so each watches its subject's pid and exits. That property survives the merge.

**The manifest is the hierarchy.** `wrapper`, `wmon`, `amon`, `bmon` and `pid` are recorded fields; the wrapper spawns and exits, owning nothing. Whatever fields change, the manifest must still name every process the fleet started, or `plot-fleet --stop` cannot find them.

## Done when

- one monitor process per agent, not three
- `WorkerMonitor`'s findings are reported by the supervisor's tick
- the desk and CI subjects are watched by one loop
- the monitor still exits when its subject does, and `monitors-end.test.mjs` passes
- the manifest names every process that exists
- `pnpm test` and `pnpm run test:reconcile` pass

## Do not

- **Do not add a monitor for the supervisor.** `DESIGN-process.md` §8: that is launchd's and systemd's question, settled by `the-machine-keeps-the-daemon-alive`.
- **Do not give the supervisor a shorter tick to compensate.** 60 s against a 3496 ms tick is 6% duty; the granularity trade is stated and accepted.
- **Do not leave an orphaned process kind in the manifest schema** with nothing writing it.
- **Do not run `pnpm run test:e2e`** — it dispatches real workers, and this slice changes what a worker spawns. CI is its gate, and this is exactly the change where a local run costs the machine most.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc` if you touch it.
