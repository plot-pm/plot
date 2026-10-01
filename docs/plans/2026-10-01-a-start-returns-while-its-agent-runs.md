# A start returns while its agent runs

> `plot-dispatch.sh --start` exits, but a bash it forks keeps the caller's stdout open for the agent's whole life. A caller that reads the output waits until the agent exits, and the supervisor's 60 s timeout then kills the agent it started.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1144
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- `plot-dispatch.sh --start` and `--restart` return as soon as they print their summary, while the agent they started keeps running. A caller that reads their output no longer waits for the agent to exit.
- The supervisor's start timeout no longer kills an agent it has just started.

## Motivation

Measured 2026-10-01 (comment on #1144):

- **The held stream.** `start_worker` launches with `( cd "$wt" && { …; } && VARS… nohup sh -c '…' >"$log" 2>&1 </dev/null & )` (`plot-dispatch.sh:1472-1536`). The `&` applies to the whole AND-list, so bash forks one process to run it. That process forks `nohup sh` and waits for it. The redirect covers only the `nohup` command, so the forked bash keeps the stdout and stderr that the dispatcher inherited, and it is reparented to PID 1 when the subshell exits. Its command line is the dispatcher's.
- **Two live cases.** 34513 (this checkout) has held its caller for 4 h; 84589 (plugin 2.22.2) held a Claude Code Bash tool's `tail -6` for 19 min. Each one's only child is the worker wrapper.
- **A copy of the form.** `out=$(bash form.sh)` returns after the agent's 6 s, with `summary:` printed first. With the redirect on the outer subshell it returns in 0 s.
- **The timeout kills the agent.** The agent stays in its starter's process group (34513, 34515 and 34524 share PGID 10942). `performer-shell.ts:93` runs `--start 1` through `runProcess`, which spawns it detached and sends SIGKILL to the group when `START_TIMEOUT_MS` (60 s) expires. Because the held stream delays `close`, the timeout fires. In a node copy of that runner with a 2 s timeout, `close` came at 2005 ms with code 0 and `summary: agents=1`, and the agent was dead. The supervisor then reports an agent that no longer exists. This was not measured on the live supervisor.
- **The brief launch has the same shape.** `plot-dispatch.sh:786-806` redirects only stderr on its outer subshell (`& ) 2>/dev/null`).

## Design

### Approach

**No domain rule changes.** The defect is in how two launch sites hand their standard streams and process group to the process they start; no decision moves. No new script.

**Slice 1: the launch gives back the caller's streams.** Both launch sites (`start_worker` and the brief launch) redirect stdin, stdout and stderr on the OUTER subshell: `( … & ) >/dev/null 2>&1 </dev/null`. The inner `>"$log" 2>&1` stays, so the wrapper still writes its log. The forked bash then holds no stream of the caller's, so a reader reaches end-of-file when the dispatcher exits. The dispatcher's own `echo` lines are outside the subshell and still reach the caller.

**Slice 2: a started agent leaves its starter's process group.** The wrapper starts as the leader of a new process group, so a signal to the starter's group never reaches an agent. `runProcess` keeps its group kill on timeout unchanged: it still ends everything the dispatcher itself started. The slice measures the mechanism on macOS and Linux before choosing it; `setsid` is not available on macOS by default (`plot-dispatch.sh:788`), and `set -m` in the launching subshell is the first candidate. `--stop` and the monitors find the wrapper by its recorded pid, not by its group, so they are unchanged; the slice confirms that by test.

### What this does NOT do

- **It does not change `runProcess`.** Its timeout and group kill are right for every other caller; the defect is that an agent sat inside the group.
- **It does not kill or adopt the two live processes.** 34513 and 84589 end when their agents exit.

### Open Points

- [ ] Slice 2: which mechanism puts the wrapper in its own process group on both macOS and Linux, measured.

## Slices

### The launch gives back the caller's streams (Branch: bug/the-launch-gives-back-the-callers-streams)

Redirect the outer subshell at both launch sites. A contract test starts a free agent in a sandbox repository whose `Worker command` loop never exits, reads `--start 1`'s output through a pipe, and asserts end-of-file within 5 s with `summary: agents=1` in it, and that the agent is still alive afterwards. The same test for `--restart`, and a test that the brief launch returns while its agent runs.

### A started agent leaves its starter's group (Branch: bug/a-started-agent-leaves-its-starters-group)

Start the wrapper as a process-group leader. A test runs `--start 1` through `runProcess` with a timeout shorter than the agent's life and asserts that the agent survives the group kill. A test asserts `--stop <branch>` still ends the agent and its monitors.

## Done when

- Slice 1: `--start 1` with a loop that never exits returns within 5 s when its output is read through a pipe, and prints `summary: agents=1`; the agent is still running afterwards. `--restart` and the brief launch pass the same test. No process with the dispatcher's command line remains as the wrapper's parent.
- Slice 2: an agent started by `--start 1` under `runProcess` with a 2 s timeout is alive after the timeout fires; its PGID differs from the dispatcher's. `--stop` ends it.

## Notes

Found by an operator on 2026-10-01: a dispatcher with PPID 1, waiting for child 84594, and a 4-hour case in this checkout. The cause was measured the same day and posted on #1144.
