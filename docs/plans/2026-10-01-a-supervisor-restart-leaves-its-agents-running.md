# A supervisor restart leaves its agents running

> On Linux, `plot-registryd.service` sets no `KillMode`, so systemd stops the unit by cgroup and ends every agent the supervisor started. The unit sets `KillMode=process`, and a CI step on the ubuntu runner proves that an agent survives `systemctl restart` and `stop`.

## Status

- **State:** Delivered
- **Approved:** 2026-10-02, jwloka, in-session
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1148
- **Review:** in-session
- **Impl:** own branches
- **Started:** 2026-10-02, Jan Wloka, `infra/the-unit-stops-only-its-daemon`
- **Delivered:** 2026-10-02

## Changelog

- On Linux, a stop, restart or crash of the `plot-registryd` systemd unit no longer ends the agents the supervisor started. The unit signals only the daemon's own process; `/plot-fleet --stop` still stops each agent first, through `plot-dispatch.sh --stop`.

<!-- Board impact: none. The unit template and its README change; no plan format, template, helper script or docs/plans layout change. -->

## Motivation

Read on origin/main `0d2b4d5c` 2026-10-01; not yet measured on a Linux host (#1148):

- **No `KillMode`.** `skills/plot/units/plot-registryd.service:27-85` sets `Type=simple` (`:28`), `Restart=always` (`:61`) and no `KillMode`. systemd's default is `KillMode=control-group`: on stop, restart, or exit of the main process, systemd signals every process in the unit's cgroup.
- **Every agent sits in that cgroup.** `ExecStart` runs `plot-registryd.mjs --start-agents --sweep-temp` (`:56`). With `--start-agents` the daemon starts agents through `performer-shell.ts:93`, which runs `plot-dispatch.sh --start 1`. The wrapper, its monitors, the worker loop and `claude` are descendants of the unit's main process. A new process group, which `a-start-returns-while-its-agent-runs` slice 2 gives each agent, does not leave a cgroup; that plan names this in *What this does NOT do* and files it as #1148.
- **Consequence.** `systemctl --user restart plot-registryd`, a unit upgrade, or a crash that `Restart=always` recovers ends every running agent, and their desks keep only what the agents committed.
- **`/plot-fleet --stop` relies on the opposite.** `plot-fleetctl.sh --stop` stops each dispatched agent through `plot-dispatch.sh --stop`, waits up to `--wait` seconds (default 30, `:613`) for each, reports an agent that did not exit as *kept* (`:1165-1167`), and unloads the supervisor last with `systemctl --user disable --now` (`:1179`). On Linux that unload ends every *kept* agent, so the report says *kept* about agents the next command ends.
- **CI checks the unit's syntax only.** `.github/workflows/ci.yml:222-244` fills the template and runs `systemd-analyze --user verify`, which starts nothing.
- **launchd differs and is out of scope.** `runProcess` spawns the dispatcher detached, so the dispatcher's group is not the daemon's (#1148); the plist is not changed.

## Design

### Approach

**No domain rule changes, and no script changes.** How systemd stops a unit is configuration of the unit. No decision moves into or out of the domain, and no `plot-*.sh` script is added or edited.

**The choice: `KillMode=process`.** systemd then sends the stop signal to the main process only, the daemon, and leaves the rest of the cgroup running. The issue names the other known option: start each agent through `systemd-run --user --scope`, which gives it its own scope unit. That option changes the launch path in `plot-dispatch.sh` for Linux only, and the agent's lifetime is already Plot's to manage: manifests, pid files, `--stop`, and the supervisor's reap. `KillMode=process` changes one line and keeps the launch the same on both platforms.

**What `KillMode=process` costs, stated in the unit.** systemd.kill(5) does not recommend `process`, because processes can then outlive the unit's lifecycle. Here that is the intent: an agent is not part of the daemon's lifecycle. After a restart, the agents stay in the unit's cgroup, so `systemctl --user status` lists them under the unit. The comment above the directive says this, and says that `/plot-fleet --stop` stops agents itself before it stops the unit.

**The measurement, as a CI step.** The existing step at `ci.yml:222` fills the unit. A new step after it fills the same template with one difference, `ExecStart` replaced by a stand-in daemon: a shell script that starts `sleep 600` in the background, writes that pid to a file, and then waits forever. Every other directive, `KillMode` included, comes from the shipped file. The step starts the unit, reads the pid, runs `systemctl restart`, and asserts that the pid is alive; then `systemctl stop`, and the same assertion. The step kills the stand-in agent at the end. On origin/main the step fails at the first assertion, because `control-group` ends the `sleep`.

**The README states the behaviour.** `skills/plot/units/README.md`'s Linux section gains one paragraph: a stop or restart of the unit leaves running agents alive, and `/plot-fleet --stop` is how to stop them. The slice also corrects `README.md:178`, which says `--start-agents` is off in both templates while the systemd unit passes it at `:56`.

### What this does NOT do

- It does not change the launchd plist or how agents start on macOS.
- It does not change `plot-fleetctl.sh --stop`; its *kept* report becomes true on Linux.
- It does not adopt agents that a previous daemon started. The new daemon finds them through the registry and the desks, as a tick does today.

### Open Points

- [ ] A user manager on the CI runner. `systemctl --user` needs a running user manager. If the ubuntu runner has none for the `runner` user, the step installs the filled unit as a system unit with `User=runner` added and uses `sudo systemctl`. `KillMode` behaves the same in both managers, and the step states which one it used.
- [ ] If the CI measurement shows that `KillMode=process` does not keep the agent alive across `restart`, the slice stops and the plan is amended to the `systemd-run --user --scope` option instead.

## Slices

### The unit stops only its daemon (Branch: infra/the-unit-stops-only-its-daemon, PR: #1167) <!-- builds: KillMode=process in plot-registryd.service, with a CI restart measurement -->

`KillMode=process` and its comment in `plot-registryd.service`; the CI step after `ci.yml:244`; the README paragraph and the `:178` correction; a `plot` patch changeset.

## Done when

- The new CI step passes on the ubuntu runner: the stand-in agent's pid is alive after `systemctl restart` and after `systemctl stop` of the filled unit. Run against origin/main's unit, the same step fails after the restart (`control-group` ends it), and the PR description gives both runs.
- `systemd-analyze --user verify` still passes on the filled unit (`ci.yml:243`).
- `test/reconcile/fleetctl.test.mjs` passes: the unit still fills and parses.
- The README's Linux section states that a stop or restart of the unit leaves agents running.

## Notes

Read 2026-10-01 from the unit file and the dispatcher's launch path; #1148 records that nothing was measured on a Linux host, and the CI step is that measurement. Cross-reference: `docs/plans/2026-10-01-a-start-returns-while-its-agent-runs.md`, *What this does NOT do*.
