# A start returns while its agent runs

> `plot-dispatch.sh --start` exits, but a bash it forks keeps the caller's stdout open for the agent's whole life. A caller that reads the output waits until the agent exits, every agent stays in its starter's process group, and a group signal meant for one process reaches the agents it started.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1144
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- `plot-dispatch.sh --start` and `--restart` return as soon as they print their summary, while the agent they started keeps running. A caller that reads their output through a pipe no longer waits for the agent to exit, and no process with the dispatcher's command line stays behind as the agent's parent.
- Each started agent leads its own process group. A timeout that kills the starter's group no longer kills the agent, and `--stop <branch>` ends that agent only, not every agent started by the same `--start N`.
- A brief that dispatch asks for runs in its own process group too, so `/api/claim`'s 60 s timeout no longer ends the brief's `claude -p`.

## Motivation

Measured 2026-10-01 (comment on #1144, and the round 1 panel):

- **The held stream.** `start_worker` launches with `( cd "$wt" && { …; } && VARS… nohup sh -c '…' >"$log" 2>&1 </dev/null & )` (`plot-dispatch.sh:1472-1536`). The `&` applies to the whole AND-list, so bash forks one process to run it. That process forks `nohup sh` and waits for it. The redirect covers only the `nohup` command, so the forked bash keeps the stdout and stderr that the dispatcher inherited, and it is reparented to PID 1 when the subshell exits. Its command line is the dispatcher's.
- **The real script, in a sandbox.** `--start 1` with a loop that runs `sleep 25`, read through `| cat`: end-of-file after 25.5 s, with `summary: agents=1` printed first.
- **The defect was measured before.** `runDetached` in `test/reconcile/dispatch.test.mjs:3350-3381` records on 2026-09-05: "`--start 1` with a `Worker command: sleep 300` returned in 4 ms to a file and blocked for the full 300 s to `| tail`". The suite works around the hold instead of failing on it.
- **Two live cases.** 34513 (this checkout) has held its caller for 4 h; 84589 (plugin 2.22.2) held a Claude Code Bash tool's `tail -6` for 19 min. Each one's only child is the worker wrapper.
- **Callers that read the pipe.** `performer-shell.ts:93` runs `--start 1` through `runProcess`, which answers on `close` and sends SIGKILL to the group at `START_TIMEOUT_MS` (60 s). `plot-fleetctl.sh:1065-1067` runs `--start` inline, so `/plot-fleet --start` from a Bash tool waits for the agents. `/api/claim` runs `--no-start` under a 60 s `runProcess` (`claim.ts:54`, `:162-165`), and `--no-start` does not suppress `request_brief` (`plot-dispatch.sh:3995`), so a claim on a slice with no brief holds the same pipe through the brief launch.
- **The timeout kills the agent.** The agent stays in its starter's process group (34513, 34515 and 34524 share PGID 10942). Because the held stream delays `close`, the timeout fires. In a node copy of `runProcess` with a 2 s timeout, `close` came at 2305 ms with code 0 and `summary: agents=1`, and the agent was dead.
- **One `--stop` ends its siblings.** `--stop` signals the process group of the recorded pid (`plot-dispatch.sh:1783-1806`, #1084). Every agent from one `--start N` shares that group: in a copy of the launch form, one group signal killed both of two agents started by one process.
- **The brief launch has the same shape.** `plot-dispatch.sh:801-806` redirects only stderr on its outer subshell (`& ) 2>/dev/null`).

## Design

### Approach

**No domain rule changes.** The defect is in how two launch sites hand their standard streams and process group to the process they start; no decision moves. No new script.

**Slice 1: the launch gives back the caller's streams.** At both launch sites (`start_worker` and the brief launch) the AND-list ends in `exec nohup sh -c '…'` instead of `nohup sh -c '…'`, and the outer subshell is redirected: `( … exec nohup sh -c '…' >"$log" 2>&1 </dev/null & ) >/dev/null 2>&1 </dev/null`. `exec` replaces the forked bash with the wrapper, so no process with the dispatcher's command line remains. The outer redirect keeps any output of the subshell itself, before the launch, away from the caller. The inner `>"$log" 2>&1` stays, so the wrapper still writes its log, and the dispatcher's own `echo` lines are outside the subshell and still reach the caller.

The form is measured on the real script in a sandbox repository (macOS, bash 5.3.15): with `exec`, `--start 1` read through `| cat` reached end-of-file after 1.15 s, the wrapper's PPID was 1, and the wrapper wrote its pid files, so the env prefix still reaches it. The comment at `plot-dispatch.sh:1283-1287` says an env prefix stops bash collapsing the AND-list into one child; with `exec` the forked child becomes the wrapper, so `$$` inside the wrapper and the forked pid are one process. The slice rewrites that comment. The round 1 alternative, removing the AND-list so `&` applies to `nohup` alone, gives the same process shape; `exec` is chosen because it keeps the `cd … &&` guard and the capabilities export unchanged.

**Slice 2: a started agent leads its own process group.** `set -m` is the first statement of the launch subshell at both sites: `( set -m; cd "$wt" && … exec nohup sh -c '…' … & ) >/dev/null 2>&1 </dev/null`. Measured on the real script in a sandbox (macOS, bash 5.3.15): `--start 2` returned in 0.72 s, and each wrapper's PGID equalled its own pid, with PPID 1, so the two agents sit in two groups. `set -m` alone, without slice 1's `exec`, makes the forked bash the group leader instead of the wrapper (round 1, all three jurors), which is why slice 2 follows slice 1. `set -m` goes in the bash subshell and never in the `sh -c` body: dash refuses it without a terminal. The wrapper's monitors, the loop and `claude` are started with `&` by a non-interactive `sh` and stay in the wrapper's group.

**`--stop` changes, and that is the point of the slice.** `--stop` signals the process group of the recorded pid (`:1783-1806`). Today that group is the starter's, which every agent from one `--start N` shares, so stopping one agent stops its siblings. After slice 2 the group is the wrapper's: `--stop` ends that agent's wrapper, its three monitors, the loop and `claude`, and nothing else. The comment at `:1783-1789` ("a worker started without job control shares its starter's group") describes the old shape and is rewritten. The monitors, `plot-worker-state.sh` and `plot-reap.sh` read pids, never a group, and are unchanged.

**A terminal `Ctrl-C` during `--start N` changes.** Today it reaches the foreground group, which holds the agents already started. After slice 2 it ends the dispatcher and no longer reaches those agents, which matches the `nohup` intent.

### What this does NOT do

- **It does not change `runProcess`.** Its timeout and group kill are right for every other caller; the defect is that an agent sat inside the group.
- **It does not change how systemd stops the supervisor.** On Linux, `plot-registryd.service` sets no `KillMode`, so systemd stops the unit by cgroup, and a new process group does not leave the cgroup. Stopping or restarting the supervisor unit still ends every agent it started. Filed as #1148.
- **It does not kill or adopt the two live processes.** 34513 and 84589 end when their agents exit.

### Open Points

- [ ] Linux: the real script under `set -m` and `exec` is measured on the CI ubuntu runner by slice 2's tests. The round 1 skeptic measured a copy of the form on Debian bash 5.2.15 with the same result; the real script was measured on macOS only.

## Slices

### The launch gives back the caller's streams (Branch: bug/the-launch-gives-back-the-callers-streams)

`exec` before `nohup` and the outer redirect at both launch sites, and the comment at `:1283-1287` rewritten. A contract test runs the real script: it starts a free agent in a sandbox repository whose loop never exits, reads `--start 1`'s output through a pipe, and asserts end-of-file within 5 s, `summary: agents=1`, the agent still alive, and the wrapper's parent not a process with the dispatcher's command line. The same test for `--restart`, and a test that the brief launch returns while a `Brief command` that never exits runs. `runDetached` and its docstring are rewritten so they describe the fixed behaviour, and one existing `--start` test reads through a pipe, so the old workaround is what breaks if the hold returns.

### A started agent leaves its starter's group (Branch: bug/a-started-agent-leaves-its-starters-group)

`set -m` at both launch sites, and the comment at `:1783-1789` rewritten. Tests, each failing today:

- After `--start 1`, the agent's PGID equals the manifest's `wrapperPid` and differs from the dispatcher's.
- The test spawns the dispatcher detached, reads until `summary: agents=1`, sends SIGKILL to the dispatcher's group (`process.kill(-child.pid)`), as `killGroup` would, and asserts the agent is alive. The kill is forced rather than raced against a timer, because after slice 1 the dispatcher closes before any timer fires.
- `--start 2`, each manifest given a branch checked out in its desk, then `--stop` on one branch: the other agent is still alive.
- A claim on a slice with no brief and a `Brief command` that never exits returns before the timeout, and the brief process leads its own group.

`--stop <branch>` still ends its own agent and that agent's monitors (regression lock).

## Done when

- Slice 1: `--start 1` with a loop that never exits returns within 5 s when its output is read through a pipe, and prints `summary: agents=1`; the agent is still running afterwards, and its wrapper's parent is not a process with the dispatcher's command line. `--restart` and the brief launch pass the same test. `runDetached`'s docstring no longer describes a blocked pipe.
- Slice 2: an agent's PGID equals its `wrapperPid`; it survives a SIGKILL sent to the dispatcher's group after the summary; `--stop` on one of two agents from one `--start 2` leaves the other running; a brief started by a claim leads its own group. `--stop` still ends its own agent.

## Notes

Found by an operator on 2026-10-01: a dispatcher with PPID 1, waiting for child 84594, and a 4-hour case in this checkout. The cause was measured the same day and posted on #1144. Round 1 (2026-10-01, unanimous amend) found that the outer redirect alone keeps the forked bash, that `set -m` alone makes that bash the group leader, that the `--stop` sentence was false, and that the timeout test could not fail once slice 1 landed; this text carries those changes, and the `exec` form was then measured on the real script.
