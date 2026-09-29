# A label override reaches the unit

> `PLOT_FLEET_LABEL` names the plist file and not the `Label` inside it. The template hardcodes `com.plot-pm.registryd`, so an override silently loads under the default — and launchd keys by that string.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1051
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, jwloka, `bug/a-label-override-reaches-the-unit`

## Changelog

- `PLOT_FLEET_LABEL` sets the label launchd keys by, so two checkouts can each run a supervisor.

Board impact: none. This is fleet control's installer.

## Motivation

`plot-fleetctl.sh:84` reads the override:

```sh
LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"
```

`skills/plot/units/com.plot-pm.registryd.plist:15-16` does not:

```xml
<key>Label</key>
<string>com.plot-pm.registryd</string>
```

The template carries three placeholders the installer fills — `__REPO_ROOT__`, `__NODE__`, `__REGISTRYD__`. It also carries baked-in literals the installer does not fill, including the `PATH` that `units/README.md:157` flags as wrong on Intel Macs. **The label is not the only unfilled field; it is the only one whose value decides identity.**

**launchd keys a job by the `Label` inside the plist**, not by the filename. Measured 2026-09-28 in a scratch directory: two plists with different filenames and the same `Label` produce ONE job — the second `launchctl bootstrap` returns `Bootstrap failed: 5: Input/output error` and launchd goes on holding the first file. The inverse, one filename base with two labels, produces TWO jobs. So an override renames the file and changes nothing that matters. Two failures follow, and the second is worse:

- **The default label is taken** → `--start` refuses, and the override the operator set to avoid exactly that did nothing.
- **The default label is free** → the unit loads under `com.plot-pm.registryd` regardless. The operator believes they are running two supervisors under two labels; they are running one, and the next `--start` in the other checkout overwrites it.

## Design

### The rule

**The label is a placeholder like every other field the installer fills.**

Replace the hardcoded string with `__LABEL__` and fill it from `$LABEL`, alongside `__REPO_ROOT__` and `__NODE__`.

### The fill is already verified, and this inherits that

`plot-fleetctl.sh` refuses when a `__PLACEHOLDER__` survives the fill — the unit is deleted and the run stops. Adding a placeholder therefore adds a guard rather than a risk: a fill that misses the label cannot install.

### What this does NOT do

- **It does not choose a label per checkout.** The operator sets `PLOT_FLEET_LABEL`; nothing derives one from the repo path, which would change the label of every existing installation on upgrade.
- **It does not change the default.** An operator who sets nothing gets `com.plot-pm.registryd`, exactly as today.
- **It does not touch `--stop` or `--status`.** Both already resolve the launchd job through `$LABEL` (`plot-fleetctl.sh:155`, `:165`, `:219`, `:823`), and the `--status` exit contract survives an override — measured: an unknown override exits 1, the default exits 0.

### systemd has no label, and the override reaches nothing there

**This is a second defect of a different shape, and it is not fixed by this slice.**

A systemd user unit carries no `Label` field — its identity IS its filename — so there is nothing in `plot-registryd.service` to make a placeholder of. `PLOT_FLEET_LABEL` is ignored entirely on Linux: eight sites hardcode `plot-registryd` (`plot-fleetctl.sh:156`, `:167`, `:220`, `:451`, `:647`, `:648`, `:696`, `:824`), against `:219` which composes the launchd target from `$LABEL`. Two Linux checkouts therefore overwrite one unit file — worse than the launchd failure, which at least renames.

**It is filed as #1053 rather than widened into this one.** The fix is a unit NAME derived from `$LABEL` at eight call sites, not a placeholder in a template, and `units/README.md:115` documents a different manual workaround (`plot-registryd-<name>.service`) from the launchd one at `:67`.

**What this slice must NOT do is answer "does the systemd unit hardcode its identity?" with "no" and close the question.** That answer is true and it ships a feature that works on macOS and is inert on Linux — the shape `fleetctl.test.mjs:523` already refuses by name: *a fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations.*

### An installed unit does not update itself, and `--stop` cannot find it

The template is read at install time, so a checkout that installed before this ships keeps its hardcoded label.

**`--stop` then `--start` does not migrate it — it orphans it.** `--stop` resolves the supervisor through `$LABEL`, so an operator who sets an override gets *"supervisor was not loaded"* while the job under the default label keeps running. Measured: `PLOT_FLEET_LABEL=…NOSUCH --status` prints `not installed` while `launchctl list` shows the live daemon under `com.plot-pm.registryd`.

**The migration rule the operator must follow:** boot the old job out by the label it was actually loaded under —

```sh
launchctl bootout "gui/$(id -u)/com.plot-pm.registryd"
rm ~/Library/LaunchAgents/com.plot-pm.registryd.plist
PLOT_FLEET_LABEL=<new> skills/plot/scripts/plot-fleetctl.sh --start
```

— or set the override equal to the old label, which adopts the existing unit.

## Done when

- `PLOT_FLEET_LABEL=x --start` produces a unit whose `Label` is `x`, asserted by reading the written plist.
- **`--start --dry-run` under an override reports the label it will actually write.** Today it prints `would fill and load <override>` while writing the default — the operator-visible lie, and the first thing anyone sees. `fleetctl.test.mjs:622`'s `fakeHome(box, {label})` already builds the seam.
- An unset `PLOT_FLEET_LABEL` still produces `com.plot-pm.registryd`.
- A fill that leaves `__LABEL__` in place deletes the unit and refuses, like every other placeholder. The gate at `plot-fleetctl.sh:666-674` greps `__[A-Z_]*__` generically, so this is inherited with no change.
- **Three existing assertions are rewritten deliberately, not renumbered:**
  - `fleetctl.test.mjs:450` asserts by `deepEqual` that the placeholder set is exactly three, **iterating both templates**. It cannot simply gain a fourth entry — only the plist gains `__LABEL__`, and the systemd unit never will.
  - `fleetctl.test.mjs:459`'s fill is a hardcoded three-way `replaceAll` and must supply a label.
  - `fleetctl.test.mjs:487` matches the literal default `Label` against the template; it becomes an assertion about filled output.
- **`launchctl list` showing the job under `x` is a MANUAL check, and the plan says so.** CI is ubuntu-latest only (`plot-fleetctl.sh:315-317`) and the suite's own rule is that it never loads anything (`fleetctl.test.mjs:18-24`). It is the assertion that would have caught the defect and this repository's test estate cannot make it.
- The systemd finding is filed as #1053, referenced here. **Answering "the unit has none" and closing the question does not satisfy this bullet.**

## Slices

### A label override reaches the unit (Branch: bug/a-label-override-reaches-the-unit)

Make the label a placeholder, fill it, and assert against the loaded job rather than the file.

## Notes

**The override has existed and never worked.** Whoever set it got the behaviour they were avoiding, with no error — the shell honoured it, the file was renamed, and launchd read the string inside.

**The workaround is already in production, hand-built, on the author's own machine.** `~/Library/LaunchAgents/com.plot-pm.registryd.ewz-kus-portal.plist` carries `Label: com.plot-pm.registryd.ewz-kus-portal` and `WorkingDirectory: /Users/jwloka/Quatico/ewz/ewz-kus-portal`, loaded, serving a second checkout. **`--start` cannot produce that file** — measured. It was written by editor, following `units/README.md:67`. So this is not a feature for an override nobody exercises; it is a manual step two checkouts on this machine perform today, and the plan's value is making `--start` produce what an operator produced by hand.

### Round 1, 2026-09-28

Two jurors, both **amend**, both **executed**. Moderation: `.plot/panels/2026-09-28-a-label-override-reaches-the-unit/panel.md`.

The premise was verified rather than accepted — a two-sided launchd experiment, then the defect reproduced end to end against the live script. Four findings folded in above: the systemd unit has no label field and the override is inert on Linux at eight call sites; three test assertions fail and are named; the upgrade path orphans a running supervisor; and the `launchctl list` bullet cannot run in this repository's CI.

**The jurors disagreed about what the plan's central failure was**, and the moderation takes the narrower reading: the premise is true and correctly argued, so this is undeclared blast radius rather than a false plan. The amendment is a set of sentences, not a redesign.

This is #1048's other half: that issue reports a supervisor unable to say which checkout it serves, and the two share a cause. A label that cannot vary is a label that cannot identify.
