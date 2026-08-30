# What ends a monitor

**Measured 2026-08-30, before the fix, on the branch
`bug/a-monitor-ends-with-its-agent`.**

The plan's Ending slice makes this its first done-when: *"the exit path is
established first, in writing: which process ends the monitors today, on the
ordinary path and on the `Worker bound` path, with the commands that show it. A
negative result is a finding."*

It is a done-when rather than a courtesy because of what the plan already knew
and could not explain: **one timed-out run's monitors were terminated by
something nobody could identify.** Three explanations had been tested and all
three failed. A cleanup bolted onto a mechanism nobody understands is how the
same processes come back under a different parent — so the mechanism is
established here first, and the fix is designed against what it says.

## The answer, in one line

**Nothing ends them.** On both paths, both monitors are re-parented to `init`
and loop forever. The occasional `Terminated: 15` is a **process-group kill
aimed at the dispatching shell** that reaches them collaterally — not a cleanup,
and not something the fix may rely on.

## Path 1 — the ordinary finish

The agent exits, the wrapper's `wait "$agent"` returns, the wrapper writes
`.plot-worker.exit` and exits. Reproduced in the wrapper's exact shape from
`plot-dispatch.sh:600` — `nohup sh -c`, two monitors backgrounded first, the
agent backgrounded next, `wait` on the agent alone:

```sh
( PLOT_EXIT_FILE=/tmp/m1/exit PLOT_PID_FILE=/tmp/m1/pid \
  nohup sh -c '/tmp/m1/mon.sh & echo "monA=$!" >> /tmp/m1/pids;
               /tmp/m1/mon.sh & echo "monB=$!" >> /tmp/m1/pids;
               ( sleep 3 ) & agent=$!;
               printf "%s" "$agent" > "$PLOT_PID_FILE";
               wait "$agent"; rc=$?;
               printf "%s" "$rc" > "$PLOT_EXIT_FILE"' \
  >/tmp/m1/wrapper.log 2>&1 </dev/null & echo "wrapperpid=$!" >> /tmp/m1/pids )
sleep 6
for p in $(grep -oE '=[0-9]+' /tmp/m1/pids | tr -d '='); do
  ps -o pid=,ppid=,command= -p "$p" 2>/dev/null || echo "$p GONE"
done
```

Result:

```
35246 GONE                              ← wrapper
35289     1 /bin/sh /tmp/m1/mon.sh      ← monitor A, ppid=1, still ticking
35290     1 /bin/sh /tmp/m1/mon.sh      ← monitor B, ppid=1, still ticking
35291 GONE                              ← agent
exit file: 0
```

**Both monitors survive both the agent and the wrapper**, with no parent left to
notice. This is unconditional: there is no exit condition anywhere in either
monitor. Both are `while :; do sleep "$interval"; noop_pass; done`
(`plot-worker-monitor.sh`, `plot-agent-monitor.sh`), and neither ever reads the
agent's pid.

## Path 2 — the `Worker bound` timeout

`plot-worker-loop.sh:172` sends `kill -KILL` to the **agent**, not the wrapper.
Reproduced by killing the agent with `-9` while the wrapper waits:

```
40159 GONE                              ← wrapper
40161     1 /bin/sh /tmp/m1/mon2.sh     ← monitor A, ppid=1
40162     1 /bin/sh /tmp/m1/mon2.sh     ← monitor B, ppid=1
40163 GONE                              ← agent
exit file: 137
```

**Identical.** The exit file holding `137` is itself the proof of the plan's
withdrawn claim: the wrapper survived the agent's SIGKILL and wrote the record
afterwards, which a killed wrapper could not have done.

## The estate, unprompted

At the time of measurement, with no experiment running:

```
$ ps -eo pid,ppid,command | grep -E 'plot-(worker|agent)-monitor\.sh' | grep -v grep | wc -l
40
$ ... | awk '$2==1' | wc -l
34
```

**34 of 40 orphaned.** The six with a live parent are children of wrappers whose
agents are still running — the healthy case, and the shape the fix preserves.

## The fourth explanation: `Terminated: 15`

The plan tested three explanations for the one run whose monitors *were*
terminated, and all three failed. Here is a fourth, and it holds.

**`nohup` does not call `setsid`.** It detaches from SIGHUP and, once the parent
exits, from the parent — but the orphan **keeps the process group of the shell
that dispatched it**:

```
$ ps -o pid=,ppid=,pgid=,sess=,tty=,command= -p 47769
47769     1 47725      0 ??  /bin/sh /tmp/m3/mon.sh
$ ps -o pid=,ppid=,pgid= -p $$
47725  7592 47725                        ← the dispatching shell: pid == pgid
```

The orphan's `pgid` is the dispatcher's pid. So a **group** kill reaches it,
without anyone naming it:

```
$ kill -TERM -47725      # negative pid = the whole process group
$ ps -p 47769 || echo GONE
GONE
```

**This explains every failed hypothesis at once.** The killer was never `sh`
signalling its background jobs, never a `kill` inside `plot-dispatch.sh`, and
the pids were never in either hand-killed orphan list — because whoever ended
that session's process **group** (a terminal closing, a Ctrl-C, a supervisor
tearing down its group) swept them up as collateral, having never referred to
them individually. `Terminated: 15` is SIGTERM's exact signature.

**And it is a finding against relying on it.** Collateral death from someone
else's teardown is not a lifetime. It fires when a human closes a window and
never when a worker finishes, which is the opposite of the property the plan
wants. The fix must be the monitor's own, and must not depend on group
membership it neither sets nor controls.

## What this rules out for the fix

- **Not the wrapper killing its children on exit.** The wrapper's exit is
  already the last thing that happens; a `trap` there would fire after
  `.plot-worker.exit` is written, which is late but workable — except that it
  cannot run at all if the wrapper is itself SIGKILLed, and it would put the
  teardown in the largest script in the repo rather than in the two processes
  that own their own lifetime.
- **Not a timer.** The plan forbids it outright, and this measurement says why:
  a monitor that exits after N seconds regardless is indistinguishable from one
  that died, which is the exact confusion the whole design exists to remove.
- **Not the process group.** It is not the monitor's to set, and setting it
  (`setsid`) would make the orphans *harder* to sweep by hand, not easier.

**What remains is the monitor watching its own subject.** The agent's pid is
already written to `.plot-worker.pid` by the wrapper, before either monitor's
first interval elapses. A monitor whose subject is gone has nothing left to
measure, and can say so and stop. That is a measurement, not a timer — it reads
the process table, the same source `plot-worker-state.sh` reads — and it keeps
the lower bound intact, because the check happens *after* the pass that
publishes.

## Related

- The orphans that belong to **no worktree at all** are the same defect from
  before this branch and are out of its scope, per the slice's scope guard.
  None were observed in this measurement: all 34 orphans named a live worktree.
