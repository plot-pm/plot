## Implementation brief — a-start-returns-while-its-agent-runs (wave 2: A started agent leaves its starter's group)

- **Plan (canonical):** `docs/plans/2026-10-01-a-start-returns-while-its-agent-runs.md` on `main`
- **Issue:** #1144
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/a-started-agent-leaves-its-starters-group` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

**This slice waits on wave 1, `bug/the-launch-gives-back-the-callers-streams`.** It needs that slice's `exec` at both launch sites. Start only after wave 1 has merged to `main`, and rebase onto `main` before you open the PR.

### What to build

1. **`set -m` is the first statement of the launch subshell at both sites**: `( set -m; cd "$wt" && … exec nohup sh -c '…' … & ) >/dev/null 2>&1 </dev/null`, in `start_worker` and in the brief launch. `set -m` goes in the bash subshell, **never in the `sh -c` body**: dash refuses it without a terminal.
2. **Rewrite the comment at `plot-dispatch.sh:1783-1789`**: a new agent leads its own group; an agent started before this change still shares its starter's group; why the own-group guard at `:1790-1796` stays.
3. **Rewrite the brief comment at `:786-789`**: `set -m` gives the brief the group that `setsid` would give.
4. **`--stop` changes, and the plan says so.** After this slice `--stop` ends one wrapper's group: that agent's wrapper, monitors, loop and `claude`, and nothing else. The guard stays and is not loosened.

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `plot-dispatch.sh` | 786-789 | brief comment: `setsid` not used, absent on macOS |
| `plot-dispatch.sh` | 801-806 | the brief launch |
| `plot-dispatch.sh` | 1783-1789 | the `--stop` group comment (#1084) |
| `plot-dispatch.sh` | 1790-1796 | the own-group guard: signal the pid alone when the group is unreadable or `--stop`'s own |
| `plot-dispatch.sh` | 1797-1806 | the `kill -TERM` and its two report lines |
| `packages/domain/src/adapters/run-script.ts` | 63-70 | `killGroup`: `process.kill(-pid, 'SIGKILL')`, falls back to the child on a throw |

Read `plot-dispatch.sh` with the Read tool: the controller-gate hook blocks any Bash command that names it.

### Tests (from the plan, each failing on `origin/main`)

- After `--start 1`, the agent's PGID equals the manifest's `wrapperPid` and differs from the dispatcher's.
- Spawn the dispatcher detached, read until `summary: agents=1`, send SIGKILL to its group (`process.kill(-child.pid, 'SIGKILL')`), assert the agent is alive. **Treat `ESRCH` from that kill as an empty group**, as `killGroup` does: after this slice the group is often empty when `summary:` arrives.
- `--start 2` spawned with `detached: true` (its own process group, as `runProcess` spawns it), each manifest given a branch checked out in its desk, and `--stop` on one branch run **from the test's group**: the other agent is still alive.
- A claim on a slice with no brief, with a `Brief command` that never exits: the brief process leads its own group. The stand-in `Brief command` writes its own `$$` to a file, because the brief has no pid file.
- Regression lock: `--stop <branch>` still ends its own agent and that agent's monitors.

### Panel caveats a worker trips on

- **The sibling test passes today if both calls share one group.** Every existing test's `spawnSync`/`execFileSync` shares the test's group, and in that case today's `--stop` signals the pid alone (`:1795-1798`). The test must spawn `--start 2` detached and run `--stop` from another group, or it proves nothing. Measured in round 2: in separate groups today, both agents died.
- **The forced kill replaces a timer.** After wave 1 the dispatcher closes before any timer fires, so a timeout-based test cannot fail.
- **SIGINT disposition changes on macOS** under `set -m`: the wrapper no longer ignores SIGINT and SIGQUIT. No Plot code sends either (`--stop` sends TERM, `killGroup` sends KILL); do not add a test that relies on SIGINT being ignored.
- **Linux:** the CI ubuntu runner is the first run of the real script under `set -m` there (Open Point). A copy of the form behaved the same on Debian bash 5.2.15.
- **Agents started before this slice** keep their starter's group; the guard keeps `--stop` safe for them. Do not remove it.
- **systemd** still stops every agent of the supervisor unit by cgroup; that is #1148, not this slice.

### Done when

An agent's PGID equals its `wrapperPid`; it survives a SIGKILL to the dispatcher's group after the summary, with `ESRCH` read as an empty group; with `--start 2` in its own group and `--stop` from another, `--stop` on one agent leaves the other running; a brief started by a claim leads its own group; `--stop` still ends its own agent. The comments at `:786-789` and `:1783-1789` describe the new groups and the agents started before them.

### Gates

`nvm use` (Node 24), then `pnpm test`, `pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`. **Do not run `pnpm run test:e2e`.** Run `test/reconcile/dispatch.test.mjs` alone first.

### Rules that bite this slice

- No new script; no domain rule changes.
- A changeset, description first and the `bumps:` block last.
- Never signal 34513, 84589 or their children. Kill only processes your test started, by pid or by the group your test created.
- Use `trash`, never `rm`. Never `git stash`.
