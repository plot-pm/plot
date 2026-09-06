---
name: plot-board
description: >-
  Board control — start, stop and report on the local Kanban board that runs on
  this machine. Finds the board by two facts that must agree, and refuses rather
  than guessing. Use on /plot-board.
globs: []
license: MIT
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.1.0
compatibility: >-
  Designed for Claude Code and Cursor. Requires git, bash, curl, lsof and Node
  >= 20. No git-host CLI is needed — the board reads plans from git, and only
  PR and CI enrichment degrades without one.
---

# Plot: Board

The board is a resident process, and until 2026-09-05 the only command that
started it was an adoption command's flag. Adoption happens once; starting the
board happens every day. **This command is its door: start it, stop it, ask
whether it is answering.**

**It answers about processes, not about work.** Does a board answer, on which
port, since when, and for which checkout — machine facts, with pids. What the
*estate* holds is [`/plot-pulse`](../plot-pulse/)'s question, and the split is
the same one that separates [`/plot-fleet`](../plot-fleet/) from the pulse: one
command is about what runs here, the other about what the plans say.

**The starting logic moved here whole.** `/plot-board-setup --start` resolved
the artifact through `plot-board-probe.sh`, refused when there was none, and
warned when the CWD was not the repository root. All of that is what `--start`
does now. What changed is which command owns it.

**`plot-board-setup --start` is removed, not aliased.** A flag that still works
teaches the wrong command.

**Input:** `$ARGUMENTS` selects one verb.

| Verb | What it does |
|------|--------------|
| `--status` | Does a board answer, on which port, since when, whose checkout it serves. **Starts and stops nothing.** |
| `--start` | Resolve the artifact, start the board, record the tree's root pid, prove it answers, print the URL. |
| `--stop` | Stop the board's process TREE — only when the pidfile and the port agree about which tree that is. |
| `--port N` | Which port to act on (default 7777). |
| `--wait S` | With `--stop`: seconds to wait before escalating to KILL (default 10). |
| `--dry-run` | With `--start`: report the artifact, port and command. Starts nothing. |

## Two processes, two commands, no edge between them

`DESIGN-process.md` §1 settles this: **fleet control and the board are
independent systems that share a machine.** Either runs without the other,
neither is a component of the other, and the two process trees share no edge.

**So this command touches the supervisor nowhere**, and `/plot-fleet` touches
the board nowhere. A repository with no supervisor still shows a board — an
estate with no agents on it, which is the truth. A repository with no board
still dispatches, supervises and delivers.

**The board's cost is fixed at two processes** however large the fleet (§3), so
nothing here scales with N and nothing here needs a count. Only fleet control
has a multiplier.

## Model Guidance

| Steps | Min. Tier | Notes |
|-------|-----------|-------|
| 1. Run the verb | Small | One script call; the script owns every refusal |
| 2. Report what it said | Small | Print the output; it is already shaped for reading |
| 3. Read a refusal to the user | Small | Each refusal names the fact that disagrees and its repair |
| 4. Decide what to do about another checkout's board | Mid | Whose board holds the port is a judgment, and stopping one you did not start is a person's call |

> **User interaction:** Use `AskUserQuestion` (Claude Code) / `ask_question` (Cursor).
>
> **No user present?** If `PLOT_UNATTENDED=1` is set, do not call the question tool — never stop a board unattended, and say so in the output. See [Running unattended](../plot/docs/unattended.md).

## Steps

### 1. Ask before acting

```bash
../plot/scripts/plot-boardctl.sh --status [--port N]
```

**It starts nothing and stops nothing** — a status that started what it was
asked about could never report an absence. Exit 0 means something is listening
on the port, 1 means nothing is, so a caller can gate on it without parsing
prose.

It reports three facts, and the third is the one that matters most:

```
port: 7777
pidfile: 9518 (running) — started Fri Sep  5 19:02:11 2026
port 7777: pid 27674 listening
answers: yes — serving THIS repository (/Users/…/plot)
```

**`answers:` names whose board holds the port.** It reads `server.repo` from
`/api/board` — the realpath of the checkout that board serves. Two boards on one
machine are indistinguishable by pid or port alone; this is the fact that tells
them apart, and it is what turns *a board is running* into *your board is
running*.

### 2. Start the board

```bash
../plot/scripts/plot-boardctl.sh --start [--port N]
```

It resolves the artifact through `plot-board-probe.sh` and starts it from the
repository root. **It refuses when `artifact_source` is `none`** — there is
nothing to start, and it reports that rather than repairing it: a repository
that needs setup should be told to run `/plot-board-setup`.

**A board already on the port is not started over.** The script asks whose it
is and stops. Where it is this repository's, there is nothing to do; where it is
another checkout's, it says so and refuses. **Never stop a board you did not
start without asking** — it may be another worktree's, and several boards
running side by side is the normal case, not a fault.

**Exit 0 is not evidence.** The server treats a busy port as a report rather
than a crash — it prints `Plot board already running at …` and exits 0 — so a
start proved by its exit code proves nothing. Measured 2026-08-18: port 7777 was
held by a different Plot installation, the command reported *already running*
and exited 0, and the operator's board was not running at all. `--start`
therefore fetches `/api/board` and reports the checkout it names.

Warn when the CWD is not the repository root: the board compares realpaths, so
one started from a subdirectory serves an empty estate and says nothing about
why. The script warns and starts from the root.

### 3. Stop the board

```bash
../plot/scripts/plot-boardctl.sh --stop [--port N] [--wait SECONDS]
```

**Two facts must agree.** `--start` writes the pid; `--stop` reads it *and*
asks the port who is listening. It stops only when the two describe the same
process tree.

**Neither fact is sufficient alone.** A pidfile outlives its process — which is
why `plot-worker-state.sh` never reads one without `ps` beside it, and a
recycled pid is the worse half of that. And the port alone finds whichever board
answers, which on a machine running several is not necessarily this
repository's.

**The board is a tree, not a pid.** Measured 2026-09-05 on the live board:

```
 9518  9490  node --watch skills/plot/scripts/board/board-server.mjs
27674  9518  node skills/plot/scripts/board/board-server.mjs
```

`node --watch` (9518) supervises the child that binds the port (27674). So the
pidfile holds the **root** and the port answers with a **descendant**, and the
agreement is that ancestry rather than an equality — which would refuse every
healthy board of this shape.

**Killing only the port-holder leaves the tree half-alive.** Measured
2026-09-06: a SIGTERM to the child killed it, the watcher went on running
reparented to init, and nothing served the port. To `ps` that survivor looks
exactly like a running board.

### 4. Read the refusal

**Four disagreements, each named rather than guessed through.** Read the
refusal to the user; each names the fact that disagrees and what to look at.

| Refusal | What it means |
|---------|---------------|
| pidfile names a pid that is not running | The board is already gone, or the record outlived it. Clear the record. |
| the port is held and no pidfile exists | Something is serving that port and `/plot-board` did not start it — another checkout's, or one started by hand. Ask `--status` whose it is. |
| the recorded pid is alive and nothing holds the port | The process is alive and not serving, so its identity is unproven. Look at it before ending it. |
| the recorded pid is alive and the port's holder does not descend from it | Two boards are involved, or the pid was recycled. Stopping either on this evidence would be a guess. |

## Guardrails

- **`--status` changes nothing on the machine.** It reads a pidfile, asks the
  port, and fetches one URL.
- **Never stop the board by pattern match.** On 2026-09-04 a
  `pkill -f 'board-server.mjs'` killed an operator's board along with the stale
  jobs it was aimed at. A pattern over process names matches every board on the
  machine, including other checkouts'. The two-fact rule refuses exactly that
  guess, and the refusal is the feature.
- **Never kill only the port-holder.** The tree is what stops.
- **Never stop a board unattended.** Under `PLOT_UNATTENDED=1`, report what is
  running and stop there.
- **Never stop a board this repository did not start.** It may be another
  worktree's. `--port N` gives this one its own board instead.
- **This command never touches the supervisor**, and `/plot-fleet` never touches
  the board. Neither may become a dependency of the other.
- **This command answers no estate question.** Which waves are eligible and
  which branches are claimed is `/plot-pulse`'s.

## Common Mistakes

| Mistake | Effect | Prevention |
|---------|--------|------------|
| Running `/plot-board` for an estate report | Answers about processes, not plans | That is `/plot-pulse` |
| Reading `--start`'s exit 0 as *your board is up* | A different installation's board holds the port | `--start` fetches `/api/board` and names the checkout it serves |
| Stopping a board by port alone | Ends whichever board answered, possibly another checkout's | Two facts must agree; `--stop` refuses otherwise |
| `pkill -f board-server` | Kills every board on the machine | Measured on 2026-09-04; never do this |
| Killing the port-holder only | The watcher survives with nothing serving | The tree is what stops |
| Looking for `/plot-board-setup --start` | It was removed on 2026-09-06 | Use `/plot-board --start`; setup keeps only adoption |
| Starting the board from a subdirectory | The board compares realpaths and serves an empty estate | `--start` warns and starts from the repository root |
