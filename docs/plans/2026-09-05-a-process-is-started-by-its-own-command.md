# A process is started by its own command

> Plot runs two long-lived processes and neither has a command that owns it. The board is started by an adoption command's flag; the supervisor is started by copying a unit file out of a README. Both get a command named for the thing an operator already talks about, and the read that shares one of those names moves to the word it has always printed.

## Status

- **Phase:** Approved
- **Type:** feature
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 4
- **Approved:** 2026-09-05, Jan Wloka, in-session
- **Started:** 2026-09-05, Jan Wloka, `feature/the-fleet-changes-hands`
- **Started:** 2026-09-05, Jan Wloka, `feature/an-agent-is-started-by-a-command`

## Design

[`DESIGN-process.md`](../stories/the-master-agent-holds-the-fleet/DESIGN-process.md)
settles the topology this plan builds doors for. Two of its claims govern every
slice below:

**Fleet control and the board are independent systems that share a machine.**
Either runs without the other, neither is a component of the other, and the two
process trees share no edge. That is why there are two commands rather than one,
and why neither may become a dependency of the other.

**Fleet control is `1 + 2N`: one supervisor, and per agent one worker and one
monitor.** That is the target the design sets, and the last slice below reaches
it. Today it is `1 + 4N`, because the one monitor is three — `WorkerMonitor`,
`AgentMonitor` and `BuildMonitor` each run their own loop around a rule they
already share.

**Only fleet control has a multiplier.** The board's two processes are fixed
however large the fleet, so the number that decides how many agents a machine
holds is the per-agent one. Halving it is what lets N grow.

## Problem

**Nothing tells a user the supervisor exists.** `plot-registryd` shipped on 2026-09-04 with launchd and systemd units and a README that installs them. Measured the same day: `plot-init` and `plot-board-setup` mention it **zero times**, and no skill references `skills/plot/units/`. A user adopting Plot in their own repository learns about the board, dispatches agents, and never learns that the thing supervising those agents is not running.

**The board is started by an adoption command.** `/plot-board-setup --start` is documented as *"the daily action, not the ceremony"* — a runtime verb living inside a command whose other four steps probe, propose, write config and verify. Adoption happens once; starting happens every day.

**And the name a user would reach for is taken by a report.** `/plot-fleet` answers *what is the fleet doing, and what should I do?* — stateless, one pulse line written, nothing spawned. It is the right command and the wrong name for the namespace: an operator who wants to start the fleet's supervisor will type `/plot-fleet` and get a report.

**The vocabulary is already settled and already printed.** That report is a *pulse*: the skill says so 26 times, its own step 5 is *Append a Pulse Line*, the scan ends with `Pulse complete.`, and `DESIGN-pulse.md` defines the entity. The command has been called a pulse all along; only its name said otherwise.

## What this is not

**Not a rename of `plot-fleet-scan.sh`.** The scan reads the fleet and that name stays right. Measured 2026-09-05: of 284 files mentioning `plot-fleet`, only **22 references across 13 files** name the COMMAND — the rest are the script.

**Not a rewrite of the estate's prose.** 97 files under `docs/` mention `/plot-fleet` in plans, sprints and stories. Those are records of what was true when written, and rewriting them destroys `git blame` for a word. Same rule the `## Slices` migration applied to delivered plans.

**Not a new supervisor.** `plot-registryd` exists, ticks in 427 ms, and decides without performing. This plan gives it a door, not a body.

**And not a new agent.** The worker loop exists too. What is missing is the command that brings one into existence — see *Starting an agent*, which was added after a dispatch on 2026-09-05 queued a slice that no agent could take.

## Slices

### Starting an agent (Branch: feature/an-agent-is-started-by-a-command, PR: #708)

The supervisor runs. Nothing brings an AGENT up, and without one the supervisor
has nobody to hand work to.

**THIS SLICE LEADS, AND THE ORDER WAS CHANGED BY A MEASUREMENT RATHER THAN A
PREFERENCE.** It was written fourth, behind the rename that gives it the flag it
is invoked by. Dispatching the rename first on 2026-09-05 queued its own slice
against `agents=0`, so the plan's first branch could not be worked by the fleet
the plan exists to build. Every later slice is dispatchable normally once an
agent can exist; none of them is, before.

**It does not need the rename to land.** The starter's body is the missing half
of `start_worker`, which takes a branch and a worktree — neither of which a free
agent has. That is this slice's design question, and it is answered in
`plot-dispatch.sh` and the domain, not in whatever command spells the flag. Its
door is named below and arrives with the rename; until then the starter is
reachable as the script it is.

**Measured 2026-09-05, and this slice was added because of it.**
`/plot-dispatch the-workflow-owns-the-word-phase` reported `handed over
feature/a-plan-has-a-state → the registry` and `started=0`, which is correct
under the hand-over model. The supervisor then ticked `agents=0 queued=455
handed=0`: the slice is queued, the registry is willing, and there is no agent
in `.plot/agents/` to take it.

**The chain is dispatch queues → registry matches → an agent takes it, and the
last link has no starter.** Dispatch no longer spawns, by design. `--restart`
cannot stand in: it hands an EXISTING claim to a new worker, and the hand-over
deliberately pushes no claim, so there is nothing for it to restart.

**The four reaped desks are how this became visible rather than what caused
it.** An estate that happens to hold a free agent hides the gap; an empty one
shows it. The gap is in the model, not in the estate.

**AN AGENT IS A RUNNING WORKER, NOT A REGISTRY ROW.** `isAgentFree` opens with
`if (reading.state !== 'running') return false`, so a manifest without a live
process is not an agent the registry can hand anything to. Three agents means
three worker loops, and on this machine one agent is four processes — wrapper,
loop, and two monitors. Twelve processes stand before any slice is taken.

**That is the cost, and it is accepted rather than hidden.** The alternative —
desks with no process, workers started only on assignment — would need
`isAgentFree` to stop requiring `running`, and the rule's own docstring explains
why it does: a manifest field would need clearing by whoever hands over the
work, and an agent that crashed between finishing and writing it would read free
without being so. Standing capacity that can be measured beats a cheaper state
that can lie.

**The loop already starts branchless.** It reads `${PLOT_BRANCH:-?}` and
`${PLOT_WORKTREE:-$PWD}` throughout and has a `wait_for_work` that polls its own
manifest for an assignment — the half `the-registry-queues-a-brief` delivered.
This slice starts N of those with nothing assigned; it does not teach the loop
to wait.

**`--start` STARTS WHAT THE QUEUE NEEDS, up to the count.** An empty queue
brings the supervisor up and no agents: three Claude sessions idling against no
work is a cost with nothing on the other side of it, and the eight-hour bound
caps the waste rather than justifying it.

**THE SUPERVISOR SCALES UP WHEN WORK ARRIVES, and this is the answer to the
question that shape otherwise leaves open** — a dispatch an hour later would
queue a slice with nobody to take it, which is precisely tonight's failure. The
daemon already ticks every 60 s and already reads the queue; when `queued >
running` it starts agents up to the cap, and when the queue empties it leaves
the idle ones to their bound.

**It gains a verb, and the verb is one the domain already names.**
`AgentStartWrite` — kind `worker-start`, carrying a branch and a worktree — has
been in `workflows/decision.ts` since the lifecycle work, with its command
deliberately absent so that no project's agent tooling sits inside the domain.
Nothing has ever applied it. So the supervisor is not learning to decide
something new: it is having an existing decision performed, by the performer
that already applies every other write a tick names.

**The tick stays stateless and the decision stays inert.** `supervise` names the
writes and makes none; a `kill -9` mid-tick still loses nothing, because the
count it would start is re-derived from the queue on the next pass rather than
remembered between them.

**A COUNT, AND A DEFAULT OF THREE.** The command takes how many agents to bring
up and defaults to 3, so an operator who has just installed the supervisor has a
fleet rather than an empty registry. Three because it is small enough to be
wrong about cheaply and large enough to prove the hand-over matches more than
one agent to more than one slice.

**ONE START BRINGS UP BOTH, because a supervisor with no agents does nothing.**
Starting the fleet starts the supervisor and three agents; a count chooses a
different number, and zero is how an operator asks for the supervisor alone. One
command for the ordinary case, and the flag for the exception rather than the
reverse. *The fleet changes hands* spells that command `/plot-fleet --start` and
`--agents N`; this slice owes the behaviour, that one owes the name.

**AN IDLE AGENT DIES ON THE EXISTING BOUND.** `Worker bound: 28800` already caps
a worker's life at eight hours, and an agent handed nothing lives under the same
number as one mid-task. No idle-specific bound: a second number would need its
own answer to *how long is too long to wait*, and there is no measurement for
that yet. When there is, it can have one.

**`--max` IS NOT THIS NUMBER, and the two must not be confused.**
`registryd --max` bounds *how many agents one tick may act on* — a rate limit on
decisions, defaulting to 0 for no bound. It says nothing about how many agents
exist. The board's `parallel agents (cap)` control is the same kind of quantity.
A fleet size is a third thing: how many workers this machine runs at once.

**The machine has the last word.** `DESIGN-machine.md` measures what a fleet
costs — *"7 workers died `exit 124`"*, *"five workers ran fine at load 10"* — so
the count is a request, and a machine already at its bound may answer with
fewer. It says so rather than silently starting three.

**The shortfall is dropped, not remembered.** A run that starts two of three
reports which and why — *"started 2 of 3 — the machine is at its bound (load
14.2, 5 workers already running)"* — and the operator runs it again when the
machine settles. **A stored target would be the daemon's first piece of state**,
and its statelessness is a measured property rather than an accident: a
`kill -9` two seconds into a 3.4 s tick was followed by a whole tick reaching
the identical decision, with nothing written. Topping up to a remembered number
would trade that for a convenience the operator can supply by typing the command
twice.

**Done when** a command brings agents into existence with no slice assigned —
free, registered, waiting — defaulting to three, and the supervisor's next tick
hands each a queued slice without a person touching a desk.

### The fleet changes hands (Branch: feature/the-fleet-changes-hands)

`/plot-fleet` becomes `/plot-pulse`, and `/plot-fleet` returns in the same
branch as the supervisor's command: `--start`, `--stop`, `--status`.

**ONE SLICE, BECAUSE THE NAME NEVER STOPS WORKING.** Split in two, the rename
lands first and `/plot-fleet` does not exist until the second branch merges —
however long that takes. An alias would be worse than the gap, since it would
answer the OLD behaviour to somebody asking for the new one; but the gap is
avoidable entirely by changing the name's meaning in a single commit. The cost
is a slice with two subjects in one review, which is the smaller price.

The rename is 22 live command references across 13 files. `plot-fleet-scan.sh`
does not move: the scan reads the fleet and that name stays right, and the pulse
line it appends is written by the SCAN rather than the command, so the log is
untouched by any of this.

**It probes before it acts, and refuses rather than repairs** — the discipline `plot-board-setup` already applies. Four refusals, each a measurement:

| refusal | why |
|---|---|
| no `plot-registryd.mjs` | nothing to start; point at `pnpm build:board` |
| `node` is not the pinned major | **the unit bakes `$NODE` in permanently.** Measured 2026-09-05: `command -v node` on this machine answers 26.7.0 against a repo pinned to 24 |
| platform is neither launchd nor systemd | there is no unit to fill |
| a unit with that label is already loaded | launchd keys by label; a second repo needs a distinct one |

**`--once` is the gate.** The supervisor decides and performs nothing, so one tick against the live estate is free and proves the thing works before any unit is installed — the same shape as `--start` proving the board serves.

**`--start` BRINGS UP BOTH THE SUPERVISOR AND THE AGENTS**, because a supervisor
with no agents does nothing — see *Starting an agent* for the count, which is
what the queue needs rather than a fixed three.

**`--status` ANSWERS ABOUT PROCESSES, NOT ABOUT WORK.** Is the supervisor alive,
how many agents are running, how long each has been idle — machine facts, with
pids. What the slices are doing is `/plot-pulse`'s question, and the split is
the same one that separated the two commands in the first place: this one is
about what is running here, that one about what the estate holds.

**`--stop` IS AN ORCHESTRATION, NOT A SECOND STOP RULE.** It calls
`plot-dispatch.sh --stop <branch>` once per dispatched agent, waits for each
worker to exit, and only then unloads the supervisor. There is exactly one rule
for stopping an agent and it stays where it already lives.

**That is what dissolves the apparent conflict.** `plot-dispatch --stop` refuses
a bare invocation — *"Refusing to guess — stopping the wrong worker discards its
work"* — and a fleet-level stop that signalled everything itself would be a
second, laxer rule for the same act. Naming each branch in turn is not guessing:
the fleet knows which agents it has, so every call is as specific as the one an
operator would type.

**IT REPORTS EACH BRANCH AS IT GOES, and that is a requirement rather than a
nicety.** A fleet stop is the slowest thing this command does — one signal per
agent, each waited on — and a silent wait is indistinguishable from a hang. So
every branch announces itself as it is signalled and again when its worker
exits, with the outcome named:

```
/plot-fleet --stop
  stopping 3 agents, then the supervisor
  feature/a  signalled ... exited (2.1s)
  feature/b  signalled ... exited (0.4s), 4 uncommitted files kept
  feature/c  signalled ... still running after 30s — kept, see below
  supervisor unloaded
  1 agent did not exit: feature/c (pid 4471). Its desk and claim stand.
```

**An agent that does not exit is named, not waited on forever.** Each wait is
bounded; past the bound the branch is reported as still running and the run
carries on to the next. The summary says which, so a person is left with a fact
rather than a stalled terminal — the same shape as the reaper reporting what it
refused and why.

**The supervisor goes LAST, and the order is the point.** It is what would
notice a desk falling idle, so unloading it first would leave the agents
unwatched for the length of the shutdown. Stopping the watched before the
watcher also means a stop that fails partway leaves a supervisor still running
over whatever is left, rather than an unsupervised remainder.

**Each agent keeps its desk and its claim**, because `plot-dispatch --stop`
keeps them — *"the worktree kept at ... the claim stands until you release it"*.
`--stop` ends processes and decides nothing about disk; what may be removed is
`plot-reap.sh`'s question, on its own five measurements.

**Done when** `/plot-pulse` reports what `/plot-fleet` reported, `/plot-fleet
--start` installs and loads the unit on macOS and Linux and brings up the
agents, `--status` answers whether the supervisor is alive without starting it,
`--stop` stops every dispatched agent through `plot-dispatch --stop` and waits
before unloading the supervisor, `pnpm test` passes, and `grep -rn 'plot-fleet'
skills/ packages/*/src CLAUDE.md README.md` returns only `plot-fleet-scan`
matches and the new command's own files.

### Starting the board (Branch: feature/the-board-has-a-door)

`/plot-board` takes `--start`, `--stop`, `--status`, and `plot-board-setup` keeps only adoption.

The starting logic MOVES rather than being rewritten: `--start` already resolves the artifact through `plot-board-probe.sh`, refuses when `artifact_source` is `none`, and warns when `cwd_is_root` is false because the board compares realpaths. `--status` is new and cheap — the server already answers *"Plot board already running at ..."* on its port.

**`plot-board-setup --start` is removed, not aliased**, for the reason the first slice gives: a flag that still works teaches the wrong command.

**`--stop` FINDS THE BOARD BY TWO FACTS THAT MUST AGREE.** `--start` writes the
pid; `--stop` reads it AND asks the port who is listening, and stops only when
the two describe the same process tree. Where they disagree it refuses and says
which — a stale pidfile names a process that is gone or, worse, one that has
been recycled.

**Neither fact is sufficient alone.** A pidfile outlives its process, which is
why `plot-worker-state.sh` never reads one without `ps` beside it. And the port
alone would find whichever board answers, which on a machine running several is
not necessarily this repository's. Measured 2026-09-05: the board runs as
`node --watch` (pid 9518) supervising the child that binds the port (9520), so
"the board" is a tree rather than a pid, and asking only the port finds the
child.

**This is the failure that prompted it.** On 2026-09-04 a `pkill -f
'board-server.mjs'` in this session killed the operator's board along with the
stale jobs it was aimed at. A pattern match over process names is exactly the
guess the two-fact rule refuses.

**`--status` reports processes, not work.** Whether the board answers, on which
port, since when. What the estate is doing is `/plot-pulse`'s question, and the
two commands are worth keeping apart: one is about this machine, the other about
the plans.

**Done when** `/plot-board --start` starts what `--start` started, `--status` reports the port and whether it answers, `--stop` stops the tree only when pidfile and port agree and names the disagreement otherwise, `plot-board-setup` no longer documents a `--start` step, and its README says where the flag went.

### The fleet runs lean (Branch: feature/one-monitor-watches-the-slice)

Three per-agent monitors become one, taking fleet control from `1 + 4N` to the
`1 + 2N` the design sets.

**The rule is already one; only the loop is three.**
`packages/domain/src/rules/sample.ts` exports `sample(previous, current)` and
`publication(...)`, `monitoring-is-a-domain-concept` is Released, and
`plot-monitor-subject.sh` calls itself *"the ONE answer to 'is this monitor's
subject still there?'"* and is sourced by two of the three. What differs between
them is the subject, not the logic.

**The findings split where the design puts the boundary**, read from the live
logs on 2026-09-05:

| monitor | findings | subject |
|---|---|---|
| `WorkerMonitor` | `gone`, `idle` | the **process** |
| `AgentMonitor` | `clear`, `owes a review`, `owes an answer`, `holds unlanded work` | the **desk** |
| `BuildMonitor` | `build passed`, `build failed`, `head moved` | **CI** |

**`WorkerMonitor` moves to the supervisor**, which already reads what it
reports: session, tokens and cost became manifest fields when
`an-agent-remembers-its-session` and `an-agent-knows-what-it-spent` landed, and
every tick re-reads every manifest. One process per agent duplicating a read one
process already makes is the whole of the saving.

**`AgentMonitor` and `BuildMonitor` become one loop over two subjects**, because
both watch the SLICE — its desk and its CI — and a slice is what an agent holds.
One wake, two `sample()` calls, publish what changed.

**GRANULARITY IS THE TRADE, AND IT IS WORTH NAMING.** The supervisor ticks at
60 s where `WorkerMonitor` samples faster, so a wedged agent is noticed a tick
later than today. Measured 2026-09-04: four agents sat at **0.3–0.7 s of CPU for
6–8 hours**, which 60 s finds with room to spare. A prompt that dies in ten
seconds is the case that gets slower, and the cost of that miss is one tick
against N duplicate readers paid continuously.

**Nothing here touches the board.** Its two processes never scaled with the
fleet, and its scans are a separate question the design leaves open.

**Done when** an agent runs two resident processes rather than four, the
supervisor reports `gone` and `idle` for every agent it supervises,
`monitors-end.test.mjs` still passes — a monitor must still end with its subject
— and a wedged agent is still reported, one tick later at worst.

### Saying so where a user looks (Branch: docs/adoption-names-the-processes)

`/plot-init` and `/plot-board-setup` name both runtime commands in their closing summary, and the root README's skills table carries all three.

This is the slice the whole plan exists for: **the supervisor was invisible**, and a door nobody is told about is the same as no door.

**IT NAMES THEM WITH THEIR PREREQUISITE RATHER THAN ONLY WHEN RUNNABLE.**
`/plot-init` runs in repositories that have no board artifact and no built
daemon, and offering only what works there would say nothing at all — which is
exactly how the supervisor came to be invisible. So the commands are named
alongside what they need:

```
Next:
  /plot-board --start   — needs @plot-pm/board (pnpm build:board, or install it)
  /plot-fleet --start   — same package; supervises the agents you dispatch
```

**A missing prerequisite is a fact, not a reason for silence.** A reader told
that a command exists and what it wants can go and get it; a reader told nothing
cannot learn the thing exists at all. The probe still runs — it is what fills in
which prerequisite is missing — but its answer changes the SENTENCE rather than
whether there is one.

**Done when** a reader who has just run `/plot-init` in a fresh repository is told, in that command's own output, that `/plot-board --start` and `/plot-fleet --start` exist, what each one does, and what each needs before it will run.

## Notes

### Why the flags do not go on the read — 2026-09-05

`/plot-pulse` keeps the contract `/plot-fleet` had: derived from git, nothing stored, one pulse line appended. Hanging `--start` on it would put a spawn inside the one command whose stated property is that it does not spawn.

**But `--status` is a reading**, and the pulse should report it: a fleet with dispatched agents and no supervisor is a fact an operator wants in the report they already run, next to the advice. That is a follow-on, not this plan — it depends on `--status` existing first.

### Why `plot-registry` was rejected — 2026-09-05

The supervisor IS the registry's, and `DESIGN-agent.md` draws `registry ──provides──► agents`. But that is domain vocabulary: naming the command `/plot-registry` asks a user to know that a registry exists, that it supervises agents, and that supervising is what starting means. **The fleet is the noun an operator already uses.** The registry stays the right word inside the domain and the wrong word on a command.
