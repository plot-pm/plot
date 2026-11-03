# Panel moderation — plot-fleetctl --stop unloads another checkout's supervisor

Reconciled: **unanimous amend** (layering, safety, seams, testability). Source checked against `origin/main` at `791be809d`; line numbers below are `skills/plot/scripts/plot-fleetctl.sh` unless another file is named.

## Agreement across all four jurors

- **The `supervisor_loaded` guard is missing.** `supervisor_checkout` (`:238-249`) answers `unknown` for a label that is not loaded, so a literal "refuse `unknown`" refuses every `--stop` with no supervisor loaded. `--start` guards its own check (`:1107`). Confirmed in the source.
- **The existing stubs break.** `stubUnload` (`test/reconcile/fleetctl.test.mjs:1519`) prints no working directory, so the cases at `:583`, `:605` and `:625` would read `unknown` and refuse. Testability alone named `stubSystemd` (`:2640`) and the case at `:2738`. Confirmed.
- **`refuse_label` cannot be reused.** It is defined inside the `--start` arm (`:1102`), its `this` arm is a refusal where `--stop` needs a pass, and its `unknown` arm reads `$plat`, which `--stop` never sets. Confirmed.
- **The shell-lines gate is not addressed.** `scripts/check-shell-lines.sh` refuses net growth and stores no allowance. Confirmed.
- **The decision belongs in the domain.** `oldLabelAction` (`packages/domain/src/rules/old-label-migration.ts`) already maps `supervisor_checkout`'s line to an action, reached through `plot-old-label.mjs`. Layering and testability required the move; safety and seams named the rule and left the choice open.

## Findings only some jurors made

- **Desk comparison** (safety F6, seams 3): `$repo_root` is the desk from a desk, so `--stop` from a desk would refuse the main checkout's supervisor. Seams required `plot_repo_root`; safety left it to a person. Confirmed.
- **Second read before the unload** (safety F3): the agent loop can wait minutes, so another checkout's `--start` can load the same label before `unload_supervisor` (`:1363`). Only safety found it.
- **Naming this checkout's own supervisor** (safety F4, seams Q1): both proposed it; layering and testability called it a separate reading and out of scope.
- **`--stop` ignores `--dry-run`** (safety only): confirmed. The stop arm (`:1252-1405`) never reads `dry_run`; only `retire_old_label` (`:629`) does. Filed as #3099.
- **Docs and changeset** (safety, seams): `skills/plot-fleet/SKILL.md` §5 and §4, the `plot-fleetctl.sh` row in `skills/plot/scripts/README.md:56`, and `skills/plot/units/README.md:79`. Confirmed.
- **CI coverage** (testability only): `fleetctl.test.mjs` runs on Linux with stubbed `uname` and `launchctl` and is not in `macos-shell-contract`. Confirmed.
- **Line corrections** (seams, safety): `retire_old_label` is at `:623`, not `:616`; the `--stop` arm runs `:1252-1405`. Confirmed.

## Findings rejected or corrected after checking the source

- **`plot_processes_block` prints the ewz-leg supervisor** (seams Q1): as it stands it does not. It returns silently when every process serves this checkout (`:464`), it prints a block rather than a command, and it compares against `$repo_root`. The plan gives it a second mode instead.
- **`stubUnload`'s systemd arm answers `another 4242`** (safety F2): the stub sets `uname` to `Darwin` (`:1527`), so the systemd branch never runs. Only the launchd `print` needs a working directory.
- **`unload_supervisor` is called at `:1364`** (safety, layering): it is at `:1363`.
- **The old-label bundle test at `:3244` uses `stop` as an unknown verb**: no juror found it. Adding a `stop` verb to `plot-old-label.mjs` changes that case.

## What each juror ran versus read

| juror | ran | read only |
|---|---|---|
| layering | `git show`/`grep` over the script, the rule, the entry, the gate, the shell-and-domain doc; `gh issue view 3060` | the test bodies; the claim about `:419` was derived, not run |
| safety | `git show` of the script, tests, desk-root, gate and rule; `launchctl list` and `launchctl print` on four live jobs and one absent label | the `--stop` control flow and the stubs after the change |
| seams | `git show` of the script, tests, desk-root, gate, skill and units; `git grep` for `--stop` callers; worktree diff against `origin/main` | every shell function; no test or gate run |
| testability | `git show` of the script, tests, `ci.yml`, `package.json`, gate and rule | the stub bodies; no test run |

## Shared blind spot

No juror ran `fleetctl.test.mjs`, `check-shell-lines.sh` or the bundle. Every "breaks case X" and "fails on main" claim is derived from reading. The moderator also ran no test; the shell-lines estimate in the plan comes from the gate's own awk applied to `origin/main` excerpts. No juror checked the old-label bundle test that a new verb collides with.

## Operator decisions, 2026-11-03

1. The decision lives in the domain: `labelAction` beside `oldLabelAction`, reached through `plot-old-label.mjs`; a missing bundle refuses through `broken_install`. `--start` calls it in place of `refuse_label`, and `--status` asks it for the `serves:` line so the slice removes shell.
2. The check runs only when `supervisor_loaded` answers 0.
3. `--stop` compares against `plot_repo_root`; `--start` and `--status` keep `$repo_root`.
4. On `another` and `unknown`, `--stop` refuses before the agent loop, exits 1, keeps the start marker, and names this checkout's own supervisors as `PLOT_FLEET_LABEL=<label> plot-fleetctl.sh --stop` commands.
5. A second owner read runs immediately before `unload_supervisor`.
6. No receipt.
7. Tests as listed in the plan's slice.
8. Docs and changeset as listed in the plan's slice.
9. `--stop --dry-run` is out of scope and filed as #3099.
10. One slice, one branch.
