# plot-fleetctl --stop unloads another checkout's supervisor

> `plot-fleetctl.sh --stop` boots out whatever job holds the resolved label without asking which checkout the job serves, so a checkout that resolves to the default label stops another repository's supervisor and reports success.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3060
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-fleet --stop` refuses to unload a supervisor that serves another checkout, names that checkout, and unloads nothing.

Board impact: none. The change touches one helper script and its test. No payload field changes.

## Motivation

Measured 2026-11-03 on Plot 2.30.0 with two checkouts on one macOS machine. `websmith` declares no `Fleet label` and runs `com.plot-pm.fleetd`. `ewz-leg` declares no `Fleet label` either, so it also resolves to `com.plot-pm.fleetd`, while its own unit is loaded as `com.plot-pm.fleetd.ewz-leg`. From inside `ewz-leg`, `plot-fleetctl.sh --stop` printed `supervisor unloaded` and booted out `websmith`'s supervisor. The `ewz-leg` job kept running. The operator found out from `launchctl list`.

`--start` reads `supervisor_checkout` before it acts (`refuse_label`, `skills/plot/scripts/plot-fleetctl.sh:1102-1108`) and refuses a job that serves another checkout. `--status` prints `serves: ANOTHER checkout (...)` through `serves_line` (`:255`). `--stop` (`:1277` to `:1364`) never calls `supervisor_checkout`, so the information exists and the stop path does not read it. The agents of the stopped fleet run unsupervised until someone notices, which is the case the `--stop` guardrail "never signal a worker you did not name" exists to prevent.

## Design

### Approach

`--stop` reads `supervisor_checkout` for `$LABEL` before any `bootout`:

- `this <dir>`: stop as today.
- `another <dir>`: refuse, name the checkout the job serves, unload nothing, and exit non-zero. The message points to `--stop` in that checkout or to a `Fleet label` for this one.
- `unknown`: refuse and print the `launchctl print` command, as `--start` does.

The refusal runs before the agent loop, so a refused `--stop` signals no agent either. This reuses `supervisor_checkout` and the wording of `refuse_label`; it adds no second ownership rule.

The helper stays a shell script, and the check is a call to an existing function, so no new duplicate of a domain rule appears (see *A Shell Script Asks The Domain* in `CLAUDE.md`).

### Open Questions

- [ ] Should `--stop` also look for a loaded job with another label whose working directory is this checkout (here `com.plot-pm.fleetd.ewz-leg`) and name it when no job serves this checkout? The issue marks it as helpful. `retire_old_label` (`:616`) already finds a unit serving this checkout under the old label, and could be the model.
- [ ] Should the refusal write a state or action receipt, or only print and exit?

## Slices

### Stop refuses a foreign supervisor

- `bug/plot-fleetctl-stop-unloads-another-checkout` — read `supervisor_checkout` before `bootout` in `--stop`, refuse `another` and `unknown`, with a `test/reconcile/fleetctl.test.mjs` case for each answer.

## Notes

- Source: https://github.com/plot-pm/plot/issues/3060. Related and released: `2026-10-23-plot-fleetctl-ignores-the-fleet-label`.
- Deliverable search 2026-11-03: `supervisor_checkout` exists at `plot-fleetctl.sh:238` and is reused. Nothing else by that name duplicates the slice.
- Unattended run: the design question defaulted to no, so the plan starts in Draft. `Review: pr` follows `Plan PRs: required`; `Impl: own branches` is the repository default for a fix with its own test.
