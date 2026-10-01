## Implementation brief — a-supervisor-restart-leaves-its-agents-running (wave 1: The unit stops only its daemon)

- **Plan (canonical):** `docs/plans/2026-10-01-a-supervisor-restart-leaves-its-agents-running.md` on `main`
- **Issue:** #1148 (open)
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `infra/the-unit-stops-only-its-daemon` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`. The PR description carries two CI runs: the new step green on this branch, and the same step red against origin/main's unit.
- **Review of the code:** per repo convention (PR review, CI green)

The plan has one slice. Nothing waits on it, and it waits on nothing.

### What to build

`skills/plot/units/plot-registryd.service` sets no `KillMode`, so systemd uses `control-group`. A stop, a restart or a crash of the unit signals every process in the unit's cgroup. With `--start-agents` (`:56`) the daemon starts agents through `plot-dispatch.sh --start 1`, so each agent, its worker loop and `claude` are in that cgroup. `systemctl --user restart plot-registryd` ends all of them. `/plot-fleet --stop` reports an agent that did not exit within 30 s as *kept* (`plot-fleetctl.sh:1165`) and then runs `systemctl --user disable --now` (`:1179`), which ends that *kept* agent.

Four changes:

1. `KillMode=process` in `[Service]`, with a comment above it (see below).
2. A CI step after `ci.yml:244` that starts the unit with a stand-in daemon and proves a stand-in agent survives `systemctl restart` and `systemctl stop`.
3. One paragraph in the Linux section of `skills/plot/units/README.md`, and a correction of `README.md:178`.
4. A changeset.

Nothing on #1148 was measured on a Linux host. The CI step is the first measurement. The plan is canonical; this brief records what is settled and where the step can pass without proving anything.

### Decisions the plan settles — do not re-derive them

**`KillMode=process`, not `systemd-run --user --scope`.** The scope option gives each agent its own unit, but it changes the launch path in `plot-dispatch.sh` for Linux only. `KillMode=process` is one line and keeps one launch path on both platforms. Plot already owns the agent's lifetime: manifests, pid files, `plot-dispatch.sh --stop`, the supervisor's reap. Switch to the scope option only if the CI step shows that `process` does not keep the agent alive across `restart`. In that case, stop and write `PLOT-BLOCKED.md`: the plan says it is then amended, and the amendment is not this slice's.

**A new process group is not a fix.** `a-start-returns-while-its-agent-runs` slice 2 gives each agent its own process group. A process group does not leave a cgroup. That plan files this gap as #1148 under *What this does NOT do*. Do not answer this issue with `setsid` or `detached: true`.

**No script changes and no domain changes.** How systemd stops a unit is unit configuration. A diff under `skills/plot/scripts/` or `packages/` is outside this slice. `plot-fleetctl.sh --stop` stays as it is: it already stops each agent before it unloads the unit, and with this change its *kept* report becomes true on Linux.

**The launchd plist does not change.** `runProcess` spawns the dispatcher detached, so on macOS the agent is not in the daemon's group. The plist is out of scope.

**The comment states the cost.** systemd.kill(5) does not recommend `process`, because processes outlive the unit. The comment above the directive says three things: an agent is not part of the daemon's lifecycle, so that is the intent; after a restart the agents stay in the unit's cgroup, so `systemctl --user status plot-registryd` lists them under the unit; and `/plot-fleet --stop` stops agents itself before it stops the unit. Match the file's comment style: an upper-case lead clause, then the reason.

### The CI step — where it can pass without proving anything

**The stand-in replaces `ExecStart` only.** Fill the shipped template with the same `sed` as the step at `:231-236`, then replace the `ExecStart=` line. Every other directive comes from the shipped file, `KillMode` included. A step that writes its own unit proves nothing about the shipped one.

**Put the stand-in in a script file.** systemd expands `$VAR` and `%` specifiers in `ExecStart`, so `$!` and `%` inline in `ExecStart=/bin/sh -c '...'` are rewritten before the shell sees them. Write a script to a temp path. It starts `sleep 600 &`, writes `$!` to a pid file, and then waits forever (`exec sleep infinity`, or `wait` in a loop). Set `ExecStart=/bin/sh <path>`. An absolute path avoids differences between systemd versions.

**Read the pid before the restart.** After `restart`, the new stand-in starts a second `sleep` and can overwrite the pid file. Read the first pid into a variable before `restart`, or have the script write only when the file is absent.

**Prove the agent was in the unit's cgroup.** Before `restart`, assert that `/proc/<pid>/cgroup` names the unit. Without this check, a stand-in that started its agent outside the cgroup passes the step and measures nothing. This is the assertion a naive step leaves out.

**The step must fail on origin/main.** The Done-when list requires a red run against origin/main's unit, and the PR description gives it. The cheapest way to show it on every run is a control in the same step: fill a second copy with the `KillMode=` line deleted, and assert that its agent pid is gone after `restart`. That makes the step discriminating permanently, not only on the day of the PR. If you do not add the control, run the step once on a throwaway commit that deletes the line, and link that run.

**Kill the stand-in agents at the end**, in a step-level `trap` or an `if: always()` cleanup, by the pids you read. Never use `pkill sleep`.

**A user manager on the runner is the open point.** `systemctl --user` needs a running user manager for `runner`. On a GitHub ubuntu runner, `sudo loginctl enable-linger runner` and `export XDG_RUNTIME_DIR=/run/user/$(id -u)` usually start one; check with `systemctl --user is-system-running` or `systemctl --user status` before you depend on it. If no user manager answers, the plan's fallback applies: install the filled unit as a system unit with `User=runner` added and use `sudo systemctl`. `KillMode` behaves the same under both managers. The step prints which manager it used. Close the plan's two Open Points in the PR description with what the runner showed; do not edit the plan for them.

**Keep the existing verify step.** `systemd-analyze --user verify` at `:243` must still pass on the filled unit with `KillMode=process`. Put the new step after it, in the same `validate` job (`ci.yml:96`, `ubuntu-latest`), and give it a heading comment in the style of the step above it.

### The README

**The Linux section gains one paragraph** after the *Stop it, or reload it* block (README section starting at `:89`): a stop or restart of the unit leaves running agents alive, and `/plot-fleet --stop` is how to stop them.

**`README.md:178` is false for both templates, not only for systemd.** It reads *"The flag is off in both unit templates."* On origin/main the service passes `--start-agents --sweep-temp` at `:56`, and the plist passes both as `ProgramArguments` entries (plist `:40-41`). The plan names only the systemd unit. Rewrite the sentence to state current behaviour for both: both templates pass `--start-agents`, and a person who wants a deciding-only daemon removes it.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive step passes without them:

- **The pid is read from the unit's cgroup before the restart.** It catches a stand-in whose agent was never at risk.
- **The step is red against origin/main's unit.** It catches a step that passes whatever `KillMode` says, for example because the user manager never started the unit and every `systemctl` call failed quietly. Check the exit codes of `systemctl start`, `restart` and `stop`; a step that ignores them can pass with nothing running.
- **Every directive except `ExecStart` comes from the shipped file.** It catches a step that tests a unit nobody ships.

Plus the repo's gates:

- `nvm use` (Node 24), then `pnpm test` and `pnpm run test:contracts`. `test/reconcile/fleetctl.test.mjs` asserts that every non-comment line of the filled unit is `Key=Value` and that `ExecStart` passes `--start-agents --sweep-temp`. `KillMode=process` passes both; do not edit those tests.
- Adding a `KillMode` assertion to `fleetctl.test.mjs` beside *"the systemd unit keeps its Nice"* is in scope and cheap. It holds the directive on a machine without systemd.
- `pnpm run test:e2e` is CI's gate, not a local one. Do not run it.
- A changeset, `'plot': patch`, description first, `bumps:` block last (`skills: plot: patch`). Use the plan's `## Changelog` line as the description. `./scripts/check-changeset-packages.sh` checks it.

### Bookkeeping

- Claim the branch with the first push. Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the CI step is still moving). Do not run `gh pr create`.
- When the PR exists, annotate the plan's slice heading inside the parentheses: `(Branch: infra/the-unit-stops-only-its-daemon, PR: #<number>)`. A trailing `→ #N` after a heading parses as no PR.
- Commit prefix `plot:` (the units belong to the hub skill).
- Expect several CI round trips for the runner's user manager. Cancel a superseded run before you push the next commit.

### Scope guard

This branch owns:

- `skills/plot/units/plot-registryd.service`
- `skills/plot/units/README.md`
- `.github/workflows/ci.yml` — the new step only
- `test/reconcile/fleetctl.test.mjs` — one assertion, if added
- `.changeset/<name>.md`
- the plan's slice heading, for the PR annotation

Verified at dispatch on 2026-10-02: no other remote `feature/`, `bug/` or `infra/` branch changes `skills/plot/units/` or `.github/workflows/ci.yml`. Since 2026-10-01, two commits changed `ci.yml` on main (`442e7c97`, `8d6b88b2`); neither moved the lines this slice reads.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
