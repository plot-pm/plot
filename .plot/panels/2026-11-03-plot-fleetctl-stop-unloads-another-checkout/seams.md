# Seams juror — plot-fleetctl --stop unloads another checkout

Position: amend

The approach is right: `--stop` must read `supervisor_checkout` before `bootout`, and the information already exists. The plan as written breaks three existing tests, refuses a sanctioned caller (a desk), cannot call the function it says it reuses, and ignores the shell-lines gate. Each is fixable inside the one slice. Both open questions can be settled now from the code.

All line numbers below are `skills/plot/scripts/plot-fleetctl.sh` on origin/main (`0723f9dd5`, identical to the worktree's file) unless another file is named.

## Findings

### 1. `unknown` also means "not loaded", so a literal build refuses every stop with no supervisor (HIGH)

`supervisor_checkout` (`:238-249`) answers `unknown` whenever `supervisor_workdir` is empty. `supervisor_workdir` (`:205-214`) is empty for a label the init system does not hold. The plan says "`unknown`: refuse". Built literally, `--stop` refuses on a machine with no supervisor loaded, and the existing test `--stop of an unloaded supervisor still exits 0 and says so` (`test/reconcile/fleetctl.test.mjs:659-672`) fails. The check must run only inside `supervisor_loaded`, the way `--start` gates it (`:1107`: `supervisor_loaded && refuse_label ...`). The plan does not say so.

### 2. Three existing `--stop` tests stub a loaded job with no working directory (HIGH)

`stubUnload` (`fleetctl.test.mjs:1515-1553`) answers `print` with `pid = 4242` only, and no `working directory =` line. So `supervisor_checkout` reads `unknown` for every test built on it: `--stop polls the unload past a still-loaded first answer` (`:582`), `--stop keeps the marker and exits 1` (`:605`), and `--stop reports BOTH a stuck agent and an unconfirmed unload` (`:626`). With an `unknown` refusal, all three refuse before `bootout` and fail. The slice must extend `stubUnload` with a working directory (the sandbox root) so they keep testing the unload. The plan names only new cases.

### 3. A desk is part of the estate, and from a desk the supervisor reads as `another` (HIGH)

`repo_root` is `git rev-parse --show-toplevel` (`:69`), which inside a linked worktree is the DESK, not the main checkout (`plot-desk-root.sh:25-28` states this). The supervisor's working directory is the main checkout (`units/plot-fleetd.service:35`, plist `:51`, both `__REPO_ROOT__`). `resolve_wt_root` (`:714-724`) deliberately ACCEPTS `--stop` from a desk under the estate (#1439; tests at `fleetctl.test.mjs:3267` and `:3287` for `--status`). So the plan's check turns a working `--stop` from a desk into an `another` refusal that names the operator's own main checkout. The comparison for `--stop` must use `plot_repo_root` (the main checkout, already sourced at `:711`), not `$repo_root`. `serves_line` in `--status` has the same latent defect today; it only prints, so it is not this slice's, but a follow-up issue is worth filing.

### 4. `refuse_label` cannot be reused as the plan says (MEDIUM)

`refuse_label` is defined INSIDE the `--start` arm (`:1102`), and its third case prints `$plat`, which only `--start` (`:1067`) and `--status` (`:781`) set. Its wording is `--start`'s: "is already loaded", "To restart it: /plot-fleet --stop, then /plot-fleet --start", "That supervisor is not yours to stop". The `this` case is a refusal there and must be a pass here. "Reuses the wording of `refuse_label`" is therefore not an instruction an agent can follow. The slice needs its own `--stop` messages. The issue already supplies the `another` text: "`<label>` serves <dir>, not this repository — nothing unloaded. Run --stop there, or give this checkout its own `Fleet label`." For `unknown`, use `$(read_cmd)` (`:559-564`) and `$(platform)` rather than `$plat`.

### 5. The shell-lines ratchet refuses a net-positive diff, and the plan does not budget for it (MEDIUM)

`scripts/check-shell-lines.sh` counts every `.sh` under `skills/` against the merge base, stores no allowance, and CI runs it on every PR (`.github/workflows/ci.yml:1498-1511`). The plan says "the check is a call to an existing function, so no new duplicate appears" — true, but the ratchet counts commands, not duplicates. A `case` with two refusal arms plus the call adds roughly 5-8 counted commands to `plot-fleetctl.sh`. The slice must remove as many elsewhere in the same change, or the gate refuses the PR. An unattended agent meets this at CI with no guidance. The plan must name where the lines come from. One candidate: hoist `refuse_label` out of `--start` and parameterise its verb, so `--start` and `--stop` share one `case` instead of two.

### 6. Docs and changeset are missing from the slice (MEDIUM)

"The change touches one helper script and its test" is incomplete:

- `skills/plot-fleet/SKILL.md` §5 (`:217-280`) documents `--stop` and lists no refusal for it; §4 table (`:167-176`) lists only `--start` refusals. An agent reading a refusal needs its repair row (Model Guidance step 3, `:64`).
- `skills/plot/units/README.md:79` tells a second checkout to set the label for `--stop`; one sentence that `--stop` now refuses a job serving another checkout belongs there.
- A changeset is required: package `plot`, a patch, with `bumps: skills: plot-fleet: patch` (SKILL.md is at `1.4.0`), description first and `plan:` line inside the comment block (`CLAUDE.md` › Versioning). The plan's `## Changelog` line is a good description.

### 7. Board impact: none — confirmed

No board or package source calls `plot-fleetctl.sh --stop`: `git grep "'--stop'"` over `packages/*/src` finds only `ci-suite.ts:336`, a flag list. `plot-dispatch.sh` does not call `plot-fleetctl.sh --stop`. The skill is the only caller. No payload field changes.

### 8. The systemd arm and bash 3.2

`supervisor_workdir` has a systemd arm (`:208`, `systemctl --user show -p WorkingDirectory`), and the unit template sets `WorkingDirectory=__REPO_ROOT__`, so the check works on Linux with no new arm. The comment at `:199-200` says that arm was never run on Linux; the slice inherits that. The tests force `uname` to `Darwin` (`stubUnload`, `:1527`), so CI on `ubuntu-latest` exercises the launchd arm through stubs. Note: `stubUnload`'s `systemctl show` answers `4242` for every `-p`, so a future systemd-arm test would read the working directory as `4242`; not this slice's concern unless it adds such a test. `case "$x" in this\ *)` is bash 3.2-safe and `--start` already uses it; `check-bash32-syntax.sh` runs in the local checks.

### 9. Line references in the plan are copied from the issue

`retire_old_label` is at `:623`, not `:616`. The `--stop` arm runs `:1252-1405`, not `:1277-1364`; the `bootout` block the check must precede is `:1340`, and the agent loop it must also precede starts at `:1254`. `supervisor_checkout` `:238` and `refuse_label` `:1102-1108` are correct.

## Open questions — both settle from the code

**Q1 (name a job under another label that serves this checkout): yes, and the model is `plot_processes_block`, not `retire_old_label`.** `retire_old_label` (`:623-635`) asks one fixed label (`com.plot-pm.registryd`), so it cannot find `com.plot-pm.fleetd.ewz-leg`. `plot_processes_block` (`:381-470`) already finds every supervisor by PROCESS, reads its cwd, and reads its label from `launchctl list` (`:451`) or the systemd cgroup (`:453-456`). `--status` calls it at `:987`. On the refusal path, one call `plot_processes_block "$(supervisor_pid)"` prints the ewz-leg supervisor with its label and `serves: THIS repository`, which is what the issue asked for, at the cost of one counted line. The refusal text then adds: "Stop a supervisor under another label with `PLOT_FLEET_LABEL=<label> plot-fleetctl.sh --stop`" — `PLOT_FLEET_LABEL` outranks the config key (`:82`), so that command works today. Whether to also call it on the "supervisor was not loaded" path (`:1387`) is the same one line, and it closes the second half of the issue's misleading success; recommend yes.

**Q2 (receipt): no.** Receipts exist for `State:` writes (`plot-state-gate.sh`) and controller actions (`plot-state-receipt.sh --unowned-action`). `plot-fleetctl.sh` is neither; no gate names it (`git grep fleetctl` over the gate scripts and hooks finds nothing). A `--stop` refusal changes nothing, so it prints, unloads nothing, and exits non-zero. Name the exit code: `1` matches `--start`'s refusal 4 (`:1107`).

## Amendments required

1. Run the check only when `supervisor_loaded` answers loaded; "not loaded" keeps today's `supervisor was not loaded` path and exit 0.
2. Compare the served directory against `plot_repo_root` (main checkout), not `$repo_root`, so `--stop` from a desk under the estate still stops. Add a test: `--stop` from a desk unloads a supervisor whose working directory is the main checkout.
3. Write `--stop`'s own refusal text for `another` and `unknown` (do not call `refuse_label` as it stands); use `read_cmd` and `platform`, not `$plat`. Refuse before the agent loop (`:1254`), exit 1.
4. Extend `stubUnload` to emit `working directory = <sandbox root>` so the three existing unload tests keep reaching `bootout`. New tests: `another` refuses, names the dir, never calls `bootout` (assert on the stub's counter file staying absent), exit 1; `unknown` (loaded, no working directory) refuses and prints the `launchctl print` command, exit 1; `this` unloads as today. Each fails on main: today `--stop` unloads on all three.
5. Budget the shell-lines ratchet: name where the added counted commands are removed in the same diff (for example, one shared refusal function for `--start` and `--stop`).
6. Add `skills/plot-fleet/SKILL.md` §5 refusal text and repair, one sentence in `skills/plot/units/README.md`, and a changeset (`plot` patch, `plot-fleet: patch`, `plan:` line).
7. Close both open questions as above: call `plot_processes_block` on the refusal path (and on the not-loaded path); no receipt.
8. Correct the line references (finding 9).

## Decisions for a person

- Whether a refused `--stop` should still stop this checkout's own agents. The plan refuses before the agent loop, which is coherent (a supervisor under `KeepAlive` restarts agents anyway), but it means an operator in the issue's situation stops nothing until they pass `PLOT_FLEET_LABEL`. The skill already says never run `--stop` unattended (`SKILL.md:69`), so this does not block the fleet; it is a product choice, and the plan's choice is defensible. I recommend keeping it.

## What I ran versus read

Ran (read-only): `git fetch origin main`; `git show origin/main:` of `plot-fleetctl.sh`, `fleetctl.test.mjs`, `plot-desk-root.sh`, `check-shell-lines.sh`, `skills/plot-fleet/SKILL.md`, `skills/plot/units/*`; `git grep` for `--stop` callers in `packages/*/src`, gate scripts and skills; `gh issue view 3060`; `git diff` of the worktree's `plot-fleetctl.sh` against origin/main (identical). Read only, not executed: every shell function cited; I did not run `fleetctl.test.mjs` or `check-shell-lines.sh`, so findings 1, 2 and 5 are derived from the code, not observed failures.
