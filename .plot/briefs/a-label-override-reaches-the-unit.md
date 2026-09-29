## Implementation brief — a-label-override-reaches-the-unit

- **Plan (canonical):** `docs/plans/2026-09-28-a-label-override-reaches-the-unit.md` on `main`
- **Approved:** 2026-09-29, jwloka, in-session
- **Branch:** `bug/a-label-override-reaches-the-unit` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review; CI is the authority)
- **Issue:** #1051. The systemd half is #1053 and is out of scope.

Single-slice plan: nothing waits on this branch, and it waits on nothing.

### What to build

`plot-fleetctl.sh:84` honours `PLOT_FLEET_LABEL`, but `skills/plot/units/com.plot-pm.registryd.plist:15-16` hardcodes `<string>com.plot-pm.registryd</string>`. launchd keys a job by the `Label` inside the plist, not by the filename (measured 2026-09-28: two filenames with one `Label` give ONE job, and the second `bootstrap` fails with `5: Input/output error`). An override therefore renames the file and loads under the default label. When the default label is free, the operator believes two supervisors run and one does.

The fix has two parts:

1. In the plist template, replace the literal with `__LABEL__`. Also correct the template comment at `:18-20`, which tells the operator to hand-edit a second file with a second label. The comment must name `PLOT_FLEET_LABEL` instead.
2. In the fill at `plot-fleetctl.sh:654`, add `-e "s|__LABEL__|$LABEL|g"` beside `__REPO_ROOT__`/`__NODE__`.

Update `units/README.md:67` in the same way: the manual copy-and-edit becomes `PLOT_FLEET_LABEL=<label> plot-fleetctl.sh --start`. Keep the migration commands from the plan's Design section (bootout by the old label, `rm` the old plist, restart under the override) in the README, because an installed unit does not update itself.

### Settled decisions — do not re-derive them

- **No new guard for the fill.** The gate at `plot-fleetctl.sh:666-674` greps `__[A-Z_]*__` generically, deletes the unit and exits 1. A missed `__LABEL__` is refused with no code change. Do not add a label-specific check.
- **No label derived from the repo path.** A derived label changes the label of every existing installation on upgrade and orphans its running job. The operator sets the override. Nothing guesses it.
- **The default stays `com.plot-pm.registryd`.** An unset variable must produce byte-identical output to today's, apart from the placeholder.
- **`--stop` and `--status` stay untouched.** They already resolve through `$LABEL` (`:155`, `:165`, `:219`, `:823`).
- **systemd is NOT fixed here.** `plot-registryd.service` has no label field, so it gets no `__LABEL__`. The eight hardcoded `plot-registryd` sites belong to #1053. Do not add a placeholder to the service template to make a test symmetric.
- **`sed` delimiter `|`.** A label with `|` breaks the fill. launchd labels are reverse-DNS, so this is acceptable. Do not switch delimiters in this slice.

### Done when

The plan's `## Done when` list is the specification. These assertions exist because a naive implementation passes without them:

- **Read the WRITTEN plist under an override** and assert that `<key>Label</key><string>x</string>` is present. Asserting only that `x.plist` exists is the exact defect: the filename was always right.
- **`--start --dry-run` under an override reports the label it will write.** `:622` already prints `$LABEL`. The defect is that the reported label and the written label disagreed. Assert the dry-run line and the filled `Label` against one value. `fakeHome(box, {label})` at `fleetctl.test.mjs:622` is the seam.
- **Unset `PLOT_FLEET_LABEL` → `com.plot-pm.registryd` in the filled output.** This test catches a fill that substitutes an empty string.
- **Rewrite three existing tests deliberately:**
  - `fleetctl.test.mjs:450` (`deepEqual` over BOTH templates, three placeholders). The plist now has four and the service keeps three. Give each template its own expected set. Do not widen the service's set.
  - `:459`'s three-way `replaceAll` must also fill `__LABEL__`.
  - `:487` matches the literal default `Label` against a fill that never supplied one. It becomes an assertion about filled output with a supplied label.
- **`launchctl list` showing the job under `x` is a MANUAL check.** CI is ubuntu-latest, and the suite never loads a unit (`fleetctl.test.mjs:18-24`). Say so in the PR body. Do not try to automate it.

Repo gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:contracts` (`fleetctl.test.mjs` is in it; `node --test test/reconcile/fleetctl.test.mjs` runs it alone). `test:e2e` is CI's gate, not a local one. A changeset for `'plot': patch` goes description first, `bumps:` last, with `plot-fleet: patch` and the `plan:` line.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`, never `gh pr create`.
- When the PR exists, append `→ #<number>` inside the slice heading in the plan's `## Slices` (the `(Branch: …, PR: #N)` form), on `main`.

### Scope guard

This branch owns `skills/plot/units/com.plot-pm.registryd.plist`, the `__LABEL__` fill in `skills/plot/scripts/plot-fleetctl.sh`, `skills/plot/units/README.md`, `test/reconcile/fleetctl.test.mjs`, and one changeset.

Checked at dispatch on 2026-09-29: no other remote branch changes `plot-fleetctl.sh`, `skills/plot/units/` or `fleetctl.test.mjs`. The only other open PR is #1047 (`changeset-release/main`).

If you find something the plan did not anticipate, report it rather than improvising outside scope. The systemd sites are the likeliest temptation, and #1053 owns them.
