---
"@plot-pm/board": patch
---

plot: the agent panel names the agent, not the dispatcher

Wave 1 of *the agent panel shows the agent*. Measured on the live board: the
panel headed `Agent bug/the-scan-walks-history-in-one-call` reported
`PID 58282`, `STATE running`, and an empty log — and `ps -p 58282` was
`plot-dispatch.sh`, the dispatcher. The agent doing the work was a different
pid entirely. Every field was read correctly off the wrong process.

`plot-dispatch.sh` recorded `$!` of the backgrounded `sh -c` **wrapper**, which
is one process removed from the agent the command runs. The fix backgrounds the
command *inside* the wrapper so the wrapper can capture its own child's pid and
write **that** to `.plot-worker.pid` — the wrapper is the one thing that knows
its child, so a `pgrep` by command string (the failure this repo already
recorded as *wait on your own PID, not a process name*) is avoided. Because the
real `Worker command` is a single command, the shell exec's it in place and the
recorded pid is the agent directly; `ps -p <pid>` now names it.

The wrapper's own pid is **kept**, under `.plot-worker.wrapper.pid`, because the
wrapper is what `wait`s on the agent and records the run's exit code in
`.plot-worker.exit` — that must keep working, and now `--stop` kills the agent
while the wrapper survives to record the code. Two pids with two names beats one
pid with the wrong meaning. Everything downstream — the panel's PID, uptime and
`--status`/scan liveness — reads that one record, so fixing the write fixes them
all with no schema change.

The empty-log message stops guessing about the worker. *"The log is empty — the
worker has started and written nothing yet"* read the empty FILE as an idle
AGENT, and that was false: `claude -p` writes its transcript on exit and emits
nothing on stdout until then, so an empty log is what a *busy* agent looks like.
The message now states the tool's behaviour instead — the same rule the fleet
scan applies to a host it cannot reach: an absence of output is not evidence of
an absence of work.

**Open point resolved — `claude -p` can stream.** `--output-format=stream-json`
(with `--verbose`) emits progress on stdout in realtime, so a log fed by it
would fill as the agent works. That is out of this branch's scope: the streaming
flag belongs to the adopting repo's `Worker command`, not to the dispatcher, and
changing it is a `Worker command` change rather than a Plot one. Recorded here
as the finding the plan's first open point asked for; the honest empty-log
message stands for any runner that does not stream.

**Discovered, not fixed (out of scope):** the board's `/api/continue` endpoint
(`server/continue.ts`) spawns the same wrapper shape and records the wrapper's
pid — the identical bug, one component along. It belongs to
`bug/the-button-claims-only-what-it-knows`, which owns the continuation surface.

<!--
bumps:
  skills:
    plot: patch
    plot-dispatch: patch
-->

`plot` bumps because `plot-dispatch.sh` and `plot-worker-state.sh` ship in it;
`plot-dispatch` bumps for the SKILL/README prose that now documents the two-pid
split. `@plot-pm/board` bumps for the empty-log wording.
