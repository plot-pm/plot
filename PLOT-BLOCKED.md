PLOT-BLOCKED: Moving `idle` to the supervisor requires giving the daemon persistent state. Should it, or should the WorkerMonitor stay for `idle` alone?

## What is done

The slice's first half is implemented, tested and pushed: the AgentMonitor and
BuildMonitor are one loop over two subjects (`plot-agent-monitor.sh`), the
wrapper starts one monitor instead of two, `buildMonitorPid` is no longer
written, and the vendor list gained the two sourced siblings it was missing.

**A dispatched agent now runs four processes where it ran five** — wrapper,
agent, WorkerMonitor, slice monitor — so fleet control is `1 + 3N` against the
`1 + 4N` it was. The design's `1 + 2N` needs the WorkerMonitor gone, which is
the question below.

Measured after the merge: the monitor is alive while its subject lives, gone
4 s after it dies, and leaves no children. 72 of 72 monitor tests pass, 89 of
89 dispatch tests pass, and the shell/TS manifest byte-parity holds.

## The conflict

The brief says *"`WorkerMonitor`'s findings are reported by the supervisor's
tick"* — its findings being `gone` and `idle`.

**`gone` moves cleanly.** It is a one-sample finding, and the supervisor
already reads it: `SupervisionReadings.workerAlive` is exactly that question.

**`idle` does not.** `rules/sample.ts` requires `sample(previous, current)` —
the two-sample rule, with a tree fingerprint that must be unchanged BETWEEN
passes. The WorkerMonitor holds `prev_verdict` and `prev_tree` in process
memory, which its own comment calls *"one piece of state, derived rather than
recorded"*.

The supervisor cannot hold that. `registryd.ts:151` records the opposite as a
MEASURED property: *"It holds nothing between calls, and that was measured
rather than argued… a looping daemon was `kill -9`ed two seconds into a 3.4 s
tick and the next whole tick reached the identical decision. No state file was
written, because none is needed."* It also states *"no journal, no lock file
and no resume path"*, and the tick never writes a manifest today.

So reporting `idle` from the tick needs one of:

1. **A state file or manifest field per agent per tick.** This gives the daemon
   its first persistent state and ends the property above — recovery and normal
   operation stop being one code path.
2. **The WorkerMonitor stays, for `idle` alone.** Fleet control lands at
   `1 + 3N` rather than the `1 + 2N` the design sets.
3. **`idle` is dropped as a finding.** Cheapest, and it removes observation —
   which `DESIGN-process.md` §0 rules out: *"the cheapest topology is no
   monitors at all, and it is worthless."*

The brief settles the granularity trade (60 s versus seconds) but not this one,
and each option changes something the design states explicitly. Which?

## Why I did not choose

Option 1 rewrites a measured invariant the brief does not mention. Option 2
misses the slice's stated number. Option 3 deletes a finding the design
protects. Improvising here would decide a design question during
implementation, which is what this file exists to prevent.
