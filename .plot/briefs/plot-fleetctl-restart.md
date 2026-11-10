## Implementation brief — plot-fleetctl-sh-restart-reloads-the (wave 1: Restart)

- **Plan (canonical):** docs/plans/2026-11-09-plot-fleetctl-sh-restart-reloads-the.md on main
- **Approved:** 2026-11-09, Jan Wloka, plan-PR #3330 merged
- **Branch:** `feature/plot-fleetctl-restart` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the declared channel (`Review: pr`)

The wave `Free loops` (`feature/plot-fleetctl-restart-agents`) waits on this branch: it adds `--agents` to the arm this slice creates. Nothing waits on it otherwise, and it waits on nothing.

### What to build

`plot-fleetctl.sh --restart` loads the current fleetd bundle into the running supervisor and signals no agent. It prints the old supervisor pid, the new pid and the bundle's commit. It refuses wherever `--start` refuses, and it refuses when no unit is loaded.

The failure it fixes, measured 2026-11-09 at about 16:00 (#3329): `--stop` then `--start` was the only way to load new code. Three agents read `running`, all three free loops quiet for about 1 h 45 min. `--stop` stopped one and left two detached desks (pids 4219 and 1006). `--start` then loaded the new supervisor and started no agent ("machine starved, 3 already running"). A watcher waited 3 hours for a gap with no running agent and never found one, because free loops count as running. The operator needed only a fresh supervisor. The plan is canonical; this is orientation. This slice does not stop any agent — that is the next wave.

Find every site by content, not by line number (`--status|--once|--start|--stop)`, `--dry-run works with --start only`, `unload_supervisor`, `supervisor_pid`, `start_marker`). Line numbers drift.

### Settled decisions — do not re-derive

- **launchd reload is `launchctl kickstart -k gui/$(id -u)/$LABEL`, never `bootout` then `bootstrap`.** `bootout` of `com.plot-pm.fleetd` killed every agent the supervisor had started (observed in a fleet session, recorded as a rule after a night of stalled delivery). `kickstart -k` was measured on 2026-10-26: all four worker loops (own pgid, ppid 1, running from their desk worktrees) survived it. Before you write the arm, run `ps -axo pid,ppid,pgid` on a live loop to see that shape on this machine. The unit file's `ProgramArguments` names the bundle path, so the new process reads the current bundle file on start; no re-fill is needed to load new code.
- **systemd reload is `systemctl --user restart "$UNIT_NAME"`.** The unit sets `KillMode=process`, so a restart signals the daemon only; `a-supervisor-restart-leaves-its-agents-running` (Released, #1148) proved that in CI. `--restart` is the operator command for what that plan made true; it adds no unit change.
- **Reuse `--start`'s probes by sharing its arm, not by copying them.** The refusals are inline in the `start` arm: missing artifact, node major against `.nvmrc`, harness resolution, no launchd or systemd, `retire_old_label`, `old_label_refuses` for the checkout label and the default label, and the write probe. Make the arm run for `start` and `restart`, and branch where the arm fills, loads and starts agents. Copying the refusals makes two lists that drift; a function extraction moves lines and the shell-lines gate counts the moved commands as new.
- **`--restart` skips the fill, the `fleet-start.done` marker, `plot-restart-stopped-command.mjs` and `plot-dispatch.sh --start`.** Those belong to a start. A restart that rewrote the marker or started agents would reproduce the `starved` output the operator saw. The marker is left as found.
- **No loaded unit refuses, and nothing starts.** Use `supervisor_loaded`. The refusal names the repair: `/plot-fleet --start`. Loading is `--start`'s job, and a restart that loads a unit nobody loaded hides a stopped supervisor as a success.
- **Report the old pid before the reload and the new pid after it, read with `supervisor_pid`, and poll for the new one.** `kickstart -k` returns before the new process has a pid. Use `poll_while` with the existing bound style, and exit 1 naming the unit when the pid is empty or equal to the old one after the bound. Absent is not false: an unreadable pid prints as unreadable and never as `0`. The commit is read from the bundle's checkout (`git -C "$repo_root" rev-parse --short HEAD`); say `unknown` if it cannot be read.
- **`--dry-run` applies to `--restart`.** Change the final-mode check after the argument loop: `--dry-run` works with `--start` and `--restart`, and `--status`, `--once` and `--stop` still refuse. The refusal text changes to name both modes, and the usage block and `-h` output change with it. The existing case `-h exits 0 and prints --wait and --dry-run` and the `--dry-run works with --start only` assertions need the new wording; update them in this slice. A dry run prints which unit would reload, the current pid and the bundle commit, and writes, signals and reloads nothing. Do not add `--agents` here (next wave).
- **`--restart` is allowed with `PLOT_UNATTENDED=1`.** It stops no agent. The script itself has no unattended check today (the rule lives in `SKILL.md`), so add none; document the carve-out in the skill: "never run `--stop` unattended; `--restart` without `--agents` is allowed".
- **Mode parsing:** add `restart` to the mode case and to the "one of --status, ..." message. The parser is last-mode-wins with a refusal for two different modes (`--start --stop` refuses); `--restart --start` refuses the same way. Do not touch `--start N`'s count rule: `--restart 3` takes no count and refuses as an unknown argument.
- **The rules this repo keeps re-learning:** read the exit code of `launchctl`, not the emptiness of its output; `launchctl print` answers 1 for some absences and 113 for others, so use `supervisor_loaded`, never a hand-read of that code. Every test goes through `run()` with a `guardBin` stub so no case reaches the machine's real `launchctl`.

### Done when

The plan's `## Slices` line for this branch is the specification: `--restart` reloads the supervisor, keeps every agent, reports old and new pid and commit, and refuses with no loaded unit. Contract test: a running free loop and a running busy agent both survive and a new supervisor pid is reported.

Lift these assertions, each of which a naive implementation passes without:

1. **Survival is asserted on the agents' pids, after the reload.** Start two stand-in loops in the sandbox (one named as a free loop, one as a busy agent), run `--restart`, then assert both pids still answer `kill -0`. A test that only reads the exit code passes for an implementation that ran `--stop` first. Catches a reload built on `bootout` or on `plot-dispatch --stop`.
2. **The stub `launchctl` log shows `kickstart -k` and no `bootout`, `bootstrap` or `enable`.** Assert the whole call list, not the presence of one call. Catches the wrong reload verb, which the survival check alone cannot see because the stub has no process group.
3. **A new pid is reported.** Make the stub's `print` answer one pid before the kickstart and a different one after. Assert the output carries both and the commit. Catches printing the same pid twice.
4. **A pid that never changes exits 1.** Stub `print` answers the same pid after the kickstart; assert exit 1 and a message naming the unit. Catches a reload reported as done that did not happen.
5. **No loaded unit refuses.** Exit 1, message names `/plot-fleet --start`, stub log has no `kickstart`. Catches a restart that loads.
6. **`--start`'s refusals reach `--restart`:** the wrong node major, the other-checkout label and an unwritable probe each refuse with the same wording and no `kickstart` in the log. One case per refusal you can reach cheaply; at minimum the node pin and the other-checkout label.
7. **`fleet-start.done` is unchanged** (content and mtime) and `plot-dispatch.sh` is never called (reuse `stubDispatch`, assert no `calls.log`). Catches a restart that re-runs the start tail.
8. **`--restart --dry-run`** prints the unit, the pid and the commit, and the stub log holds no `kickstart`. `--stop --dry-run`, `--once --dry-run` and `--status --dry-run` still refuse.
9. **`--restart` under `PLOT_UNATTENDED=1` succeeds.** Note `run()` must clear `PLOT_UNATTENDED` by default (a worker's env leaks into sandbox tests); set it explicitly in this one case.

Plus: `node skills/plot/scripts/board/plot-local-checks.mjs` — run it before each push and run what it prints. The suites in `CI suites` run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. Also `./scripts/check-bash32-syntax.sh`, `./scripts/check-changeset-packages.sh`, `./scripts/check-helper-table.sh` (the `plot-fleetctl.sh` row in `skills/plot/scripts/README.md` names `--start` and `--stop`; add `--restart`).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches `plot-fleetctl.sh`, so its growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines; joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override. Measure with `./scripts/check-shell-lines.sh --per-file` before and after, and keep the net at or below 0. Sharing the `start` arm (above) keeps the new commands to the branch point, the pid poll and the report. Do not touch `pinned_major()`: `fleetctl.test.mjs` sources the script and calls it.

Docs: `skills/plot-fleet/SKILL.md` gets a `--restart` row in the command table, a section that says it keeps every agent and names the launchd and systemd verbs, the unattended carve-out in its Model Guidance guardrail, and the new refusals; the usage block at the top of `plot-fleetctl.sh` gets the `--restart` line and the `--dry-run` line. The plan says `/plot-fleet` documents both flags; the `--agents` text is the next wave's. Changeset `.changeset/plot-fleetctl-restart.md`, package `'plot': minor`, and `plot-fleet: minor` in the `bumps:` block, because a new flag is new coverage. Description first, the `plan:` and `bumps:` block last.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs`, `skills/plot-fleet/SKILL.md`, the `plot-fleetctl.sh` row in `skills/plot/scripts/README.md`, one changeset. No board source change (`Board impact: none`). Amended 2026-11-09: the restart decision goes in one `packages/domain/src/rules` rule with a unit test and one bundle under `skills/plot/scripts/board/`, so the shell ends at or below its merge base (see the plan Notes). The free-loop rule (`freeLoop(readings)`) belongs to `feature/plot-fleetctl-restart-agents`; write none of it here.

Other branches in flight: the sibling slice `feature/plot-fleetctl-restart-agents` of this plan is not started and edits the same arm; keep the arm's structure simple so it can add `--agents`. Whether another open PR touches `plot-fleetctl.sh` or `skills/plot-fleet/` was NOT verified at dispatch: the host API was rate-limited when this brief was written. Run `gh pr list --state open --json number,files` once before you start and report a collision rather than resolving it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
