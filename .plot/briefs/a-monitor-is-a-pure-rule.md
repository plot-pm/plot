## Implementation brief — monitoring-is-a-domain-concept (slice: Sampling)

- **Plan (canonical):** `docs/plans/2026-08-30-monitoring-is-a-domain-concept.md` on `main`
- **Approved:** 2026-09-01, Jan Wloka, in-session
- **Branch:** `feature/a-monitor-is-a-pure-rule` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

First of three, and it needs **no clock** — it can start now, in parallel with
`the-pulse-is-an-entity`. Only the third slice (*Asking*) meets the pulse.

### What to build

The WorkerMonitor's two-sample judgement becomes `sample(previous, current)` in
`packages/domain/src/rules/`. **The script keeps its measurements and stops deciding.**

### The Measuring slice is already answered — fold it in, do not branch it

`feature/the-ports-read-activity-and-trees` asked whether any port must change. **Answered
2026-09-01: no.** `monitor_tree_fingerprint` (`plot-worker-monitor.sh:294`) is two readings
joined by a newline:

- `git rev-parse HEAD` → `Refs.resolve('HEAD')`
- `git status --porcelain` through `plot_worker_dirty_filter` → `Trees.markers(path, prefix)`

and `ProcessReading.activity` (`ports/processes.ts:26`) already carries the CPU reading. **So
the rule composes the fingerprint from ports that exist.** Put the argument in this PR; the
Measuring branch closes with no code, which its own text allowed for.

### The decisions the plan settles — do not re-derive them

**No clock, no sleep, no I/O in the rule.** The caller supplies both readings. The previous
sample is an **argument, not a field** — the loop owns the memory, which is what keeps the rule
a pure function of two values and testable without mocks.

**Readings as values, not ports** — `sample(previous, current)`, matching `rules/reapable.ts`
and `rules/eligible.ts`. Arrow functions (`export const f = (…) => …`) in the domain package.

**The dirty filter is load-bearing, not incidental.** The fingerprint goes *through*
`plot_worker_dirty_filter` because *"a fingerprint over raw `git status` would see the
monitor's own file appear"* — a monitor watching a desk it writes to. Compose through
`Trees.markers`, which applies the same prefix filter; do not re-implement it.

**`""` is not `idle`.** `monitor_activity` returns `""` for unknown, and the plan states the
consequence: collapsing that into `idle` *"is how a monitor invents a stall"*. A `PortResult`
distinguishes *cannot answer* from *no*, and the rule must too.

**One sample is enough for `gone`, and only for `gone`.** `monitor_pass:389` explains why: a
dead pid is not a transient reading the way a frozen CPU clock is, so requiring two passes
would delay the one certain finding by a whole interval. Preserve that asymmetry.

### Done when

- `sample(previous, current)` in `packages/domain/src/rules/`, unit-tested at the package
  threshold, **with no sleeping**.
- **Every finding the script publishes today is reproduced by the rule against the same
  readings.** Drive `monitor_pass` — it is deliberately sourceable for exactly this
  (`plot-worker-monitor.sh:450`).
- `monitor_pass`'s judgement is **gone** from the shell, not duplicated beside it.
- **The regression to lock: an agent with NO COMMITS is never `idle`.** The plan names this as
  the monitor's middle row and *"the condition most easily lost when a rule moves languages"*.
  Write that test first and watch it fail.
- `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  changeset (`'plot': patch` plus `'@plot-pm/domain': patch`, description first).

**Do not run `pnpm run test:e2e` locally** — CI's gate, its own machine.

**Prove the port test is discriminating.** Break the rule deliberately — make a no-commits
agent read `idle` — and confirm the new test fails. Three inert mutations were caught in this
repo on 2026-09-01 alone; a passing test against unchanged behaviour proves nothing.

### Bookkeeping

- Push the first real commit as soon as it exists — the ref push is the claim.
- When the PR exists, append `→ #<number>` to this branch's line under `## Branches`.
- **Never begin a line with a backticked branch name** in a Branches section: the loose matcher
  reads it as a claim, the anchored one does not, and `parser.test.mjs`'s estate-wide
  differential fails. It cost a red main on 2026-09-01.

### Scope guard

**This branch owns:** the new rule and its tests, `plot-worker-monitor.sh`'s judgement, and the
Measuring argument as prose.

**It does not own** the pulse, cadence, or how a monitor is triggered — a monitor here is still
called by the harness it has today. `the-pulse-is-an-entity` moves that, and its own text now
records that a pulse-ticked monitor cannot stay a child of the worker wrapper.

**In flight, 2026-09-01:** `feature/the-scan-reads-a-fleet-reading` (the `FleetPulse` →
`FleetReading` rename — **touches `ports/refs.ts`, which this slice reads**, so expect a
rebase), `feature/the-refusals-are-domain-rules` (`plot-dispatch.sh` + a domain rule),
`bug/a-test-teardown-does-not-call-rmsync` (41 test files).

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
