PLOT-BLOCKED: The three monitors cannot be merged in the shell as written, and moving `idle` to the supervisor needs a design decision. How should this slice proceed?

## What ships on this branch

One real fix, independent of the merge: **two sourced helper scripts now travel
with the npm package.** `plot-monitor-subject.sh` was vendored by nothing, and
all three monitors source it — without it `plot_monitor_wait` is undefined, the
`while` driving every monitor's loop fails on its first call, and a monitor
takes one pass and exits. A worker then reads as monitored and is watched by
nothing after its first second. `plot-transcript-quiet.sh` was vendored but
listed in neither `.gitignore` nor `files`, so it was committed as source.

**The monitor merge itself is reverted.** The reasons are below, and both were
found by measurement rather than argued.

## Blocker 1 — merging AgentMonitor and BuildMonitor in one shell does not work

Both scripts define `monitor_pass`, `sample_finding`, `publish` and
`json_escape`, and both assign `published`, `since`, `findings`, `interval`,
`monitor`, `worktree`, `pid_file` and `once` at module level.

Sourcing the second into the first was tried, saving and restoring the collided
variables around the source. It got close — `--once` worked, the monitor ended
with its subject in 3 s leaving no children, and 72 of 72 monitor tests and 89
of 89 dispatch tests passed — but **CI's e2e suite failed six cases**, and the
trace shows why:

```
+ run_desk_pass
+++ monitor_run_for_sha 4606e3a…      ← the BUILD monitor's host call
```

`desk_pass` was copied with `declare -f` before the source, but **a function
body binds its callees at CALL time**. The copied desk pass still calls
`sample_finding`, which after the source is the build monitor's. Copying the
outer function does not copy the three callees under it, so the desk subject
silently ran the build subject's sampler and published nothing — *"no monitor
was attached"*, six times.

Fixing that properly means copying every shared callee under a prefix and
rewriting the copied bodies to call the copies. That is a source transformation
over two 500-line scripts, and it is not a change I will improvise.

**Two smaller options exist and both are decisions rather than mechanics:**

1. **Rename the collided functions in one script** so the two can coexist —
   a real refactor of a tested file, but a readable one.
2. **Leave them as two processes.** Fleet control stays `1 + 4N`, and the
   slice's number is not met.

Also measured on the way: the build subject's host call is UNBOUNDED, which
cost only its own process when it had one. In a shared shell it holds the desk
subject and the death check behind it.

## Blocker 2 — `idle` cannot move to the supervisor as the brief describes

The brief asks that *"`WorkerMonitor`'s findings are reported by the
supervisor's tick"* — its findings being `gone` and `idle`.

**`gone` is already the supervisor's**, and in better words: `workerAlive` is
that question, and a dead worker yields `reap`/`correct`/`needs-a-person`/
`defer`, each more actionable than `gone`.

**`idle` does not move.** `rules/sample.ts` requires `sample(previous, current)`
— a two-sample rule with a tree fingerprint unchanged *between* passes. The
WorkerMonitor holds that in process memory. `registryd.ts:151` records the
opposite as a **measured** property: *"It holds nothing between calls… No state
file was written, because none is needed"*, and *"no journal, no lock file and
no resume path"*.

So it needs a state file (ending a measured invariant), or the WorkerMonitor
stays, or `idle` is dropped — which `DESIGN-process.md` §0 rules out.

## What the plan did not anticipate

**The monitors are not attached on this estate at all.** Measured 2026-09-06:
18 worker loops running, zero monitors, and no manifest carrying `wrapperPid`
or any `*MonitorPid`. Those agents were started through the registry/supervisor
path, which attaches none. The `1 + 4N` the plan describes is not what is
running here, so the saving is real only for `start_worker()`-dispatched
agents.
