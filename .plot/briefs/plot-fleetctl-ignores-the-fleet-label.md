## Implementation brief — plot-fleetctl-ignores-the-fleet-label (wave 1: Resolve the label from config)

- **Plan (canonical):** `docs/plans/2026-10-23-plot-fleetctl-ignores-the-fleet-label.md` on main
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2418 merged
- **Branch:** `bug/plot-fleetctl-ignores-the-fleet-label` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review); issue #2408

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

`plot-fleetctl.sh:90` reads the supervisor label as `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.fleetd}"` and never asks `plot-config.sh get "Fleet label"`. Measured 2026-10-23 in `ewz-kus-portal` (declares `Fleet label: com.plot-pm.fleetd.ewz-kus-portal`, `PLOT_FLEET_LABEL` unset): `--status` printed `supervisor: running (pid 938) — com.plot-pm.fleetd` and `serves: ANOTHER checkout (…/websmith)`. The default label belongs to another checkout, so this repository reads that checkout's supervisor as its own.

Resolve `LABEL` in this order: `PLOT_FLEET_LABEL` when set and non-empty, then the `Fleet label` key, then `com.plot-pm.fleetd`. Read the key the way `plot-boardctl.sh:225` reads `Board port`: `PLOT_REPO_ROOT="$repo_root" "$script_dir/plot-config.sh" get "Fleet label" "" 2>/dev/null || label=""`, and treat a failed read as an absent key. `repo_root` is set at `plot-fleetctl.sh:119`, after the current `LABEL` line, so move or split the assignment so the key read follows `repo_root` and `LABEL` is set before its first use.

Docs, same change: `skills/plot-fleet/SKILL.md` (the "One supervisor per repository" bullet at ~line 276 and the "a unit with that label is already loaded" refusal row at line 175), `skills/plot/units/README.md` (line 7, lines 76-89 and the "Two repositories need two units" paragraph at line 143 — they tell the operator to set the variable), and `skills/plot/SKILL.md` beside the `Board port` paragraph at line 271. State the precedence in each place: variable, then `Fleet label`, then default. Bump no version by hand; write a changeset (description first, `bumps:` block last, skills `plot` and `plot-fleet` at patch).

### Settled decisions — do not re-derive

**The environment variable stays first.** `test/reconcile/fleetctl.test.mjs` names a label through `PLOT_FLEET_LABEL` so launchd never sees the operator's live job (launchd labels are machine-global; no `HOME` override reaches them — see the comment block at `plot-fleetctl.sh:69`). A config key that wins over the variable makes the suite read the operator's fleetd again. A test that sets only the key must clear the variable (`PLOT_FLEET_LABEL: undefined`, as the harness does near line 275).

**A config label takes the same `unit_name` mapping as a variable label.** No second derivation rule. Add no new character validation in this slice; if a value fails at `--start`, report a follow-up. Answer the plan's three open questions in the PR description: skip the `--status` source line unless it is one line and a test covers it; for other readers of the variable, `grep` finds only `plot-fleetctl.sh`, the plist comments, the README and the tests, so no other script needs the resolution.

**Absent is not a value.** A missing config file, a missing key, an empty value and a failing `plot-config.sh` all mean "use the default". Never exit on a failed read.

**Test every source and the precedence.** `test/reconcile/fleetctl.test.mjs` gets a case per source (variable only, key only, neither) and one where both are set and the variable wins. Each case uses distinct labels so the arms disagree; otherwise a wrong precedence passes.

### Done when

The plan has no `## Done when` list; its Slices line is the specification: `plot-fleetctl.sh` resolves the label from the variable, the key and the default, in that order, with a reconcile test for each source and for the precedence; the skill text and units README say where the label comes from.

Plus: a changeset, and `scripts/check-changeset-packages.sh` passes. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run the `fleetctl` tests by name for the cases you touch, not as a whole-file run under load. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base: the key read adds shell lines to `plot-fleetctl.sh`, so remove an equal number of shell lines elsewhere in the same change (for example, trim the label comment block at `:69-89` to what is still true), or write the rule in the domain and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`. Append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

Owned: `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs`, `skills/plot-fleet/SKILL.md`, `skills/plot/units/README.md`, `skills/plot/SKILL.md`, one changeset. Do not touch `plot-boardctl.sh` or `packages/**`; touch the plist comments only for wording. No other branch of this plan is in flight. If you find something the plan did not anticipate, report it rather than improvising outside scope.
