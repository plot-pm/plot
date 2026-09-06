# plot-board — developer notes

Board control: the door to the local Kanban board. `SKILL.md` is the
agent-facing instruction; this file is why it looks the way it does.

Design: [`DESIGN-process.md`](../../docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md).
Plan: `docs/plans/2026-09-05-a-process-is-started-by-its-own-command.md`.

## Where the starting logic came from

`/plot-board-setup --start` — removed in the same commit that added this
command, **not aliased**. A flag that still works teaches the wrong command, and
that argument is the one slice 1 settled when `/plot-fleet` took its name from
the pulse.

The behaviour moved whole: resolve the artifact through `plot-board-probe.sh`,
refuse on `artifact_source: none`, warn when `cwd_is_root` is false, start from
the repository root, and prove the board answers by fetching `/api/board` rather
than by reading an exit code. **What changed is which command owns it.**

`plot-board-setup` keeps adoption: probe, propose, write config, verify,
summarise. Its step 4b still starts a board — through `plot-board-verify.sh`,
which reaps the server it started. That is a different act from `--start`, whose
whole purpose is to leave one running, and the two do not merge.

## Split: skill vs script

Per Manifesto Principle 3, *skills interpret and adapt; scripts collect and
report*:

| Layer | Responsibility |
|-------|----------------|
| `skills/plot/scripts/plot-boardctl.sh` | Every fact, every refusal, the start, the tree walk, the ordered stop. Deterministic; a small model can run it and read its output. |
| `skills/plot-board/SKILL.md` | When to run which verb, how to read a refusal to a person, and what to do about a board belonging to another checkout. |

The refusals live in the script rather than in prose, because CLAUDE.md's *Gates
Over Rules* asks the question that decides it: can an agent answer *"did I check
that the pidfile and the port agree?"* without checking? In prose, yes. In the
script, `--stop` cannot reach a `kill` without both facts agreeing.

## The two-fact rule, and why neither fact alone

**A pidfile outlives its process.** `plot-worker-state.sh` never reads one
without `ps` beside it, and the reason generalises: a stale pidfile names a
process that is gone or — worse — one whose pid has since been recycled onto
something unrelated. Acting on it alone can end an arbitrary process.

**The port finds whichever board answers.** Several worktrees run boards side by
side; that is normal and the server supports it by reporting `already running`
rather than taking a held port. So the board on 7777 is not necessarily this
repository's. Measured 2026-08-18 on this machine: 7777 was held by a *different
Plot installation* serving 3 cards against a checkout holding 59 plans.

**Together they identify a tree.** The pidfile says which tree; the port says
that tree is actually serving. Neither claim is interesting alone.

## The agreement is an ANCESTRY, not an equality

Measured 2026-09-05 and again on 2026-09-06, on the operator's live board:

```
 9518  9490  node --watch skills/plot/scripts/board/board-server.mjs
27674  9518  node skills/plot/scripts/board/board-server.mjs
```

`pnpm board` runs the server under `node --watch`, which supervises the child
that binds the port. `lsof -ti tcp:7777` answers **27674**, the child, while
`--start` records the tree's **root**. An equality check would refuse every
healthy board of this shape.

So the rule is: **the port's listener must be the recorded pid, or descend from
it.** A single-process board satisfies it on the first hop; the two-process
shape satisfies it on the second. Both were exercised by hand on 2026-09-06.

**Process group is not the tree.** Measured on the same board: 9518 and 27674
share pgid 8005 — which belongs to the *shell that started them*, not to the
board. A `kill -PGID` would have signalled that shell's other children too.
Ancestry is the relation that describes the board; the process group describes
whoever happened to launch it.

## Why the tree walk is one `awk` pass

The first implementation read `ps -eo pid=,ppid=` into a variable and looped in
shell, forking `awk` twice per line to split the columns.

**Measured 2026-09-06 on this machine: `ps -eo pid=` lists 1109 processes, and
that loop took 10.6 s for a single pass.** With a frontier loop around it, a
`--stop` that should take under a second exceeded a 120-second bound and was
killed before it printed its first line. The rewritten walk — one `ps`, one
`awk` — takes **0.055 s**, and a full `--stop` takes 0.95 s.

This is not a micro-optimisation filed under tidiness. **A fleet host is exactly
the machine with a process table that size**, so the slow form fails hardest on
the machine the command exists for, and it fails as a hang rather than as an
error.

**The snapshot matters as much as the speed.** One `ps` reading means the walk
happens over a table that cannot move under it; asking per pid would let a child
spawned between two readings read as absent.

## Killing only the port-holder: what actually happens

The plan says a port-only kill lets `node --watch` restart the child. **Measured
2026-09-06, that is not what happens**: a SIGTERM to the port-holder killed it,
and the watcher went on running — reparented to init, holding no port, doing
nothing. `--watch` respawns on a **file change**, not on its child's death.

The conclusion is unchanged and the reason is worth recording accurately: a
port-only stop leaves a survivor that looks exactly like a running board to
`ps`, and the next `--start` then finds a free port and a confusing tree. **The
tree is what stops.**

## What `--status` reads, and the third fact

`--status` reports the pidfile, the port's listener, and `server.repo` from
`/api/board`. That third field is the board's own realpath for the checkout it
serves, and it is the only fact that says **whose** board holds the port.

It costs one HTTP request against a board that is already up, which is why
`--status` can afford it where a heavier ownership check could not. The 30-second
timeout is measured: a cold first fetch against a 59-plan repo took 8.7–9.5 s on
2026-08-19 against a warm ~1.7 s, so a 10-second ceiling turns a healthy board
into a reported failure on a loaded machine.

## What this command is not

- **Not fleet control.** That is [`/plot-fleet`](../plot-fleet/). `DESIGN-process.md`
  §1: the two systems share a machine and no process-tree edge, so neither may
  become a dependency of the other. This script never reads `plot-registryd`,
  never asks launchd anything, and never calls `plot-fleetctl.sh`.
- **Not an estate report.** `/plot-pulse` answers what the plans hold; nothing
  here derives a wave state.
- **Not adoption.** `/plot-board-setup` writes the config and verifies the
  prerequisites, once per repository.

## Where the pidfile lives, and why there

`.plot/state/board.pid` — machine-local and gitignored, for the same reason
`.plot/agents/` and `.plot-worker.pid` are. A pid names a process on one laptop;
a checked-in one would tell another clone that its board is running, and in the
worst case name a pid that matches some unrelated process there.

The log goes to `.plot/logs/board.log`, added to `.gitignore` in this branch.
Untracked and unignored is the worst of both: it shows up in `git status`, and a
`git add -A` in a worker's worktree carries a console log into the repo — the
failure `.gitignore` already records for `.plot-worker.log`.

## Testing

`test/reconcile/boardctl.test.mjs` drives the script against fabricated
repositories: each of the four `--stop` disagreements, the ancestry rule against
a real two-process tree, the artifact refusal, and `--status`'s exit code.

**A test must never leave a server running**, which is why the suite starts no
board of its own except one it stops in the same test, on an OS-chosen free
port. The refusal cases need no server at all — they are about pidfiles and
ports, and a `nc`-style listener or a sleeping process stands in for a board
wherever only a pid and a socket are being asserted.

**The full start/stop cycle was walked by hand on 2026-09-06** in this worktree,
against ports 7893 and 7894, with the operator's own board on 7777 running
throughout and untouched by every case. That walk is what produced the two
measurements above.

## Known gaps

- **A half-dead tree cannot be stopped by this command.** Watcher alive, child
  gone, port free: `--stop` refuses, because the port cannot confirm the tree.
  That is the two-fact rule behaving exactly as specified, and it leaves the
  operator with a live process and no verb for it. Ending it needs either a
  third fact (the tree's own command line) or an explicit `--force` that names
  the pid — both of which are a change to the stop rule and belong in their own
  slice with their own argument about what a name-based stop may destroy.
- **`--stop` signals the tree as read at one instant.** The board spawns a
  transient `plot-fleet-scan.sh` per refresh, so a scan started between the walk
  and the signal survives its parent. It is transient and exits on its own, and
  the stop re-asks the port rather than trusting the signal, which is the check
  that decides success.
- **Two boards serving the *same* checkout are not distinguishable by
  `server.repo`.** The ownership fact separates checkouts, not processes within
  one. The pidfile separates those, which is why both facts are read.
