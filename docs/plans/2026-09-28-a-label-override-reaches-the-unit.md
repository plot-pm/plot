# A label override reaches the unit

> `PLOT_FLEET_LABEL` names the plist file and not the `Label` inside it. The template hardcodes `com.plot-pm.registryd`, so an override silently loads under the default — and launchd keys by that string.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1051
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

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

Every other field in that template is a `__PLACEHOLDER__` the installer fills — `__REPO_ROOT__`, `__NODE__`. The label is the one that isn't.

**launchd keys a job by the `Label` inside the plist**, not by the filename. So an override renames the file and changes nothing that matters. Two failures follow, and the second is worse:

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
- **It does not touch `--stop`, `--status` or the systemd unit** beyond the same placeholder, if that unit hardcodes its identity too — the slice checks.

### An installed unit does not update itself

The template is read at install time. A checkout that installed before this ships keeps its hardcoded label until `--stop` then `--start`. That is the documented upgrade path for every unit change and this plan adds no other.

## Done when

- `PLOT_FLEET_LABEL=x --start` produces a unit whose `Label` is `x`, asserted by reading the written plist.
- **`launchctl list` shows the job under `x`**, not under the default — asserted against the loaded unit, not the file. This is the assertion that would have caught the defect.
- An unset `PLOT_FLEET_LABEL` still produces `com.plot-pm.registryd`.
- A fill that leaves `__LABEL__` in place deletes the unit and refuses, like every other placeholder.
- The systemd unit is checked for the same defect and fixed in the same slice, or the plan records that it has none.

## Slices

### A label override reaches the unit (Branch: bug/a-label-override-reaches-the-unit)

Make the label a placeholder, fill it, and assert against the loaded job rather than the file.

## Notes

**The override has existed and never worked.** Whoever set it got the behaviour they were avoiding, with no error — the shell honoured it, the file was renamed, and launchd read the string inside.

This is #1048's other half: that issue reports a supervisor unable to say which checkout it serves, and the two share a cause. A label that cannot vary is a label that cannot identify.
