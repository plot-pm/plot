---
'plot': minor
---

The WorkerMonitor measures. Its `noop_pass` becomes a real sample of the process
table, on a ~30s cadence, and `nothing measured yet` is gone from it.

Two findings, and only two. **`gone`** when the agent pid names no live process.
**`idle`** when the pid is alive, its subtree burned no CPU across two
consecutive passes, the tree did not change between them, *and* commits already
exist on the branch. Anything else is silent, and silence means healthy.

**The three conditions on `idle` are not caution — they are what makes the word
mean something.** A worker waiting on a long model response has the same zero
CPU delta as one whose agent has vanished, so the delta alone cannot be the
finding. What separated the three stalls measured 2026-08-30 is that each had
already committed and then gone quiet:

| CPU | tree | commits | → |
|---|---|---|---|
| none | unchanged | present | **idle** |
| none | unchanged | none yet | silent — it may be thinking |
| none | **changed** | any | silent — something is happening |

**The middle row is where the false positives would have been.** An agent given
a hard first slice is quiet for a long time with nothing to show, and calling
that a stall is what teaches an operator to ignore the finding.

**It is `idle` and never `stalled`.** The spec reserves `stalled` for an *Agent*
fact — exited 0, unlanded work, no PR. A stalled agent has work to rescue; an
idle worker may just be waiting on the network. An earlier draft reused the name
and put a process fact on the agent side, which is the confusion CLAUDE.md's
Machine/Registry split exists to prevent.

**`gone` takes one sample; `idle` takes two.** Asymmetric on purpose: a dead
process does not come back, so a second confirmation costs an interval and buys
nothing, while a frozen CPU clock genuinely can be a process between syscalls.
The previous answer is the only state kept, and it is derived — kill the monitor
and the next one rebuilds it, one interval late.

**No host call at all.** Not few, none: a ~30s loop that asks the host has
become an AgentMonitor with a fast loop, and the rate problem follows it.
`commits present` counts against the *local* `origin/HEAD` ref and answers
*unanswerable* rather than zero where there is none — counting against nothing
counts the whole history from the root commit, which is the mistake
`plot_worker_task_state` records having made in the other direction.

Built **on** `plot_worker_activity` rather than beside it, so there is one CPU
sampler rather than two that drift. The tree fingerprint goes through
`plot_worker_dirty_filter` for a sharper reason: the monitor publishes *into*
the worktree it watches, so a raw `git status` would see its own findings file
appear and suppress `idle` forever on the strength of its own output.

An absent `.plot-worker.pid` means *not yet*, never `gone`. The wrapper
backgrounds the monitors before it records the pid, so the first pass genuinely
lands in that window — and a `gone` that fired there would be the loudest
finding and the least trustworthy.

Tested unit-first against mocked ports, because the branches that matter are
ones a real machine will not produce on demand: a pid that dies between two
samples, a tree that changes between two readings. Nineteen such tests, plus
three e2e that prove only what they can — that the whole path survives a real
wrapper, a real detached process and a real reader.

<!--
bumps:
  skills:
    plot: minor
-->
