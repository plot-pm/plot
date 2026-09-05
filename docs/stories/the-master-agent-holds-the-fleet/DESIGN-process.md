# DESIGN — Process

> What Plot runs, who owns whom, and which processes are resident against which are asked a question and go away. Eighteen entity specs describe what Plot *knows*; none describes what it *runs*.

## Contents

0. [What the topology is for](#0-what-the-topology-is-for)
1. [Two topologies, not one](#1-two-topologies-not-one)
2. [Resident and transient](#2-resident-and-transient)
3. [The topology today, measured](#3-the-topology-today-measured)
4. [What each process is for](#4-what-each-process-is-for)
5. [The resident set](#5-the-resident-set)
6. [The transient set](#6-the-transient-set)
7. [Ownership](#7-ownership)
8. [The target topology](#8-the-target-topology)
9. [What this does not settle](#9-what-this-does-not-settle)

## 0. What the topology is for

**Run as many agents as the machine allows, and spend as little as possible on
everything that is not an agent.** Control and observation are overhead; the
agent is the work. Every process in this document is judged against that.

**The overhead is what scales with N, and only fleet control has a
multiplier.** It runs `1 + 4N` today: three of the four per-agent processes
watch and one works, so three agents means nine watchers to three workers. The
board's cost is fixed at two processes however large the fleet, which is why
§1 keeps the two budgets apart — attacking them together hides which one grows.

**So the target is not a smaller number for its own sake but a smaller
multiplier.** `1 + 2N` is one watcher per worker rather than three, which is
what lets N grow. Measured against `DESIGN-machine.md`'s own numbers — *"7
workers died `exit 124`"*, *"five workers ran fine at load 10"* — halving the
per-agent process count is the difference between a machine holding five agents
and holding ten.

**And the transient population counts too.** A scan every five seconds at 18.3 s
each is overhead paid on the board's clock rather than the fleet's, but it is
paid on the same machine and competes with the agents for it. §5 is about that.

**What this principle does NOT license** is removing observation. Tonight's four
agents wedged at 0.3 s of CPU for six hours because nothing was watching — the
cheapest topology is no monitors at all, and it is worthless. The aim is one
watcher doing what three did, not none.

## 1. Two topologies, not one

**Fleet control and the board are separate systems that happen to share a
machine.** Either runs without the other, and neither is a component of the
other.

```
FLEET CONTROL                        THE BOARD
plot-registryd                       board-server.mjs
  supervises agents                    renders the estate
  N agents, each with a monitor        spawns a scan per refresh
  runs headless, no port               binds a port, no agents

  needed to DO work                    needed to SEE work
```

**A repository with no board still dispatches, supervises and delivers.** Every
one of those is a skill and a script; the board renders what they leave behind.
Measured on this repository: the board was down for stretches of 2026-09-04 and
the fleet kept working.

**A repository with no supervisor still shows a board.** It shows an estate with
no agents on it, which is the truth.

**So they get separate doors — `/plot-fleet` and `/plot-board`** — and separate
process trees, and neither may become a dependency of the other. The one place
they touch is §5: the supervisor may PUBLISH a reading the board is free to
consume, one-directionally, with the board falling back to its own scan when
there is nothing to read. A board that *requires* a supervisor would make
seeing the work depend on doing it.

**The overhead budgets are separate too, and only one of them scales with N.**
Fleet control pays `1 + 2N` — the multiplier that decides how many agents fit.
The board pays a fixed pair plus its scans, however many agents there are.
Attacking the two together hides which one is expensive.

## 2. Resident and transient

**A process is resident or transient, and the two are governed by different rules.**

| | resident | transient |
|---|---|---|
| lives | until stopped | for one question |
| costs | continuously | per invocation |
| fails by | wedging, silently | returning an error |
| is bounded by | a stop command or a bound | its own exit |
| needs | a door — start, stop, status | a caller |

**Merging them is the mistake this document exists to prevent.** A resident process that answers questions becomes a service, and a service needs a protocol, a port, a lifecycle and a story about what happens when it is not running. A transient one that holds state between invocations becomes a resident process nobody declared.

Both mistakes are reachable from where Plot stands today, and in opposite directions: the fleet scan is transient and expensive enough that someone will want it resident, and the supervisor is resident and idle enough that someone will want it to answer questions.

## 3. The topology today, measured

Measured 2026-09-05 on this repository, with one board and one supervisor running.

**Fleet control:**

```
launchd / systemd
└── plot-registryd                    resident, 1 per repository

sh -c wrapper                         EXITS after spawning; owns nothing
├── plot-worker-monitor.sh            resident, per agent
├── plot-agent-monitor.sh             resident, per agent
├── plot-build-monitor.sh             resident, per agent
└── plot-worker-loop.sh               resident, per agent — the agent itself
```

**`1 + 4N`.** One supervisor, four processes per agent. At three agents,
thirteen — of which three do the work and nine watch them.

**The board:**

```
node --watch  (board wrapper)         resident, 1 per repository
└── board-server.mjs                  binds the port
    └── plot-fleet-scan.sh --stream   TRANSIENT, spawned per refresh
        └── plot-fleet-scan.sh        nested child of the same
```

**`2`, plus a scan per refresh.** The resident pair does not grow with the
fleet; the scans are the board's real cost. Sampled over twenty seconds on
2026-09-05 the count moved 1 → 1 → 0 → 2, and each scan takes 18.3 s against a
5 s cadence — which is why `--stream` exists at all: it emits per-plan lines as
they resolve rather than making the board wait for a complete answer.

**The two trees share no edge.** The supervisor is not an ancestor of the board,
the board is not an ancestor of any agent, and nothing in the fleet's tree knows
the board exists.

## 4. What each process is for

The three per-agent monitors are **one rule with three subjects**, not three kinds of thing. `rules/sample.ts` exports `sample(previous, current)` and `publication(...)`; `plot-monitor-subject.sh` calls itself *"the ONE answer to 'is this monitor's subject still there?'"* and is sourced by two of them. The plan `monitoring-is-a-domain-concept` is Released.

What differs is the subject, and the findings say so exactly — read from the live logs on 2026-09-05:

| monitor | findings | subject |
|---|---|---|
| `WorkerMonitor` | `gone`, `idle` | the **process** |
| `AgentMonitor` | `clear`, `owes a review`, `owes an answer`, `holds unlanded work` | the **desk** |
| `BuildMonitor` | `build passed`, `build failed`, `head moved` | **CI** |

**`WorkerMonitor` watches something the supervisor already reads.** Session, tokens and cost became manifest fields when `an-agent-remembers-its-session` and `an-agent-knows-what-it-spent` landed, and the supervisor re-reads every manifest each tick. One process per agent duplicates a read one process already makes.

**`AgentMonitor` and `BuildMonitor` watch the SLICE** — its desk and its CI. They are per-agent because the slice is.

## 5. The resident set

A resident process must answer three questions, and a process that cannot is not ready to be resident:

1. **Who starts it, and how does a person stop it?** A resident process without a door is invisible. Measured 2026-09-04: `plot-registryd` shipped with launchd and systemd units and **zero references** from any adoption skill.
2. **What notices when it wedges?** Measured 2026-09-04: four agents ran 6–8 hours at **0.3–0.7 s of CPU** on branches whose PRs had merged. Nothing noticed, because the supervisor was not running and no parent existed to care.
3. **What does it cost while idle?** An agent is a Claude session. Three idling against an empty queue is a standing cost with nothing on the other side.

## 6. The transient set

A transient process is asked a question and goes away. The fleet scan, every skill's `--next` and `--list-eligible`, every helper script.

**They need no door and no supervision**, and that is their virtue: a scan that dies leaves nothing behind, and its caller sees an exit code. The pulse's stated contract — *every fact re-derived from git, the only write a pulse line* — is a statement about being transient.

**The cost is paid per invocation and it is not small.** 18.3 s per scan, once per board refresh. The temptation is to make the scan resident so the answer is ready; the reason not to is that a resident answer is a cached answer, and a cache that can disagree with git is exactly what the derivation exists to avoid.

**The resolution is not to make the reader resident but to let an already-resident process publish.** The supervisor ticks every 60 s and reads much of the same estate. A tick that published its reading would let the board consume it instead of spawning a scan — the same argument that moves `WorkerMonitor` up: one component already doing the read, others duplicating it.

**What that must not become**: the board asking the supervisor a question. Then the supervisor is a service, the board depends on it running, and a repository without one has no board. **Publication is one-directional** — the supervisor writes what it read; a reader may use it or fall back to its own scan.

## 7. Ownership

**Nothing owns anything.** The `sh -c` wrapper spawns four children, records their pids in the manifest, and exits — it contains no `wait` and no `kill`. The monitors are siblings of the worker, not its children. The supervisor has no process relationship to any agent and reaches them only by pid.

**The manifest is the hierarchy.** `wrapper`, `wmon`, `amon`, `bmon` and `pid` are recorded fields, and every relationship in the tree above is a fact written down rather than a parent-child link.

**This is deliberate and it has a real virtue: there are no orphans.** Nothing depends on a parent surviving, so a dead wrapper strands nobody. It is also why the monitors end themselves — `monitors-end.test.mjs` asserts *"after its subject finishes, no monitor of THAT worker remains"* — each watches its subject's pid and exits when it goes. There is no reaper because there is no parent to reap.

**And it is why nothing noticed the four wedged agents.** A flat topology has no ancestor whose job is to care. That work belongs to the supervisor, which is the only process positioned to do it — and the only one that was not running.

## 8. The target topology

```
launchd / systemd
└── plot-registryd            resident, 1 — supervises AGENTS:
                                session, tokens, context, model, liveness

  per agent:
  ├── plot-worker-loop.sh     resident — the agent
  └── plot-monitor.sh         resident — watches the SLICE:
                                the desk and CI, one loop, two subjects
```

**Fleet control becomes `1 + 2N`**, against `1 + 4N` today: at three agents,
seven processes instead of thirteen. **The board is untouched** — its cost never
scaled with the fleet, and §6 is a separate question about its scans.

**The split follows the findings rather than the file layout.** What is about the agent — is it alive, what has it spent, which model, which session — is one question asked N times, and the supervisor already asks it. What is about the slice — does this desk owe a review, did this branch's build fail — is genuinely per-slice and stays beside the agent.

**Granularity changes, and that is the trade.** The supervisor ticks at 60 s where `WorkerMonitor` samples faster. Tonight's wedged agents sat six hours; 60 s would have found them with room to spare. A prompt that dies in ten seconds would be noticed a tick later than it is today. The cost of the miss is bounded by the tick; the cost of N duplicate readers is paid continuously.

**No separate monitor for the supervisor.** A process watching the supervisor's own subjects — ticket inbox, machine load — would be a second resident process reading what the supervisor already reads on a clock it already has; the answer is a wider tick, not another process. And *"is the supervisor running?"* is the OS supervisor's question, settled by `the-machine-keeps-the-daemon-alive`: launchd and systemd exist to answer exactly that, and Plot's own `Machine` must not become a third supervisor.

## 9. What this does not settle

**Whether the board should consume the supervisor's published reading.** §5 argues the direction; it does not decide the format, the staleness rule, or what the board does when no supervisor has ever run. Those need their own measurements.

**What a failed agent start looks like.** The supervisor starting agents when `queued > running` can loop if every start dies immediately. Whether the existing `attempts` budget covers it, or a start failure is a different kind of failure needing its own counter, needs a measurement of how a failed start actually presents — whether the process exits, hangs, or writes a manifest first.

**Whether Agent and Worker remain two nouns.** `elsewhere` — *"no worktree on this machine"* — is only expressible if the worker is the link rather than a view of the agent, which is the argument for keeping both. This document changes the process count without touching that vocabulary, and the question survives it.
