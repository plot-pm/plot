---
'plot': minor
---

Every dispatched worker is born with two monitors attached.

`start_worker()` starts a WorkerMonitor and an AgentMonitor inside the worker's
wrapper, immediately before the agent. Both are **no-ops in this slice**: each
publishes `nothing measured yet` and samples nothing. The attachment is the
deliverable — the measurements arrive in their own branches, behind a dispatch
change already proven.

**The monitors are children of the wrapper, not siblings of it.** The wrapper
already outlives its agent by construction — it must, or there would be no exit
code to write — so a child inherits that survival for free. Two processes
started side by side are independently mortal: the monitor could be killed or
crash with nothing noticing, which is the failure being fixed one level up.
`--stop` kills the agent; the monitors and the exit record survive it, asserted
against that operation rather than argued for.

**The no-op announces itself, and that is the point.** A monitor that is
attached and silent looks exactly like one that is watching and has nothing to
report, and an operator would read it as the second. The string disappears in
the slice that gives each monitor its first real measurement.

**`start_worker` is the single path to a worker, so this is a gate rather than
a rule** — there is no other place to forget. Asserted by mutation: the monitor
start is cut from a copy of `plot-dispatch.sh` and the same dispatch is run
against it. Verified by sabotaging the real script — four of six tests turn red,
and the mutation test itself fails fast when its own sabotage stops matching.

Findings are published to `.plot-worker.monitor.*.jsonl`, named so
`plot-worker-state.sh`'s existing `PLOT_WORKER_RECORD` prefix already excludes
them from both the dirty-tree filter and the marker search. Any other name would
make every monitored worktree read as holding unlanded work — `stalled` for a
fleet that is perfectly healthy.

`--dry-run` output stays **byte-identical**, verified against three plans
including one exercising the held-branch refusal. The naming of what would be
attached lives behind `--monitors`, opt-in, because diffing the default dry run
against a pre-change run is this slice's protection on a 2028-line script where
a mistake starts no workers at all.

Both monitors join the board's vendored-script list. They are resolved as
`$script_dir` siblings of `plot-dispatch.sh`, so in the npm layout they must sit
beside it; missing, they do not crash — `start_worker` passes an empty path and
the wrapper starts an **unmonitored** worker, which is the silent degradation
this slice exists to prevent.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
