# plot-fleetctl ignores the Fleet label config key

> `plot-fleetctl.sh` reads the supervisor's launchd label only from `PLOT_FLEET_LABEL`, so a repository that declares `Fleet label` in `## Plot Config` is still addressed under the default label and reads another checkout's supervisor as its own.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2408
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2418 merged
- **Started:** 2026-10-23, Jan Wloka, `bug/plot-fleetctl-ignores-the-fleet-label`

## Changelog

- `/plot-fleet` resolves the supervisor label from `PLOT_FLEET_LABEL`, then the `Fleet label` key in `## Plot Config`, then the default, so a second checkout that declares its label no longer reads another checkout's supervisor.

Board impact: none. The change touches one helper script and one skill text. No payload field changes.

## Motivation

`skills/plot/scripts/plot-fleetctl.sh:90` sets `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.fleetd}"`. It never calls `plot-config.sh get "Fleet label"`, although `ewz-kus-portal` declares `- **Fleet label:** com.plot-pm.fleetd.ewz-kus-portal` and `plot-config.sh get "Fleet label"` returns it there.

Measured 2026-10-23 in `ewz-kus-portal` (Plot 2.28.0), with `PLOT_FLEET_LABEL` unset:

```
supervisor: running (pid 938) — com.plot-pm.fleetd
  serves:  ANOTHER checkout (…/websmith) — this repository is …/ewz-kus-portal
```

The report names the default label, which belongs to the `websmith` checkout. `--start` without the variable refuses with "a unit with that label is already loaded". That refusal sends the operator to its "this repository → `--stop`" branch only when the loaded job serves this repository, so the wrong-job risk is real when a stale default-label job points at the same path. With `PLOT_FLEET_LABEL=com.plot-pm.fleetd.ewz-kus-portal` exported by hand, every command worked.

`plot-boardctl.sh:225` already resolves its port this way: `plot-config.sh get "Board port"`, with a flag above it and a default below. The label is the one launchd key a second checkout must set, and it has no config key reader.

## Design

### Approach

Resolve `LABEL` in `plot-fleetctl.sh` in this order: `PLOT_FLEET_LABEL` when set and non-empty, else `plot-config.sh get "Fleet label" ""` read against the repository root, else `com.plot-pm.fleetd`. Read the key the way `plot-boardctl.sh:225` reads `Board port`: pass `PLOT_REPO_ROOT` explicitly, and treat a failed read as an absent key.

Keep the environment variable first. Tests under `test/reconcile/fleetctl.test.mjs` name a label through it so launchd does not see the operator's live job, and the `LABEL` comment block at `plot-fleetctl.sh:69` records that reason. A config key must not win over that override.

Update the `/plot-fleet` skill text (`skills/plot-fleet/SKILL.md`, the "one supervisor per repository" bullet and the refusal table row) and `skills/plot/units/README.md` ("Two repositories need two labels") to say where the label comes from: variable, then `Fleet label`, then default. The README currently tells the operator to "set the same variable for `--status` and `--stop`", which stops being true once the key is declared.

Document the `Fleet label` key in `skills/plot/SKILL.md` beside the `Board port` paragraph (line 271), which states the same precedence for the port.

A label from the config key goes through the same `unit_name` mapping as one from the variable. No second derivation rule.

### Open Questions

- [ ] Does `--status` print which source supplied the label (`env`, `config`, `default`)? One line names the source, so an operator who reads another checkout's label can see why.
- [ ] Does a `Fleet label` value with characters launchd or systemd refuse fail at read time, or only when `--start` fills the unit? `unit_name` already replaces refused characters for systemd; launchd takes the string as is.
- [ ] Other readers of `PLOT_FLEET_LABEL` (`grep` finds `skills/plot/units/com.plot-pm.fleetd.plist` and the tests): does any script besides `plot-fleetctl.sh` need the same resolution?

## Slices

### Resolve the label from config

- `bug/plot-fleetctl-ignores-the-fleet-label` — `plot-fleetctl.sh` resolves the label from the variable, the `Fleet label` key and the default, in that order, with a reconcile test for each source and for the precedence between them; the skill text and units README say where the label comes from. → #2456

## Notes

- Reported in `ewz-kus-portal` (Plot 2.28.0, Bitbucket, bb 1.11.2), 2026-10-23, as issue #2408.
- Precedent: `docs/plans/2026-09-29-the-board-port-is-configured-not-typed.md` did the same for the board port.
