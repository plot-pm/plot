# Testability juror — plot-fleetctl --stop unloads another checkout's supervisor

Position: amend

All line numbers below refer to `origin/main`: `skills/plot/scripts/plot-fleetctl.sh` (1405 lines) and `test/reconcile/fleetctl.test.mjs` (3302 lines).

## Summary

The fix targets the right defect, and the suite already has the seams to test it. On Linux CI a stub `uname` that answers `Darwin` and a stub `launchctl` on `PATH` drive the launchd arm. The slice line under-specifies the tests in three ways. First, a naive `unknown` refusal breaks at least four existing `--stop` cases and the systemd `--stop` case, and the plan names none of them. Second, a test that asserts only "exit non-zero" passes on main as well. Third, the plan does not name the stub that records `bootout`. An unattended Sonnet agent can build this, but only after the plan states which stub to use, what to assert, and which existing fixtures change.

## Findings

### 1. The stubs can already model all three answers

- `holdLabel(box, guardBin, workdir)` (`fleetctl.test.mjs:2250-2267`) prints `working directory = <workdir>` for any label, or no such line when `workdir === null`. It appends every non-`print` call to `launchctl.calls`, which `launchctlCalls` (`:2269`) reads. Refusal 4 of `--start` uses it through `startAgainst` (`:2271-2277`), and it asserts `calls` equals `[]` (`:2286`). This stub covers `another`, `unknown` (null) and `this` (`s.root`), and it can prove that nothing was booted out.
- `stubPlatform(box, { loaded: { label, workdir } })` (`:1450-1491`) answers for one label only. It does not record calls, and `bootout` exits 113, so the job stays "loaded". On main, a stop against it prints `did NOT unload` and exits 1. A test built on it that asserts only `status !== 0` passes on main.
- `supervisor_checkout` (`plot-fleetctl.sh:238-249`) compares physical paths. The `--start` symlink case (`fleetctl.test.mjs:~2297`) shows that the `this` arm needs a symlinked root case too.

### 2. These tests run on Linux CI; bash 3.2 is checked only for syntax

- `test:contracts` runs `test/reconcile/*.test.mjs` (`package.json:19`) on `ubuntu-latest`. `platform()` (`plot-fleetctl.sh:132-133`) reads `uname -s` and `command -v launchctl`, and both resolve through the stubbed `PATH`. So the launchd arm runs on Linux, as the comment at `fleetctl.test.mjs:1405-1416` states.
- `macos-shell-contract` (`ci.yml:409-520`) runs a fixed list of 17 `*gate*.test.mjs` files under `/bin/bash` 3.2. `fleetctl.test.mjs` is not in that list. A changed `.sh` file selects the job, but the job never executes `--stop`. Bash 3.2 coverage of the new branch is therefore only `scripts/check-bash32-syntax.sh`, a syntax gate. This holds for every other `fleetctl` change too, so it does not block this plan. The plan should state it and not claim more.

### 3. A naive `unknown` refusal breaks existing cases

`supervisor_checkout` answers `unknown` whenever `supervisor_workdir` is empty (`:240-241`), and that includes a label that is not loaded. The plan's Approach says "`unknown`: refuse" and puts the check "before the agent loop". It does not say "only when `supervisor_loaded`". Read literally, the change breaks the following cases:

- `--stop with nothing running` (`:419`) and `--stop of an unloaded supervisor still exits 0` (`:658`): the label is not loaded, so `unknown` is returned and the stop refuses.
- `--stop polls the unload past a still-loaded first answer` (`:583`), `--stop keeps the marker and exits 1` (`:605`) and `--stop reports BOTH` (`:625`): `stubUnload` (`:1519-1554`) prints `pid = 4242` and no working directory, so even a correctly guarded check returns `unknown` and refuses. These cases then assert `supervisor unloaded` or `did NOT unload` and fail.
- `systemd: --status and --stop ask about the unit --start wrote` (`:2738-2756`): `stubSystemd`'s `show` (`:2640`) prints only `MainPID`. `WorkingDirectory` returns empty, so `unknown` is returned, `disable` is never called, and the assertion at `:2750` fails.
- `--stop calls plot-dispatch --stop once per branch` (`:426`) is safe only if a not-loaded label skips the check.

### 4. A new case passes on main unless it asserts the right fact

On main, `--stop` with `holdLabel(..., other)` calls `plot-dispatch.sh --stop` for every running desk, records `bootout gui/<uid>/<label>` in `launchctl.calls`, and prints `supervisor unloaded`, because `holdLabel` exits 0 on `bootout`. The poll then still reads the job as loaded, so the run prints `did NOT unload`. Exit status alone does not separate main from the fix in either direction. Each new case must assert:

- `launchctlCalls(calls)` equals `[]` (this fails on main);
- the refusal names the serving checkout, using the path regex from `:2284`;
- a stubbed `plot-dispatch.sh` (the pattern at `:439-442`) was never called, with one running desk present. This proves the plan's claim that the refusal runs before the agent loop. Without a desk, that claim is untested;
- the start marker is kept (`armedMarker`, used at `:589`).

### 5. The issue's own scenario uses the default label

The defect occurs when the label resolves to `com.plot-pm.fleetd` with no `Fleet label` set. `run()` clears `PLOT_FLEET_LABEL` (`:291`), and the guard stub intercepts every `launchctl` call, so a case can run under the default label safely. Under the default label, `retire_old_label` (`plot-fleetctl.sh:616-627`) also runs. `holdLabel` answers `print` for `com.plot-pm.registryd` too, so the old-label rule reads `another` and returns `leave`. The case still holds, but the plan should name the default label explicitly, so that the test reproduces #3060 and not only a custom-label variant.

### 6. The plan reuses `refuse_label`, but `--stop` cannot call it

`refuse_label` is defined inside the `--start` block (`plot-fleetctl.sh:1013-1247`, the definition at `:1102`). Its `*)` arm reads `$plat`, which only `--start` (`:1067`) and `--status` (`:781`) set, under `set -u` (`:62`). An agent that "reuses the wording" by calling the function from `--stop` gets "command not found". An agent that copies the arm gets an unbound variable. The plan must state whether the agent moves `refuse_label` to top level or writes `--stop`'s own text.

### 7. A domain rule already answers this question

`packages/domain/src/rules/old-label-migration.ts:50` (`oldLabelAction`) maps `this`/`another`/`unknown` to `unload-and-remove`/`leave`/`refuse`. The shell asks it through `plot-old-label.mjs` (`plot-fleetctl.sh:606-613`) by piping `supervisor_checkout` into the bundle. The `--stop` decision for the current label has the same shape. A rule in the domain can be tested in vitest with no stubs, while a `case` in shell can be tested only through stubbed `launchctl`. `scripts/check-shell-lines.sh` (`ci.yml:1509-1511`) also refuses any net growth of shipped shell, and the plan does not account for it. Every added line in `plot-fleetctl.sh` must be offset in the same change. The plan's statement "adds no second ownership rule" is false as written: the shell `case` becomes a third decision site, after `refuse_label` and `oldLabelAction`.

## Required amendments

1. Approach: state that the check runs only when `supervisor_loaded` answers 0. A label that is not loaded keeps `supervisor was not loaded` and exit 0, and `:419` and `:658` stay green unchanged.
2. Approach: name the exit code of the refusal. The script uses 1 for a failed stop and 3 for an estate refusal (`:3262`). The test asserts that one code.
3. Approach: say how the wording is reused, either by moving `refuse_label` to top level with `$(platform)` in place of `$plat`, or by giving `--stop` its own text. Do not leave "reuses the wording" open.
4. Slice: name the test changes explicitly:
   - New cases built on `holdLabel` under the DEFAULT label (no `PLOT_FLEET_LABEL`): `another` (assert that the checkout is named, `calls` equals `[]`, the stubbed `plot-dispatch.sh` was not called with one running desk, and the marker is kept); `unknown` (`workdir: null`; assert the `launchctl print gui/$(id -u)/com.plot-pm.fleetd` line and `calls` equals `[]`); `this` (`s.root` and a symlinked root; assert that `bootout` is recorded).
   - Changed fixtures: `stubUnload` emits `working directory = <root>` on `print`, and `stubSystemd`'s `show` answers `WorkingDirectory` with the root. Without these changes, cases `:583`, `:605`, `:625` and `:2738` fail.
   - Each new case is shown to fail on main by its `calls`/dispatch assertion, not by its exit status.
5. State the CI coverage plainly: the cases run on Linux under the stubbed launchd arm, bash 3.2 is checked for syntax only, and `macos-shell-contract` does not execute this path.
6. Account for `check-shell-lines.sh`: either put the decision into `oldLabelAction`'s module (or a sibling rule) behind the existing bundle and remove shell, or name the lines the slice removes to offset its additions.

## Decisions that need a person

- Open Question 1 (name a job under another label whose working directory is this checkout): the default answer here is "no, out of scope; file it". An unattended agent must not decide this. Resolve it in the plan before approval, because an unchecked box in a dispatched plan invites scope creep.
- Open Question 2 (receipt or print only): a refusal writes no `State:` line, so no receipt is required. The plan should record "print and exit" as the answer.
- Whether the three-way decision moves into the domain (amendment 6) or stays a shell `case` with an offset: this is a layering decision. The layering juror may weigh it differently.

## What I ran versus what I read

- Ran: `git show origin/main:` for `plot-fleetctl.sh`, `fleetctl.test.mjs`, `ci.yml`, `package.json`, `check-shell-lines.sh` and `old-label-migration.ts`; `grep`/`sed` over those copies; `gh issue view 3060`; `git grep` for `WorkingDirectory` in `skills/plot/units`.
- Read only, not executed: I ran no test and no fleetctl command. The claims "fails on main" and "breaks case X" come from reading the stub bodies (`holdLabel`, `stubPlatform`, `stubUnload`, `stubSystemd`) against `supervisor_checkout`/`supervisor_workdir`. I did not confirm them by running the suite.
