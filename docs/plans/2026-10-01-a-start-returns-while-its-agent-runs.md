# A start returns while its agent runs

> `plot-dispatch.sh --start` exits, but a bash it forks keeps the caller's stdout open for the agent's whole life. A caller that reads the output waits until the agent exits, every agent stays in its starter's process group, and a group signal meant for one process reaches the agents it started.

## Status

- **State:** Released
- **Approved:** 2026-10-01, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1144
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3
- **Started:** 2026-10-01, Jan Wloka, `bug/the-launch-gives-back-the-callers-streams`
- **Delivered:** 2026-10-02
- **Released:** 2026-10-04, v2.23.0

## Changelog

- `plot-dispatch.sh --start` and `--restart` return as soon as they print their summary, while the agent they started keeps running. A caller that reads their output through a pipe no longer waits for the agent to exit, and no process with the dispatcher's command line stays behind as the agent's parent.
- Each started agent leads its own process group. A timeout that kills the starter's group no longer kills the agent, and `--stop <branch>` ends that agent only, not every agent started by the same `--start N`.
- A brief that dispatch asks for runs in its own process group too, so `/api/claim`'s 60 s timeout no longer ends the brief's `claude -p`.

## Motivation

Measured 2026-10-01 (comment on #1144, and the round 1 panel):

- **The held stream.** `start_worker` launches with `( cd "$wt" && { …; } && VARS… nohup sh -c '…' >"$log" 2>&1 </dev/null & )` (`plot-dispatch.sh:1472-1536`). The `&` applies to the whole AND-list, so bash forks one process to run it. That process forks `nohup sh` and waits for it. The redirect covers only the `nohup` command, so the forked bash keeps the stdout and stderr that the dispatcher inherited, and it is reparented to PID 1 when the subshell exits. Its command line is the dispatcher's.
- **The real script, in a sandbox.** `--start 1` with a loop that runs `sleep 25`, read through `| cat`: end-of-file after 25.5 s, with `summary: agents=1` printed first.
- **The defect was measured before.** `runDetached` in `test/reconcile/dispatch.test.mjs:3350-3382` records on 2026-09-05: "`--start 1` with a `Worker command: sleep 300` returned in 4 ms to a file and blocked for the full 300 s to `| tail`". The suite works around the hold instead of failing on it.
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

**`--stop` changes, and that is the point of the slice.** `--stop` signals the process group of the recorded pid (`:1783-1806`). Today that group is the starter's, which every agent from one `--start N` shares, so stopping one agent stops its siblings. After slice 2 the group is the wrapper's: `--stop` ends that agent's wrapper, its three monitors, the loop and `claude`, and nothing else. The own-group guard at `:1790-1796` stays: it signals the pid alone when the agent's group is `--stop`'s own. Agents started before slice 2 keep their starter's group until they exit, and for them `--stop` still ends their siblings. The comment at `:1783-1789` is rewritten to say that a new agent leads its own group, that an agent started before this change still shares its starter's group, and why the guard stays. The monitors, `plot-worker-state.sh` and `plot-reap.sh` read pids, never a group, and are unchanged.

**The brief comment at `:786-789` is rewritten.** It says `setsid` is not used because macOS lacks it. After slice 2, `set -m` gives the brief the group that `setsid` would give, and the comment names `set -m` as the mechanism.

**A terminal `Ctrl-C` during `--start N` changes.** Today it reaches the foreground group, which holds the agents already started. The wrapper, its monitors and the loop ignore it, because a non-interactive bash sets SIGINT and SIGQUIT to ignored for an `&` job, and `nohup` and `sh` inherit that. `claude` installs its own handler and exits. Measured on macOS bash 5.3 with copies of the launch form (round 2): the wrapper and a `sleep` agent survived SIGINT, and a node stand-in with a SIGINT handler exited 130. After slice 2 the agents sit in their own background groups, and `Ctrl-C` reaches none of them; the terminal's foreground group stays the dispatcher's (measured under a pty on bash 3.2 and 5.3).

**Under `set -m` the wrapper no longer ignores SIGINT and SIGQUIT on macOS.** Measured on bash 3.2 and 5.3: the old-form wrapper survived `kill -INT`, and the new-form wrapper ended. No Plot code sends SIGINT or SIGQUIT to an agent: `--stop` sends SIGTERM and `killGroup` sends SIGKILL.

### What this does NOT do

- **It does not change `runProcess`.** Its timeout and group kill are right for every other caller; the defect is that an agent sat inside the group.
- **It does not change how systemd stops the supervisor.** On Linux, `plot-registryd.service` sets no `KillMode`, so systemd stops the unit by cgroup, and a new process group does not leave the cgroup. Stopping or restarting the supervisor unit still ends every agent it started. Filed as #1148.
- **It does not move agents that are already running.** An agent started before slice 2 stays in its starter's group until it exits, so `--stop` on it can still end its siblings. The own-group guard at `:1790-1796` keeps `--stop` from signalling its caller's group in that case.
- **It does not kill or adopt the two live processes.** 34513 and 84589 end when their agents exit.

### Open Points

- [ ] Linux: the real script under `set -m` and `exec` is measured on the CI ubuntu runner by slice 2's tests. The round 1 skeptic measured a copy of the form on Debian bash 5.2.15 with the same result; the real script was measured on macOS only.

## Slices

### The launch gives back the caller's streams (Branch: bug/the-launch-gives-back-the-callers-streams, PR: #1154)

`exec` before `nohup` and the outer redirect at both launch sites, and the comment at `:1283-1287` rewritten. A contract test runs the real script: it starts a free agent in a sandbox repository whose loop never exits, reads `--start 1`'s output through a pipe, and asserts end-of-file within 5 s, `summary: agents=1`, the agent still alive, and the wrapper's parent not a process with the dispatcher's command line. The same test for `--restart`. A claim (`--no-start`) on a slice with no brief and a `Brief command` that never exits returns through a pipe before the 60 s timeout. `runDetached` and its docstring are rewritten so they describe the fixed behaviour, and one existing `--start` test reads through a pipe, so the old workaround is what breaks if the hold returns.

### A started agent leaves its starter's group (Branch: bug/a-started-agent-leaves-its-starters-group, PR: #1168)

`set -m` at both launch sites, and the comment at `:1783-1789` rewritten. Tests, each failing today:

- After `--start 1`, the agent's PGID equals the manifest's `wrapperPid` and differs from the dispatcher's.
- The test spawns the dispatcher detached, reads until `summary: agents=1`, sends SIGKILL to the dispatcher's group (`process.kill(-child.pid, 'SIGKILL')`), as `killGroup` would, and asserts the agent is alive. The kill is forced rather than raced against a timer, because after slice 1 the dispatcher closes before any timer fires. An `ESRCH` from that kill counts as an empty group, as `killGroup` treats it (`run-script.ts:65-69`): after slice 2 the dispatcher's group is often empty when `summary:` arrives.
- `--start 2` runs in its own process group (spawned with `detached: true`, as `runProcess` spawns it), each manifest is given a branch checked out in its desk, and `--stop` on one branch runs from the test's group: the other agent is still alive. The condition matters: when `--start` and `--stop` share one group, as every existing test's `spawnSync` and `execFileSync` calls do, today's `--stop` signals the pid alone (`:1795-1798`) and the test passes before the fix. Measured in round 2: in separate groups today, both agents died.
- A claim on a slice with no brief and a `Brief command` that never exits: the brief process leads its own group. The stand-in `Brief command` writes its own `$` to a file, because the brief has no pid file, and the test reads the brief's pid and PGID from it.

`--stop <branch>` still ends its own agent and that agent's monitors (regression lock).

## Done when

- Slice 1: `--start 1` with a loop that never exits returns within 5 s when its output is read through a pipe, and prints `summary: agents=1`; the agent is still running afterwards, and its wrapper's parent is not a process with the dispatcher's command line. `--restart` passes the same test, and a claim on a slice with no brief returns through a pipe before the timeout. `runDetached`'s docstring no longer describes a blocked pipe.
- Slice 2: an agent's PGID equals its `wrapperPid`; it survives a SIGKILL sent to the dispatcher's group after the summary, with `ESRCH` read as an empty group; with `--start 2` spawned in its own process group and `--stop` run from another, `--stop` on one agent leaves the other running; a brief started by a claim leads its own group. `--stop` still ends its own agent. The comments at `:786-789` and `:1783-1789` describe the new groups and the agents started before them.

## Notes

Found by an operator on 2026-10-01: a dispatcher with PPID 1, waiting for child 84594, and a 4-hour case in this checkout. The cause was measured the same day and posted on #1144. Round 1 (2026-10-01, unanimous amend) found that the outer redirect alone keeps the forked bash, that `set -m` alone makes that bash the group leader, that the `--stop` sentence was false, and that the timeout test could not fail once slice 1 landed; this text carries those changes, and the `exec` form was then measured on the real script. Round 2 (2026-10-01, divided: amend 2, proceed 1) measured the plan's form on the real script and found that the `--stop` sibling test passed today when both calls share one group, that the forced kill can raise `ESRCH`, and that `Ctrl-C` today ends only programs with their own handler; this text carries those changes.
