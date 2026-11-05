# Testability juror: a-second-mode-flag-in-plot

Position: amend

## Findings

- The behaviour is a script contract and needs no browser. The refusal is an exit code and a stderr line from `plot-fleetctl.sh`, and `test/reconcile/fleetctl.test.mjs` already asserts that shape (`:316-321`, *an unknown argument is named rather than ignored*).
- The harness keeps every case off the operator's fleet. `sandbox()` mints a per-case `fleetLabel` and a `guardBin` with stub `launchctl` and `systemctl` (`fleetctl.test.mjs:215-254`), and `run()` refuses a call without `guardBin` (`:276-297`). No arm under test reads port 7777. A red run of `--stop --start` before the change reaches the `--start` arm, and the stubs hold it there too.
- The loop is not reachable through the sourced form: `PLOT_FLEETCTL_SOURCED` returns at `plot-fleetctl.sh:758-760` (origin/main `fbf670eaf`), before the loop at `:771-793`. So the tests must run the whole script, which the existing pattern does.
- The plan's line claims hold on `fbf670eaf`: the four `mode=` arms sit at `:773-782` and the `--stop` arm at `:1276`.
- **The "no stop record and no signal" test does not fail before the change on an empty fixture.** With no desk, `--start --stop` today runs the `--stop` arm, signals no agent and writes no `.plot/state/fleet-stopped.json` (see `:419-424`, *--stop with nothing running*, and the record rule in `:471-516`). The assertion then passes on main and proves nothing. Only a fixture with a running desk makes the old and new arms disagree.
- **An exit-1 assertion alone can pass before the change.** Pre-change, `--stop --start` runs the `--start` arm, which has several exit-1 refusals (node pin, harness, write probe, missing artifact: `:332-1074`). A test that asserts only `status === 1` can go green on main for the wrong reason. The message is the only discriminator.
- `--status --once` pre-change execs the stub `plot-fleetd.mjs` (`:1030-1033`, stub at `fleetctl.test.mjs:164`) and exits 0, so that case is red before and green after, provided the message is asserted.
- The two decisions the plan proposes (`--stop --stop` passes, `--start 3` keeps working) have no named test. Without one, an implementation that refuses a repeated flag, or that misreads `3` after `--start` next to a second mode, passes the slice's tests.

## Required amendments

1. The "leaves no stop record and sends no signal" test uses a running desk: a `sleep 30` agent and a stub `plot-dispatch.sh` that logs its arguments, as `fleetctl.test.mjs:426-461` does. It asserts that the dispatch log is empty, that the stub `launchctl` received no `bootout`, and that `.plot/state/fleet-stopped.json` does not exist. It cleans the sleeper with `signalOwn`.
2. Every conflict test asserts the stderr message and the order of the two flags (`/--start and --stop are different modes/`), not only the exit code.
3. Add `--stop --stop` (proceeds as `--stop`, with no conflict message) and `--start 3 --stop` (refuses, names `--start` and `--stop`) to the slice's named tests.
4. The slice line states that each new test is run once against `origin/main` before the fix and fails, and names the failing assertion in the PR body.

## Decisions for a person

- The two Open Questions (`--stop --stop`, `-h` beside a mode flag) need a person's answer before approval. The tests in amendment 3 follow whichever answer is recorded.

## Ran versus read

- Ran: `git show origin/main:` over `plot-fleetctl.sh` (lines 740-800, 1030-1037, `mode` grep) and `fleetctl.test.mjs` (header, harness, test names, stop-record and signal sites); `gh pr view 3128`.
- Read only: the plan file. No test suite, fleet, board or host write was run.
