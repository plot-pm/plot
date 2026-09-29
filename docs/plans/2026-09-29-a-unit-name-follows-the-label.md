# A unit name follows the label

> `unit_target` composes `$LABEL.plist` on launchd and a hardcoded `plot-registryd.service` on systemd, on adjacent lines. So `PLOT_FLEET_LABEL` now works on macOS and does nothing on Linux, where two checkouts write one unit file over each other.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1053
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

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
| `:156` | `is-active --quiet plot-registryd` — **and refusal 4 gates on this** |
| `:167` | `show plot-registryd -p MainPID` |
| `:191` | `show plot-registryd -p WorkingDirectory` |
| `:280` | the unit target path |
| `:513` | the remediation line it prints |
| `:694` | the `how` string in a message |
| `:732` | `target=` on the install path |
| `:785`, `:786` | `enable --now plot-registryd`, and its failure message |
| `:913` | **`--stop`'s `disable --now plot-registryd`** |

**Nine routing sites.** An earlier draft's table listed eight and omitted `:786` and `:913` — and `:913` is the entire `--stop` unload, which `Done when` #5 depends on.

**Two sites must stay hardcoded and an implementer must not derive them:** `:731`, `template="$UNIT_DIR/plot-registryd.service"`, is the **shipped template's** filename; `:97`/`:38` name the `plot-registryd.mjs` bundle.

**Outside the script:** `units/README.md` lines 103–127 name the unit throughout, and `test/reconcile/fleetctl.test.mjs:455, 506, 538, 566, 1297` carry fixtures — **`:1297` computes the install target the same hardcoded way**, a second copy of the rule that would keep passing after the fix. `packages/` has zero: `rules/supervisor-reading.ts` reads the exit code and the `summary:` line, so *Board impact: none* holds.

**`:191` is new today** — the #1062 slice added the *which checkout does it serve* reading and followed the arm's existing shape. That is the cost of leaving the asymmetry: each new feature doubles it.

### Why a systemd unit has no `Label` to fix

**A systemd unit's identity IS its filename.** `plot-registryd.service` carries only `__REPO_ROOT__`, `__NODE__`, `__REGISTRYD__` — there is no identity field to parameterise, which is why #1051's placeholder fix cannot reach here. `units/README.md:115` documents the manual workaround, and it is a **rename**: *"Copy the file to `plot-registryd-<name>.service` and enable that name."*

### The failure is worse than launchd's was, and reproduced

On launchd an override renamed the file and the `Label` inside stayed default — a half-working override. **On systemd the override reaches nothing.** Driven with a stubbed `uname`/`systemctl`, two labels, one fake HOME:

```
### LABEL=com.plot-pm.registryd              → filled …/user/plot-registryd.service
### LABEL=com.plot-pm.registryd.ewz-kus-portal → filled …/user/plot-registryd.service
--- units on disk: ONE FILE
```

**Two labels, one path, second write replaces the first.** The only guard near `:732` is the placeholder check at `:753-762`, which inspects the content it just wrote and never asks whether the path was occupied.

### AND THE DOCUMENTED REMEDY IS REFUSED BY THE CHECK THAT ENFORCES IT

An earlier draft said *"there is no second job, no refusal"*. **There is a refusal — refusal 4 (`:672-700`) — and on systemd it is actively harmful.** It gates on `supervisor_loaded`, which asks the **hardcoded** name (`:156`). Executed, with checkout B starting under its own distinct label while A's default unit is active:

```
plot-fleetctl: 'com.plot-pm.registryd.ewz-kus-portal' is already loaded, and which
  checkout it serves cannot be determined
  Or, for a second checkout, give it its own label — skills/plot/units/README.md

CALL: --user is-active --quiet plot-registryd
```

**The refusal names label B and reads unit A**, then tells the operator to do the thing they just did. So the override is not merely inert on Linux — **it is refused**, and `units/README.md:7`'s promise that *"a second checkout needs no hand steps"* is false in both directions.

## Design

### The rule

**`unit_name()` derives the systemd unit's filename from `$LABEL`, and every systemctl call takes that name.**

The launchd arm already does this with `$LABEL.plist`. The change is to give systemd the same treatment at one function and pass its answer to the nine call sites.

### The mapping, decided here rather than deferred

A launchd label is reverse-DNS (`com.plot-pm.registryd.ewz-kus-portal`); a systemd unit name is a filename. An earlier draft left the mapping to the slice. **It is decidable now, and three of the four obvious derivations fail a `Done when` this plan already carries:**

| label | `tr . -` | last segment | strip-prefix |
|---|---|---|---|
| `com.plot-pm.registryd` (default) | `com-plot-pm-registryd` ❌ | `registryd` ❌ | `plot-registryd.service` ✅ |
| `com.plot-pm.registryd.ewz-kus-portal` | ugly | `ewz-kus-portal` | `plot-registryd-ewz-kus-portal.service` ✅ = README:115 |

**The rule: strip a leading `com.plot-pm.registryd.`, sanitise the remainder to `[A-Za-z0-9:_.-]`, prefix `plot-registryd-`. The exact default label is a named special case returning `plot-registryd.service`.**

This keeps the default, lands on the shape `units/README.md:115` already documents — **so an operator who followed the README gets their file back rather than being orphaned** — and is injective over legal labels.

**Two degeneracies a naive rule would have:** taking only the last segment makes `com.a.portal` and `com.b.portal` collide into one unit — the very defect this plan removes, one level down. And a dotless label like `plot-registryd-ewz` stutters into `plot-registryd-plot-registryd-ewz.service` under a bare prefix rule.

**Sanitisation is not optional.** `PLOT_FLEET_LABEL` is an unconstrained environment variable and systemd accepts only `[A-Za-z0-9:_.-]` in a unit name.

### The default is unchanged

An operator who sets nothing gets `plot-registryd.service`, exactly as today. This is the property that makes the change safe for every existing Linux installation, and it must be asserted rather than assumed.

### What this does NOT do

- **It does not add an identity field to the unit.** systemd has none by design; the filename is it.
- **It does not change the launchd arm**, which #1051 already fixed.
- **It does not migrate an installed unit.** `--stop` then `--start` is the documented upgrade path for every unit change, and the same caveat #1051 records applies: `--stop` resolves through `$LABEL`, so an operator must stop under the label the old unit was installed with.
- **It does not touch `plot-boardctl.sh`.** The board is a different process with a different door.

## Done when

**All five are assertable on macOS**, in `test/reconcile/fleetctl.test.mjs`, with no Linux machine and no CI round trip — see the Notes.

- **`PLOT_FLEET_LABEL=x --start` on systemd writes a unit whose filename derives from `x`**, asserted by reading the written path.
- **`systemctl` is never called with a hardcoded `plot-registryd`**, asserted by a grep gate over the systemd arm — and the gate must **exclude `:731`**, the shipped template's own filename, which is not a routing site.
- **An unset override still produces `plot-registryd.service`**, asserted. Every existing Linux install depends on it.
- **Refusal 4 reads the unit it names.** Today it gates on the hardcoded name while reporting the operator's label, so it refuses the documented remedy. `:156`, `:191` and `:913` are what make it and `--stop` correct — this is the core of the fix, not a nicety.
- `--status` and `--stop` resolve the same name `--start` wrote, asserted — and `:913` is the `--stop` unload.
- **`test/reconcile/fleetctl.test.mjs:1297` is updated**, since it computes the install target the same hardcoded way and would keep passing after the fix — a second copy of the rule.
- **`units/README.md:7` and `:115` are both reconciled.** `:7` promises *"a second checkout needs no hand steps"*, which is false on Linux today in both directions.

## Slices

### A unit name follows the label (Branch: bug/a-unit-name-follows-the-label)

Add `unit_name()`, derive the systemd filename from `$LABEL`, and route the nine systemctl sites through it.

## Notes

**This is #1051's other half, and it was split out rather than folded in** because the fixes are different shapes: launchd needed a placeholder in a template, systemd needs a derived filename at nine call sites. #1051's `Done when` originally permitted an implementer to answer *"the systemd unit has no Label"* — true — and ship a feature inert on Linux. A juror caught that, and this plan is what the split produced.

**An earlier draft said nothing on this machine can test it. That was FALSE and it is the amendment that most changes the work.** `plot-fleetctl.sh:111-117` resolves the platform through `uname -s` and `command -v systemctl`, both via `PATH`, and `test/reconcile/fleetctl.test.mjs:834-860` (`stubPlatform`) already exploits it — its docstring says *"Stubbing them drives the REAL arm … on Linux and macOS alike"*, and it already writes a `systemctl` stub at `:853-857`.

**The whole reproduction above was executed on macOS with about twelve lines of stub.** A slice told to wait for CI would be paying a round trip for feedback available in seconds.

### Round 1, 2026-09-29

One juror, **amend**, **executed** — it drove the real systemd arm under `stubPlatform` and reproduced the overwrite.

Four amendments: the site table was wrong (eight listed, nine real, `:913` — the `--stop` unload that `Done when` #5 depends on — omitted, and `:731` wrongly included); the mapping was decided rather than deferred, after three of four candidate derivations failed an existing `Done when`; **refusal 4 was found to refuse the documented remedy**, which is a worse failure than the inertness this plan was written about; and the claim that nothing here can test it was false.

**#1051 did not overreach.** `git log -S 'plot-registryd.service'` surfaces `d80f32e1` (#1051, today 12:40), whose `--stat` does **not** include the `.service` file. The split was honoured and this plan duplicates no shipped work.
