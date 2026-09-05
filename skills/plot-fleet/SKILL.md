---
name: plot-fleet
description: >-
  Fleet control — start, stop and report on the supervisor and the agents that
  run on this machine. Probes before it acts and refuses rather than repairs.
  Use on /plot-fleet.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 1.0.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git, bash and Node at the major
  the repository pins. Installing the unit needs launchd (macOS) or systemd
  (Linux); every other verb works without either.
---

# Plot: Fleet

Plot runs long-lived processes, and until 2026-09-05 none had a command that
owned it. The supervisor was started by copying a unit file out of a README.
This command is its door: **start it, stop it, ask whether it is alive.**

**It answers about processes, not about work.** Is the supervisor running, how
many agents are up, how long each has been quiet — machine facts, with pids.
What the *slices* are doing is [`/plot-pulse`](../plot-pulse/)'s question, and
the split is what separates the two commands: this one is about what runs here,
that one about what the estate holds.

**This name was the pulse's until 2026-09-05.** No alias was left behind — the
name is reused rather than retired, and a `/plot-fleet` answering a pulse would
give the old behaviour to somebody asking for fleet control.

**Input:** `$ARGUMENTS` selects one verb.

| Verb | What it does |
|------|--------------|
| `--status` | Is the supervisor alive, which agents run, how long each has been quiet. **Starts nothing.** |
| `--once` | One supervisor tick against the live estate, then exit. **The gate.** |
| `--start [N]` | Probe, fill the unit, load it, then bring up N free agents. |
| `--stop` | Stop every dispatched agent through `/plot-dispatch --stop`, then unload the supervisor. |
| `--wait S` | With `--stop`: seconds to wait per worker (default 30). |
| `--dry-run` | With `--start`: report what would be filled, loaded and started. Writes nothing. |

## Two processes, two commands, no edge between them

`DESIGN-process.md` settles this: **fleet control and the board are independent
systems that share a machine.** Either runs without the other, neither is a
component of the other, and the two process trees share no edge. `/plot-board`
is the board's door; this is fleet control's. Neither may become a dependency
of the other.

Fleet control is **`1 + 2N`**: one supervisor, and per agent one worker and one
monitor. Only fleet control has a multiplier — the board's processes are fixed
however large the fleet.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Run the verb | Small | One script call; the script owns every refusal |
| 2. Report what it said | Small | Print the output; it is already shaped for reading |
| 3. Read a refusal to the user | Small | Each refusal names its own repair |
| 4. Decide whether a stop is wanted | Mid | Stopping a fleet discards nothing but ends work in flight |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — never run `--stop` unattended, and say so in the output. See [Running unattended](../plot/docs/unattended.md).

## Steps

### 1. Prove it works before installing anything

```bash
../plot/scripts/plot-fleetctl.sh --once
```

**This is the gate.** The supervisor decides and performs nothing — the tick
names every write it would make and makes none — so one tick against the live
estate is free, and it proves the daemon runs before a unit is installed. A
completed tick prints its counts:

```
plot-registryd tick agents=3 left=3 reap=0 correct=0 person=0 defer=0 handed=0 queued=457 idle=0 cost=19760ms
```

A tick that could not complete prints `incomplete` with a reason and exits 1.
Read the reason before installing: a unit that reloads a daemon which cannot
tick is a crash loop with a restart policy.

### 2. Ask before starting

```bash
../plot/scripts/plot-fleetctl.sh --status
```

**It starts nothing** — a status that started what it was asked about could
never report an absence. Exit 0 means the supervisor is loaded, 1 means it is
not, so a caller can gate on it without parsing prose.

### 3. Start the fleet

```bash
../plot/scripts/plot-fleetctl.sh --start [N]
```

**`--start` brings up BOTH the supervisor and the agents**, because a
supervisor with no agents does nothing. It fills the platform's unit template,
verifies the fill, loads it, and then calls `plot-dispatch.sh --start` for the
agents. `N` is optional and passed straight through: **the count and its
default of three live in `/plot-dispatch`**, which also owns the machine bound
and reports any shortfall.

Nothing on the machine changes until every probe passes.

### 4. Read the refusal

**Four refusals, each a measurement.** Each names its own repair; read it to the
user rather than working around it.

| Refusal | The repair |
|---------|-----------|
| no `plot-registryd.mjs` | `pnpm build:board` — the unit would name a file that does not exist |
| `node` is not the pinned major | `nvm use`, then run it again |
| platform is neither launchd nor systemd | run the daemon by hand; there is no unit to fill |
| a unit with that label is already loaded | `--stop` it, or give a second checkout its own label |

**The node refusal is the one that is easiest to talk past, and must not be.**
The unit bakes `$NODE` in **permanently**. Measured 2026-09-05: `command -v
node` on the operator's machine answered 26.7.0 against a repo pinned to 24, so
a filled unit would have carried a wrong interpreter until someone re-filled it
by hand — and its failure arrives as a daemon that keeps restarting, long after
anybody is watching.

**The fill is verified rather than assumed.** A surviving `__PLACEHOLDER__`
means the unit is removed and the run refuses, and on macOS `plutil -lint` must
also pass before `launchctl bootstrap` is called.

### 5. Stop the fleet

```bash
../plot/scripts/plot-fleetctl.sh --stop [--wait SECONDS]
```

**This is an orchestration, not a second stop rule.** There is exactly one rule
for stopping an agent and it lives in `plot-dispatch.sh --stop`. That command
refuses a bare invocation — *"Refusing to guess — stopping the wrong worker
discards its work"* — and a fleet stop that signalled everything itself would be
a second, laxer rule for the same act. Naming each branch in turn is not
guessing: the fleet knows which agents it has, so every call is as specific as
the one an operator would type.

**It reports each branch as it goes, and that is a requirement.** A fleet stop
is the slowest thing this command does — one signal per agent, each waited on —
and a silent wait cannot be told from a hang:

```
stopping 3 agents, then the supervisor
  feature/a  signalled ... exited (2s)
  feature/b  signalled ... exited (0s), 4 uncommitted file(s) kept
  feature/c  signalled ... still running after 30s — kept, see below
  supervisor unloaded
1 agent(s) did not exit within 30s:
  feature/c (pid 4471)
Each desk and claim stands. Look in the worktree, or raise the bound: --wait N
```

**The supervisor goes LAST, and the order is the point.** It is what would
notice a desk falling idle, so unloading it first leaves the agents unwatched
for the length of the shutdown. Stopping the watched before the watcher also
means a stop that fails partway leaves a supervisor running over whatever is
left.

**Each agent keeps its desk and its claim**, because `plot-dispatch --stop`
keeps them. This ends processes and decides nothing about disk; what may be
removed is `/plot-reconcile`'s and `plot-reap.sh`'s question.

**An agent that does not exit is named, not waited on forever.** Past the bound
the branch is reported still running and the run carries on to the next. Exit 1
says at least one did not exit.

### 6. Free agents hold no branch, and are left running

`--start` cuts a free agent's desk **detached** at `origin/<main>` — it has no
branch, because it holds no slice yet. `plot-dispatch --stop` takes a branch,
so `--stop` cannot stop one through the single rule, and it does not invent a
second: it **names them and leaves them running**.

```
  2 free agent(s) hold no branch and are LEFT RUNNING:
    plot-wt-free-3 (pid 71200)
```

Stop one by pid if you mean to, or let the eight-hour `Worker bound` end it.

## Guardrails

- **`--status` and `--once` change nothing on the machine.** `--once` runs a
  tick, and a tick decides and performs nothing.
- **Never stop a fleet unattended.** Under `PLOT_UNATTENDED=1`, report what is
  running and stop there; ending work in flight is a person's call.
- **Never signal a worker directly.** `plot-dispatch --stop` is the one rule.
  A `pkill -f` over process names is exactly the guess it refuses, and one on
  2026-09-04 killed an operator's board along with the stale jobs it was aimed
  at.
- **Never work around the node refusal** by filling the unit by hand. The wrong
  interpreter is baked in permanently and fails silently later.
- **One supervisor per repository.** launchd keys a job by label, and the label
  carries no repository name.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Running `/plot-fleet` for a wave report | Answers about processes, not slices | That is `/plot-pulse` — this name changed on 2026-09-05 |
| Installing the unit before `--once` passes | A crash loop with a restart policy | `--once` first; it is free |
| Filling the unit under the wrong `node` | A daemon that fails after everyone stops watching | The refusal exists for this; run `nvm use` |
| Unloading the supervisor first | The agents shut down unwatched | The script orders it; do not re-order by hand |
| Reading `--stop` as a reap | It ends processes and removes nothing | Desks and claims stand; `/plot-reconcile` owns cleanup |
| Expecting `--stop` to end free agents | They hold no branch, so the one stop rule cannot name them | They are reported; stop by pid or wait out the bound |
