# plot-fleetctl.sh --restart reloads the supervisor and keeps the agents

> `plot-fleetctl.sh --restart` reloads the supervisor unit on the current bundle and leaves every agent running; `--restart --agents` also stops the free loops, each by a checked pid.

## Status

- **State:** Released
- **Type:** feature
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3330 merged
- **Sprint:** ship-2-32-0
- **Issue:** #3329
- **Started:** 2026-11-09, Jan Wloka, `feature/plot-fleetctl-restart`
- **Started:** 2026-11-10, Jan Wloka, `feature/plot-fleetctl-restart-agents`
- **Delivered:** 2026-11-10
- **Released:** 2026-11-11, v2.32.0
- **Story:** <!-- optional -->
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-fleetctl.sh --restart` loads the current fleetd bundle without stopping any agent, and reports the old and new supervisor pid and the bundle's commit. `--restart --agents` also stops free loops and names each agent it keeps and why. `/plot-fleet` documents both.

<!-- Board impact: none. The change touches `plot-fleetctl.sh`, the `/plot-fleet` skill and its tests; no plan format, template or docs/plans layout change. -->

## Motivation

Issue #3329, measured 2026-11-09 at about 16:00. Loading new code into fleetd takes `plot-fleetctl.sh --stop` then `--start`, and that pair stops every agent first.

- Three agents read `running`. All three were free loops with nothing handed over, quiet for about 1 h 45 min.
- `--stop` stopped one. For the two detached desks (`desk-2f3378c5`, pid 4219; `desk-eb2d1039`, pid 1006) it answered "plot-dispatch --stop takes a branch and refuses to guess" and left them running.
- `--start` loaded the new supervisor and started no agent: "machine starved, 3 already running".
- A watcher waited 3 hours for a gap with no running agent and never found one, because free loops count as running.

The operator needed only a fresh supervisor on the current bundle. Agents run detached under their own wrapper (`plot-dispatch.sh:1507`), so fleetd is not their parent, and a reload does not need to touch them. `a-supervisor-restart-leaves-its-agents-running` (Released, #1148) already made that true for the systemd unit's own restart; this plan adds the operator command that uses it.

## Design

### Approach

**`--restart`.** Reload the supervisor unit (launchd or systemd) with the current bundle and signal no agent. Print the old pid, the new pid and the bundle's commit. Refuse wherever `--start`'s probes refuse, and refuse while no unit is loaded, because loading is `--start`'s job.

**`--restart --agents`.** Also stop each free loop: an agent with no slice handed over, no PR, no `PLOT-BLOCKED` marker and no uncommitted work in its desk. A detached desk is stopped by its recorded pid, after the pid and its start time are checked as `plot-worker-state.sh` checks a worker; a recycled pid (start time differs) is never signalled. An agent with work in hand stays, and the output names each one kept and why.

**`/plot-fleet`.** `SKILL.md` documents `--restart`, and its Model Guidance table and guardrails cover it, including the unattended rule.

Layering: the free-loop decision is a rule about agent state, so it belongs in the domain and the script stays a launcher (see *A Shell Script Asks The Domain* in `CLAUDE.md`). Where the rule lives is the first design choice for the slice.

### Open Questions

- [x] Does `--restart --agents` reuse `plot-dispatch.sh --stop <branch>` for desks that have a branch, and use the pid path only for detached desks? → Yes. A desk with a branch is stopped through `plot-dispatch.sh --stop <branch>`, so one stop rule stays; only a detached desk (no branch) takes the pid path, with the pid and its start time checked first.
- [x] Is the free-loop rule a new domain rule, or does an existing agent-state reading already answer it? → A domain rule, because deciding which agent may be stopped is domain behaviour (*The Layering Rule*). The builder first checks the existing agent-state readings (the worker states and the desk readings `plot-worker-state.sh` decides from) and reuses one that already answers "free"; otherwise it adds `freeLoop(readings)` in `packages/domain` with unit tests.
- [x] Which refusals of `--start` apply to `--restart` unchanged (write probe, other-checkout label), and does `--dry-run` apply to `--restart`? → Every probe and refusal of `--start` applies to `--restart` unchanged (Node pin, platform, write probe, other-checkout label), plus its own refusal with no loaded unit. `--dry-run` applies: it reports which unit would reload and, with `--agents`, which agents would stop and which would stay, and changes nothing.
- [x] Is `--restart` allowed unattended? `--stop` is not; a reload kills nothing, but `--agents` does. → `--restart` alone is allowed unattended, because it stops no agent. `--restart --agents` refuses under `PLOT_UNATTENDED=1`, as `--stop` does, because it ends processes.

## Slices

### Restart

- `feature/plot-fleetctl-restart` — `--restart` reloads the supervisor, keeps every agent, reports old and new pid and commit; refuses with no loaded unit. Contract test: a running free loop and a running busy agent both survive and a new supervisor pid is reported. → #3340

### Free loops

- `feature/plot-fleetctl-restart-agents` — `--restart --agents` stops free loops, detached desks by checked pid, and names each agent kept and why. Contract tests: stops the free loop and keeps the busy agent, the agent with an open PR and the agent with a `PLOT-BLOCKED` marker; a recycled pid is refused and never signalled. `/plot-fleet` documents both flags. → #3373

## Notes

- Source: issue #3329. The plan links one way; nothing is written to the tracker.
- 2026-11-09, Restart slice: `check-shell-lines.sh pr` refused #3340 at 36 commands over the merge base, and in-scope trimming yields about 15. The slice writes the restart decision (which unit is loaded, whether the `--start` probes refuse, the report of old pid, new pid and bundle commit) as a rule in `packages/domain/src/rules` with a unit test, and asks it through a bundle under `skills/plot/scripts/board/`. `plot-fleetctl.sh --restart` only calls the bundle and runs the reload it names. The shell diff ends at or below the merge base. The gate has no exemption, and removing unrelated shell is out of scope.
