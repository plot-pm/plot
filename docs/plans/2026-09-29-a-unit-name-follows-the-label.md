# A unit name follows the label

> `unit_target` composes `$LABEL.plist` on launchd and a hardcoded `plot-registryd.service` on systemd, on adjacent lines. So `PLOT_FLEET_LABEL` now works on macOS and does nothing on Linux, where two checkouts write one unit file over each other.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1053
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 0

## Changelog

- `PLOT_FLEET_LABEL` names the systemd unit too, so two Linux checkouts stop overwriting one another's service file.

Board impact: none. This is fleet control's installer.

## Motivation

`plot-fleetctl.sh:277-282`, both arms of one function:

```sh
unit_target() {
  case "$(platform)" in
    launchd) printf '%s' "$HOME/Library/LaunchAgents/$LABEL.plist" ;;
    systemd) printf '%s' "$HOME/.config/systemd/user/plot-registryd.service" ;;
  esac
}
```

**The asymmetry is one line apart.** #1051 shipped today and made the override reach launchd's `Label`; systemd was left, and this is the other half.

### Measured, 2026-09-29

**Ten sites hardcode `plot-registryd` on the systemd arm**, against `$LABEL` on the launchd side:

| line | what it hardcodes |
|---|---|
| `:156` | `systemctl --user is-active --quiet plot-registryd` |
| `:167` | `systemctl --user show plot-registryd -p MainPID` |
| `:191` | `systemctl --user show plot-registryd -p WorkingDirectory` |
| `:280` | the unit target path |
| `:513` | the remediation line it prints |
| `:694` | the `how` string in a message |
| `:732` | `target=` on the install path |
| `:785` | `systemctl --user enable --now plot-registryd` |

**`:191` is new today** — the #1062 slice added the *which checkout does it serve* reading and followed the arm's existing shape. That is the cost of leaving the asymmetry: each new feature doubles it.

### Why a systemd unit has no `Label` to fix

**A systemd unit's identity IS its filename.** `plot-registryd.service` carries only `__REPO_ROOT__`, `__NODE__`, `__REGISTRYD__` — there is no identity field to parameterise, which is why #1051's placeholder fix cannot reach here. `units/README.md:115` documents the manual workaround, and it is a **rename**: *"Copy the file to `plot-registryd-<name>.service` and enable that name."*

### The failure is worse than launchd's was

On launchd an override renamed the file and the `Label` inside stayed default — a half-working override. **On systemd the override reaches nothing**, so two checkouts write the same path and the second install silently replaces the first's unit. There is no second job, no refusal, and no way to tell from `systemctl` that it happened.

## Design

### The rule

**`unit_name()` derives the systemd unit's filename from `$LABEL`, and every systemctl call takes that name.**

The launchd arm already does this with `$LABEL.plist`. The change is to give systemd the same treatment at one function and pass its answer to the nine call sites.

### The name is not the label verbatim

A launchd label is a reverse-DNS string (`com.plot-pm.registryd.ewz-kus-portal`) and a systemd unit name is a filename with a `.service` suffix. **The slice decides the mapping and states it**, and the constraint is that `units/README.md:115` already documents `plot-registryd-<name>.service` — so an operator who followed the README must not find their unit orphaned.

**That is the one real question here.** Either the derivation produces the documented shape, or the plan records that an existing manual install needs a rename and says so in the README.

### The default is unchanged

An operator who sets nothing gets `plot-registryd.service`, exactly as today. This is the property that makes the change safe for every existing Linux installation, and it must be asserted rather than assumed.

### What this does NOT do

- **It does not add an identity field to the unit.** systemd has none by design; the filename is it.
- **It does not change the launchd arm**, which #1051 already fixed.
- **It does not migrate an installed unit.** `--stop` then `--start` is the documented upgrade path for every unit change, and the same caveat #1051 records applies: `--stop` resolves through `$LABEL`, so an operator must stop under the label the old unit was installed with.
- **It does not touch `plot-boardctl.sh`.** The board is a different process with a different door.

## Done when

- **`PLOT_FLEET_LABEL=x --start` on systemd writes a unit whose filename derives from `x`**, asserted by reading the written path.
- **`systemctl` is never called with a hardcoded `plot-registryd`**, asserted by a grep gate over the systemd arm — the assertion that keeps the asymmetry from growing back, as `:191` shows it does.
- **An unset override still produces `plot-registryd.service`**, asserted. Every existing Linux install depends on it.
- **The mapping from label to unit name is stated**, and reconciled with `units/README.md:115`'s documented `plot-registryd-<name>.service` or the README is updated.
- `--status` and `--stop` on systemd resolve the same name `--start` wrote, asserted — three commands, one derivation.

## Slices

### A unit name follows the label (Branch: bug/a-unit-name-follows-the-label)

Add `unit_name()`, derive the systemd filename from `$LABEL`, and route the nine systemctl sites through it.

## Notes

**This is #1051's other half, and it was split out rather than folded in** because the fixes are different shapes: launchd needed a placeholder in a template, systemd needs a derived filename at nine call sites. #1051's `Done when` originally permitted an implementer to answer *"the systemd unit has no Label"* — true — and ship a feature inert on Linux. A juror caught that, and this plan is what the split produced.

**Nothing on this machine can test it.** Every reading here is from source on macOS; no Linux checkout was available. The slice should say whether it verified on Linux or only by reading, because `a fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations` (`fleetctl.test.mjs:523`) is the rule this exists to honour.
