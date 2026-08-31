---
'plot': minor
---

A manifest names every process the registry started.

The manifest recorded the agent and none of the three processes the dispatcher
also spawned. Measured on the estate 2026-08-30: **1 manifest, 76 monitor
processes, 0 of them nameable from the registry.**

```
plot-dispatch.sh  (7357)
  └── wrapper     (7358)               ← in no manifest
        ├── WorkerMonitor       (7364) ← in no manifest
        ├── AgentMonitor        (7365) ← in no manifest
        └── plot-worker-loop.sh (7366) ← "pid": "7366"
```

`DESIGN-agent.md` gives the registry *no worktree is left behind*; the same
sentence is owed for processes, and nothing could find one to reap.

**The wrapper pid was wrong first, and is fixed in its own commit.**
`.plot-worker.wrapper.pid` named the dispatcher's subshell rather than the
wrapper — three of three live workers on 2026-08-30, each one process off (7357
against 7358, 71953 against 71954, 92947 against 92949). The dispatcher wrote
`echo $!` beside the spawn; `$!` names the last job *that* shell backgrounded,
and with an env-var prefix in front of `nohup` bash cannot collapse the AND-list
into one child, so `$!` reported the intervening subshell. The wrapper now writes
its own `$$` — the same rule the agent pid already follows, that the process
which knows a pid is the one that writes it.

It went first because a process group built on a wrong wrapper would signal
`plot-dispatch.sh` while the wrapper and its monitors carried on. The existing
test only asserted the wrapper pid *differed* from the agent's, which the buggy
value did too; the new one asserts **parenthood**, and was verified to fail
against the old code (73306 against an actual parent of 73308).

**Named fields, not a list or a process-group id.** A pgid would be one integer
and `kill -- -PGID` would reach everything, but the wrapper does not get its own
process group: started with `nohup` from a non-interactive bash with no job
control, it *inherits the dispatcher's*. Verified 2026-08-31 — dispatcher and
wrapper both reported `pgid=1298`, so recording it would name a group containing
`plot-dispatch.sh` itself. A bare list would carry the pids but not which process
each is, and the members are not interchangeable.

**Written at spawn, never discovered later** by scanning `ps` for a pattern —
that is how `plot-reap.sh:162` came to recognise no worktree at all. Asserted by
killing the agent and finding the group still recorded.

**An old manifest still parses, and reports the group as unknown rather than
empty.** *Absent is not none*: the whole object missing means the file cannot say
what it started; a member of `''` means that process was genuinely never started.

Recording only — reaping is not here. Naming the processes makes reaping
possible; deciding when a monitor must die belongs to
`two-monitors-watch-the-agent`.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
