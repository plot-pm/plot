# A free agent is not a finished one

> A free agent waiting to be handed work reads as `finished`, so the board drops it and an operator starting agents sees nothing appear.

> **REJECTED BY PANEL, 2026-09-22.** Four lenses, `divided` — two reject, two amend, none proceed. **The diagnosis survives and was reproduced from a fixture; the fix is wrong in three independent ways.** As written it would make started agents UNDISPATCHABLE (`isAgentFree` filters any state that is not `running` out of `matchQueue`'s free list), its discriminator `branch: ""` is what `plot-worker-loop.sh:2150` writes when a slice FINISHES, and a shell-only change fails the declared corpus pair `agent-state.corpus.test.ts`. All four jurors found the same omission: the plan never names `rules/free.ts`, which already answers this question. See `.plot/panels/2026-09-22-a-free-agent-is-not-a-finished-one/panel.md`. **Not dispatchable as written.**

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- An agent that has been started but holds no slice yet is reported as free rather than finished, so it appears on the board while it waits. An operator who started agents saw `WORKING … none` with the agent's own manifest counted in the same line, and `/api/fleet` answered `agents: 0` while the process was alive and its log read *"Waiting to be handed work"*.

Board impact: yes. The row appears where nothing appeared; no wire field is added.

## Design

### What was measured

2026-09-22, one agent started with `plot-dispatch.sh --start 1`:

```
manifest   a0583977-….json   branch: ""   pid 1794   startedAt 05:25:58Z
process    1794 S            alive, 5+ minutes
desk       free-1146d4ff     clean
log        "free on ? — nothing handed over yet. Waiting to be handed work"
/api/fleet agents: 0
```

`plot-worker-state.sh` answers **`finished 1794`** for that desk while the process is alive.

### The reading, and why it is wrong for this population

`plot_worker_state` establishes the pid answers `kill -0`, then asks `plot_pid_elapsed_seconds` whether any **descendant** is named `claude`. The root is excluded deliberately:

> THE ROOT ITSELF IS EXCLUDED. The recorded pid is the loop shell by construction, and a shell that matched would make every desk read alive.

**That is right for a working agent and wrong for a free one.** A dispatched agent runs `claude` as a child; a free agent runs nothing but the loop, on purpose — `plot-worker-loop.sh` sleeps 60 s at a time, reading the manifest, for up to the `Worker bound`. No `claude` child is the NORMAL state of a free agent, not evidence that it finished.

So the absence of a descendant carries two meanings and the code reads only one, which is this estate's recurring shape — the same *absent is not false* rule `an-unasked-host-is-not-an-absent-pr` fixed one layer out.

### What separates them, and it is already on disk

**The manifest's `branch` is the discriminator.** A free agent has `branch: ""` by construction — `plot-dispatch.sh --start` cuts its desk detached at `origin/<main>` precisely so it holds no slice. A dispatched agent has a branch name.

Two readings, one process state:

| branch | claude child | honest state |
|---|---|---|
| `""` | no | **free** — waiting to be handed work |
| `""` | yes | free, and something is running in it |
| set | no | `finished` — the work is over |
| set | yes | `running` |

**`free` is a new word and that is the point.** Reusing `running` would tell an operator an agent is working when it is idle, and reusing `waiting` collides with the `PLOT-BLOCKED` state that already means *a person was asked a question*.

### What must not break

**The root-exclusion stays exactly as it is.** It was written because a matching shell makes every desk read alive; widening it would restore that defect to buy this one. The fix reads a second fact, it does not loosen the first.

**A dispatched agent with no `claude` child still reads `finished`.** That is the case the current rule exists for and it is the common one.

**The state is a PROCESS fact and `free` keeps it one.** CLAUDE.md draws the line: a state answering *what is the process doing?* belongs to the worker. *Free* answers exactly that — the loop is running and has spawned nothing.

**`dropSettledWorkers` is not touched.** Its `if (e.state === 'running') continue` reads a state it is handed; feeding it a truthful one is the fix, and changing its predicate would be treating the symptom.

## Slices

### The state knows a free agent (Branch: bug/the-state-knows-a-free-agent) <!-- deferred: rejected by panel 2026-09-22 — the fix would make started agents undispatchable, the discriminator collides with what the loop writes on slice completion, and a shell-only change fails the declared corpus pair. Rewrite before dispatching -->

- `bug/the-state-knows-a-free-agent` — `plot-worker-state.sh` answers `free` where the manifest carries no branch and the loop is alive, leaving every other arm unchanged; the board's registry keeps a `free` entry the way it keeps a `running` one, and `dropSettledWorkers` is untouched. Tests pin that a dispatched agent with no `claude` child still reads `finished`, and that the root-exclusion still refuses to read a bare loop shell as alive for a branch-holding desk

## The blockage was a DEAD SUPERVISOR, and the disagreement was my misreading

**Recorded because I got it wrong twice and the wrong readings are worth naming.**

An earlier draft of this plan reported that the scan and the supervisor disagreed about `feature/the-store-holds-what-the-host-said` — the scan calling it `eligible`, the supervisor counting it in `not-claimable=257`. **Both halves were false.**

Running the tick by hand printed:

```
feature/the-store-holds-what-the-host-said: hand over to a0583977-…
handed=1
```

The supervisor decides correctly. `not-claimable=261` counts 261 OTHER branches; I read a total as if it named this slice.

**What was actually wrong:** the daemon was dead. `launchctl list` showed the label loaded with status `-`, `ps` found no process, and the last tick in its log was **15:52 the previous day** — while `plot-fleetctl.sh --status` reported `supervisor: running` because it reads the label, not the process. Its log had grown to **131 MB**.

The repair was `--stop`, rotate the log, `--start`. The slice was handed over within a minute.

**Two readings to distrust, both measured here:**

- **`--once` decides and performs nothing.** Its `handed=1` is a decision, not a hand-over — the property `/plot-fleet` documents and I read as a write.
- **`plot-fleetctl.sh --status` reports the LABEL, not the process.** A dead daemon under a loaded label reads as `supervisor: running`, which is the one case an operator most needs it to catch. **That is a defect worth its own plan**, and it is the reason this one took three wrong turns.

## Notes

- Found while asking why a started agent never appeared on the board. Two other things were ruled out first and both are recorded so nobody re-checks them: `dropSettledWorkers`'s predicate is correct, and the `startedAt`-versus-`ps -o lstart` comparison is NOT a timezone defect — measured, both with and without `date -u`, the pid reads current.
- `WORKING` filtering to live states is correct and stays: a free agent is not working. It should be visible somewhere, but which section is the board's question and not this plan's.
