## Implementation brief — a-unit-name-follows-the-label

- **Plan (canonical):** `docs/plans/2026-09-29-a-unit-name-follows-the-label.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-unit-name-follows-the-label` (base: `main`, claimed at `95b1b091`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review + CI)
- **Issue:** #1053

Single-slice plan: nothing waits on this branch and it waits on nothing. It is the systemd half of #1051 (`d80f32e1`), which fixed launchd only.

### What to build

`skills/plot/scripts/plot-fleetctl.sh` derives the launchd unit from `$LABEL` (`$LABEL.plist`) and hardcodes `plot-registryd` on every systemd site. Consequences, both reproduced on macOS under `stubPlatform`:

1. Two checkouts with different `PLOT_FLEET_LABEL` values write ONE file, `~/.config/systemd/user/plot-registryd.service`; the second write replaces the first.
2. Refusal 4 (`:672-700`) names the operator's label and asks `supervisor_loaded`, which reads the hardcoded unit (`:156`). So checkout B, started under its own label while A's default unit is active, is REFUSED and told to do what it just did.

Add one function, `unit_name()`, that maps `$LABEL` to a systemd unit name, and route every systemd routing site through it. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The mapping is decided.** Strip a leading `com.plot-pm.registryd.`, sanitise the remainder to `[A-Za-z0-9:_.-]`, prefix `plot-registryd-`. The exact default label `com.plot-pm.registryd` is a named special case that returns `plot-registryd` (file `plot-registryd.service`). Rejected alternatives, each failing a `Done when` or re-creating the defect:

- `tr . -` over the whole label → the default becomes `com-plot-pm-registryd`, which orphans every existing Linux install.
- last dotted segment → `com.a.portal` and `com.b.portal` collide into one unit: the same defect, one level down.
- bare prefix on the whole label → a dotless `plot-registryd-ewz` stutters into `plot-registryd-plot-registryd-ewz`.

The chosen rule lands on the shape `units/README.md:133` already documents (`plot-registryd-<name>.service`), so an operator who followed the README by hand gets their unit adopted rather than orphaned. Sanitisation is required: `PLOT_FLEET_LABEL` is an unconstrained env var and systemd accepts only `[A-Za-z0-9:_.-]`.

**The routing sites are ten lines, nine call sites, all still at the plan's line numbers (verified at dispatch):** `:156` `is-active` (refusal 4 gates on this), `:167` `MainPID`, `:191` `WorkingDirectory`, `:280` `unit_target`, `:513` printed remediation, `:694` `how` string, `:732` install `target=`, `:785`/`:786` `enable --now` and its failure message, `:913` `--stop`'s `disable --now`.

**Two sites stay hardcoded.** `:731` `template="$UNIT_DIR/plot-registryd.service"` is the SHIPPED TEMPLATE's filename, not a routing site. `plot-registryd.mjs` (`:38`, `:97`) is the bundle. Deriving either breaks the install.

**No identity field is added to the unit.** A systemd unit's identity is its filename; the template keeps its three placeholders. The launchd arm is untouched. No migration of installed units: `--stop` then `--start` under the old label is the upgrade path, as #1051 records.

**Tests run on macOS, no CI round trip needed.** `plot-fleetctl.sh:111-117` resolves the platform via `uname -s` and `command -v systemctl` through `PATH`; `stubPlatform` in `test/reconcile/fleetctl.test.mjs` (`:830`) already stubs both with `kernel: 'Linux'`. Extend the `systemctl` stub to record its argv (e.g. append to a file) so a test can assert which unit name each call carried.

Invariants carried over: read the exit code, not the emptiness; an absent answer is not a "no".

### Done when

The plan's `## Done when` list is the specification. The assertions that exist because a naive implementation would pass without them:

- **Unset override → `plot-registryd.service`, asserted.** A fix that only handles the override path can silently rename every existing install.
- **Refusal 4 reads the unit it names.** Test: A's default unit is "active" in the stub, B starts with a distinct label → B is NOT refused. A fix touching only `:280`/`:732` writes distinct files and still refuses B.
- **`--stop` disables the derived name** (`:913`). Assert on the recorded `systemctl` argv, not on exit status — `disable` output is discarded with `>/dev/null 2>&1`, so a wrong name still exits cleanly.
- **`test/reconcile/fleetctl.test.mjs:1297` is updated.** Its non-darwin branch computes the target with the same hardcoded name, a second copy of the rule that keeps passing after the fix.
- **A grep gate over the systemd arm** fails on a hardcoded `plot-registryd` in a `systemctl` call and excludes `:731`.
- **`units/README.md:7` and `:133` reconciled**: `:7`'s "a second checkout needs no hand steps" becomes true on Linux; `:133` describes `PLOT_FLEET_LABEL` and the derived name instead of a manual copy. Update the `systemctl`/`journalctl` examples near `:113-116` to say the default name.

Plus the repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts` (holds `test/reconcile/fleetctl.test.mjs`). No board rebuild (board impact: none). A changeset: `'plot': patch` with a `bumps:` block for `plot-fleet: patch`, description first, `plan:` line optional — copy the format from git history if `.changeset/` is empty.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` — never `gh pr create`.
- When the PR exists, append ` → #<number>` inside the slice heading in the plan's `## Slices` section: `(Branch: bug/a-unit-name-follows-the-label, PR: #N)` is the form this plan's parser reads.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleetctl.sh`, `skills/plot/units/README.md`, `test/reconcile/fleetctl.test.mjs`, and a new changeset. Verified at dispatch: no other remote branch touches these three files, and the only open PR is #1047 (`changeset-release/main`). Out of scope: `plot-boardctl.sh`, the launchd arm, `skills/plot/units/plot-registryd.service`, and anything under `packages/`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
