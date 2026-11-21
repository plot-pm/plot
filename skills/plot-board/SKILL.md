---
name: plot-board
description: >-
  Board control — start, stop and report on the local Kanban board that runs on
  this machine. Finds the board by two facts that must agree, and refuses rather
  than guessing. Use on /plot-board.
globs: []
license: CC0-1.0
metadata:
  author: eins78
  repo: https://github.com/plot-pm/plot
  version: 0.3.0
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
| `--port N` | Which port to act on, for this run. Without it, the `Board port` key in `## Plot Config` (`CLAUDE.md`, else `AGENTS.md`); without the key, 7777. A key that is not a number is refused. |
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

## Environment and access

The variables below set where the board listens, which requests it accepts and what it serves. The board reads further variables, such as `PLOT_UNATTENDED` and `PLOT_EXIT_WITH_PARENT`, that this section does not list. `/plot-board --start` and `pnpm board` start the board with the environment of the calling shell. Export a variable before the start. Restart a running board to change one.

### Variables

| Variable | Default | Effect |
|----------|---------|--------|
| `PORT` | `7777` | The port the board listens on. `0` lets the operating system choose a free port. `/plot-board --start` sets `PORT` itself from `--port N`, the `Board port` key or 7777, so an exported `PORT` does not reach a board that command starts. `pnpm board` uses an exported `PORT`, then the key, then 7777. |
| `HOST` | unset | The address the board listens on. Unset, the board listens on `::1` and `127.0.0.1`. Set, it listens on that one address. A value other than `localhost`, `127.0.0.1` or `::1` makes the board refuse every write route with HTTP 403, unless `PLOT_BOARD_ALLOW_REMOTE_WRITES` is `i-understand`. |
| `PLOT_BOARD_ORIGINS` | unset | A comma-separated list of origins from which the board accepts write requests, in addition to `http://localhost:<port>`, `http://127.0.0.1:<port>` and `http://[::1]:<port>`. An entry counts only when it equals the origin that a browser reports for the page: scheme and host in lower case, no port when it is the default for the scheme, no path and no trailing slash. The board ignores any other entry. The variable does not change the address the board listens on. |
| `PLOT_BOARD_ALLOW_REMOTE_WRITES` | unset | The exact value `i-understand` lets the board serve write routes while `HOST` is not loopback. Any other value, `1` and `true` included, has no effect. A board that listens on loopback ignores it. See [Remote writes](#remote-writes). |
| `PLOT_BOARD_MOCK` | unset | The exact value `1` makes the board serve built-in example plans and agent rows instead of the repository's. Any other value has no effect. |
| `PLOT_REPO_ROOT` | the working directory of the board | The repository whose plans the board serves. |
| `PLOT_SCRIPTS_DIR` | the parent of the directory that holds the board artifact | The directory of Plot's helper scripts. Development and tests override it. |

### Exposure

By default the board listens on loopback only, so no other machine reaches it. Every process of every user account on the machine reaches it: the board reads neither the address of the caller nor the user of the calling process.

| Configuration | Who sends a write request | Who reads |
|---------------|---------------------------|-----------|
| `HOST` unset (default) | Every process on the machine | Every process on the machine |
| `HOST` on loopback, behind a reverse proxy, with `PLOT_BOARD_ORIGINS` | Every process on the machine, and every client the proxy admits | The same |
| `HOST` not loopback, no opt-in | Nobody: the board answers HTTP 403 | Every client that reaches the port |
| `HOST` not loopback, `PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` | Every client that reaches the port | The same |

In every row, the same-origin check refuses a write request from a browser page of another site, unless `PLOT_BOARD_ORIGINS` declares the origin of that page.

### Write routes

A write route is a `POST` route in the `WRITE_ROUTES` table of `packages/board/src/server/index.ts`. Its routes include ones that approve, supersede and deliver plans, move plans between phases, create ideas, stories and plans, start, continue and restart agents on this machine, claim and release branches, delete a loose branch, drop a registry entry, change the fleet settings, record a release, approve a release pull request and register a passkey. Three checks apply to the caller.

1. **The write gate.** The board compares `HOST` with `localhost`, `127.0.0.1` and `::1`. For any other value, it answers every write route with HTTP 403, unless `PLOT_BOARD_ALLOW_REMOTE_WRITES` is `i-understand`. The gate reads the configured address, not the address of the caller. Read routes (`GET`) have no gate, and the board checks neither `Host` nor `Origin` on them.
2. **The same-origin check.** Every write handler runs it. It refuses a request whose `Sec-Fetch-Site` header is anything other than `same-origin`. It refuses a request whose `Origin` header is not an accepted origin (see `PLOT_BOARD_ORIGINS`). **A request with neither header passes.** A browser sets these headers on its own requests, and page JavaScript cannot change them. A client that is not a browser, such as `curl`, sends neither header and passes.
3. **The passkey.** `POST /api/release-approve` requires a verified passkey assertion and answers `person-unproven` without one. `POST /api/release` and `POST /api/restart` verify an assertion when the request carries one. Without one, the `PLOT_UNATTENDED` setting of the board process applies. `POST /api/passkey/register` accepts the first credential without an assertion, and replacing a registered credential requires an assertion from it. `POST /api/passkey/challenge` issues a challenge when a passkey is registered and asks for no assertion. No other write route takes a passkey.

### Remote access

To use the board from another machine, keep it on loopback behind a reverse proxy and declare the proxy's origin in `PLOT_BOARD_ORIGINS`.

1. Leave `HOST` unset, or set it to `localhost`, `127.0.0.1` or `::1`.
2. Export `PLOT_BOARD_ORIGINS` with the origin that browsers use to open the proxy, for example `export PLOT_BOARD_ORIGINS=https://board.example.net`. Separate several origins with commas. The board ignores an entry that has a default port, a path or a trailing slash.
3. Stop the board if it runs (`--stop`), then start it from the same shell (`--start`).
4. Configure the proxy to forward requests to `http://localhost:<port>` and to pass the `Origin` and `Sec-Fetch-Site` request headers of the browser unchanged. A request that reaches the board without these headers passes the same-origin check.
5. Open the proxy origin in a browser.

`PLOT_BOARD_ORIGINS` restricts no caller. It lets a browser page at the declared origin pass the same-origin check. The board authenticates no client of the proxy. The proxy decides who reaches the board, and every client it admits can use every write route that needs no passkey.

### Remote writes

`PLOT_BOARD_ALLOW_REMOTE_WRITES=i-understand` opens the write gate. With a non-loopback `HOST`, the board then serves every write route to every client that reaches its port. **These routes carry no authentication.** Apart from the passkey routes described above, no write route verifies who the caller is. A client that sends no `Origin` header passes the same-origin check, and so does a client that sets `Origin` to an accepted origin. A caller can approve plans, claim branches and start agents on the machine that runs the board.

The board does not add the address it listens on to the accepted origins. A browser page opened at that address sends an `Origin` that the same-origin check refuses, unless `PLOT_BOARD_ORIGINS` declares it. Issue [#3311](https://github.com/plot-pm/plot/issues/3311) reports that the write routes have no authentication when the opt-in is set.

### Release approval

`POST /api/release-approve` verifies the passkey assertion against the origin `http://localhost:<port>` and the relying-party id `localhost`. An assertion made on a page at another origin, such as the origin of a reverse proxy, fails that check. A page whose host name is not `localhost`, `127.0.0.1` included, shows a notice in its settings view and offers no passkey registration. Register the passkey and approve a release in a browser on the machine that runs the board, at `http://localhost:<port>`.

## Records line

The board shows `Records: N ahead of <default> · sync PR: none|#N` where a `State branch` is declared, and a row naming the removed-key fix order where `plot/state` is stranded with no key. Both come from the domain; the view only shows them.

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
  worktree's. A `Board port` key gives this checkout its own board instead,
  and `--port N` does the same for one run.
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
