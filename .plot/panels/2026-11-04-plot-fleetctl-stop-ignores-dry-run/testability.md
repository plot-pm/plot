# Testability juror: plot-fleetctl-stop-ignores-dry-run

Position: amend

## Findings

1. The defect is real and a script-contract test can show it. On `origin/main` at `e54e53815`, the parser sets `dry_run=1` in any mode (`skills/plot/scripts/plot-fleetctl.sh:788`), and the only check after the loop is the mode-required line (`:795`). The `--stop` arm reads no `dry_run`. A test that runs `--stop --dry-run` against a stub `plot-dispatch.sh` therefore records a `dispatch --stop <branch>` call and exit 0 on main, and fails. After the change it records no call and exits 1, and passes. The fail-before/pass-after property holds for the `--stop` case.

2. The sandbox already keeps the test off the operator's machine. `test/reconcile/fleetctl.test.mjs:12-33` and `:193-221` describe `sandbox()`'s `guardBin`, which puts stub `launchctl` (exit 113) and `systemctl` (exit 3) first on `PATH`, and `run()` refuses a call without it (`:280`). The `--stop` cases at `:419-461` already stub `plot-dispatch.sh` in the sandbox root and log its argv. The `--stop` arm makes no board call and no port 7777 read (grep of `plot-fleetctl.sh` for `7777`/`curl`: none). No browser is involved. The test can run without touching the real fleet, launchd or port 7777.

3. The plan's third assertion, "the supervisor still loaded", has no observable in the plan. `stubPlatform` (`fleetctl.test.mjs:1665`) answers `print` from a fixed state and records no call, so a `bootout` on main leaves its answer unchanged and the assertion cannot fail before the change. The stateful stub `stubUnload` (`:1714-1745`) arms an `unload-ticks` file on `bootout`; that file, or an argv log in the `launchctl` stub, is the observable that fails before and passes after.

4. The refusal also covers `--once --dry-run` and `--status --dry-run` (Design, "A refusal also covers `--once` and `--status`"), but the test plan asserts only `--stop`. A Sonnet agent can ship the check scoped to `--stop` and pass the named test, which leaves the plan's own claim unasserted. The Open Question about intentional `--once`/`--status` callers decides scope; whichever answer the slice takes needs a case.

5. The `--start --dry-run` path must stay accepted. `fleetctl.test.mjs:394` already runs it, so a check that refuses too broadly fails an existing test. The plan does not name that test as its regression guard; it should, so the agent runs it.

6. Two more facts the test should pin, both cheap: the start marker `.plot/state/fleet-start.done` still exists after the refused call, and no stop record is written. Both are files in the sandbox root, and the arm writes or removes both on main.

7. The mutation check ("removes the new line and confirms the test fails") is sound for the `--stop` case, given finding 3 is fixed. Without it, only the dispatch-log and exit-code assertions carry the mutation.

## Amendments required

- Name the test file: `test/reconcile/fleetctl.test.mjs`, next to the `--stop` cases at `:419-461`, built on `sandbox()`/`run()` with `guardBin`.
- Make "supervisor not unloaded" observable: use `stubUnload` and assert its `unload-ticks` file is absent, or a `launchctl` stub that appends its argv to a log and assert no `bootout` line. State which one.
- Assert all of: exit status 1; stderr names `--dry-run`, the mode and `--start`; the dispatch stub log is empty; no `bootout`; `fleet-start.done` still exists; no stop record written.
- Add one case per other mode the refusal covers (`--once --dry-run`, `--status --dry-run`), or, if the Open Question restricts the refusal to `--stop`, one case that proves `--once --dry-run` still runs.
- Name `fleetctl.test.mjs:394` (`--start --dry-run`) as the regression case that must stay green.
- State where the check sits relative to the mode-required line at `:795`, so the message for a bare `--dry-run` with no mode is decided and testable.

## Decisions that need a person

- None for testability. The scope question (refuse `--once`/`--status` too) is an agent decision once the search in the Open Question runs.

## Ran versus read

- Ran: `git show origin/main:skills/plot/scripts/plot-fleetctl.sh` (read into scratch), `grep` over it and over `test/reconcile/fleetctl.test.mjs`, `gh issue view 3099`, `sed` over `skills/plot-fleet/SKILL.md:40-50`.
- Read only: the `--stop` arm body past the grep hits and the stub helpers' full bodies. Ran no test suite and no fleet, board or launchctl command.
