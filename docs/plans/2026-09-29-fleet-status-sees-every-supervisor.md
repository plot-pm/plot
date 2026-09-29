# Fleet status sees every supervisor

> `--status` asks about ONE label. The load that starves the board is a property of the MACHINE, and nothing on the estate asks what else is spending on it.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Issue:** #1080
- **Review:** in-session
- **Impl:** own branches

## Changelog

- `/plot-fleet --status` names every Plot supervisor loaded on this machine, not only this checkout's, and the checkout each one serves.

Board impact: none. This is fleet control's status output.

## Motivation

Measured 2026-09-29 on this machine, while an operator reported the board dead:

```
$ launchctl list | grep plot
8411   -9  com.plot-pm.registryd
27932   0  com.plot-pm.registryd.ewz-kus-portal
```

and this checkout's own status, run at the same moment:

```
supervisor: running (pid 8411) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
summary: agents_running=1 agents_other=3 supervisor=up
```

**The second supervisor does not appear.** It was found with `lsof -a -p 27932 -d cwd`, which is not a thing an operator should need.

What it was costing, measured in the same minute:

| reading | value |
|---|---|
| `plot-fleet-scan.sh` processes | **17**, from five installations |
| `plot-host.sh pr-list` processes | **27** |
| load average | **11.48** |
| `/api/board` response | 4.5 s |
| `/api/fleet` | timed out at 90 s, board served a stale pulse |

A board serving its last good pulse reads to an operator exactly like a board that has died.

### The two readings that already exist are each correct and each scoped to one label

**#1051** (delivered) made `PLOT_FLEET_LABEL` reach the plist's `Label`, so two checkouts can each run a supervisor. That is why these two coexist rather than colliding, and it is working.

**#1048** (delivered) made `--status` name the checkout a supervisor serves, through `launchctl print gui/<uid>/<label>`'s `working directory`.

`serves_line` is called at `plot-fleetctl.sh:456` and `:478`, both times for `$LABEL` — the label THIS checkout would use. So the pair answers *which checkout does my supervisor serve* perfectly, and **cannot be made to answer** *what else is running here*, because a `print` needs a label and the other checkout's label is not a fact this repository holds.

**Neither is defective. The gap is that no reading is machine-scoped.**

### The answer is one command and it is already cheap

```
$ time (launchctl list | grep -c 'com.plot-pm.registryd')
2
0.058 total
```

`launchctl list` enumerates by PREFIX rather than resolving a known label, which is the whole difference: it finds labels this checkout has never heard of. Each then resolves its checkout by the reading #1048 already built:

```
com.plot-pm.registryd                  -> /Users/jwloka/Quatico/Agentic-Tools/plot
com.plot-pm.registryd.ewz-kus-portal   -> /Users/jwloka/Quatico/ewz/ewz-kus-portal
```

58 ms for the enumeration, plus one `print` per supervisor found — and the count is supervisors on a machine, not agents, so it is one or two in practice.

## Design

### The rule

**`--status` reports every Plot supervisor on the machine, and marks which one is this checkout's.**

The existing block is unchanged and stays first — an operator asking about their own fleet still gets their own fleet, in the same shape. A second block follows only when a supervisor other than this checkout's is loaded.

```
supervisor: running (pid 8411) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
  …

other supervisors on this machine:
  com.plot-pm.registryd.ewz-kus-portal  (pid 27932) — /Users/jwloka/Quatico/ewz/ewz-kus-portal
```

**Silent when there is only one.** A line reading `other supervisors: none` on every single-checkout machine is noise on the common case, and this must not make the ordinary output longer.

### It reports and never acts

**No stop, no signal, no count folded into the summary.** A supervisor serving another project is that project's, and this checkout has no standing to end it — the same rule `/plot-board --start` already applies when another checkout holds the port, and `plot-boardctl.sh`'s refusal is the precedent.

**`summary=` does not gain a field either.** `agents_running` and `supervisor=up` are answers about THIS fleet, and a machine-wide number beside them would be read as this fleet's. The other supervisors are named in prose because naming them is the whole deliverable.

### The prefix is derived, never hardcoded

The default label is `com.plot-pm.registryd` and an override appends to it by convention (`com.plot-pm.registryd.ewz-kus-portal`, written by hand per `units/README.md:67`). **The prefix to enumerate is the DEFAULT label, not `$LABEL`** — enumerating `$LABEL` on a checkout that set an override would find only itself, which is the bug being fixed.

**A label that does not carry the prefix is invisible to this, and that is a stated limit rather than a silent one.** An operator free to choose any string may choose one that shares no prefix; the output says what it enumerated so a reader can tell an empty answer from an unasked question.

### systemd is a different reading and gets its own

A systemd user unit has no `Label` — its identity is its filename, which is why `units/README.md:115` documents `plot-registryd-<name>.service` where the launchd path documents a relabel. So the Linux enumeration is `systemctl --user list-units 'plot-registryd*'` over a unit-name glob, and the checkout comes from `systemctl --user show <unit> -p WorkingDirectory --value`.

**This must be written, not inferred.** The measured platform here is launchd, and a slice that ships the macOS half and leaves Linux answering nothing reproduces the shape `fleetctl.test.mjs:523` already refuses by name: *a fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations.* CI is ubuntu-latest only, so the Linux arm is the one CI can assert and the macOS arm is the one that cannot be.

### What this does NOT do

- **It does not coordinate spend.** Two supervisors sharing a budget is #1069's territory and a larger question; this makes the situation visible, which is the precondition for it and not a substitute.
- **It does not change `--start`'s refusal.** That already names an already-loaded label and its checkout (`plot-fleetctl.sh:681-696`), correctly, for `$LABEL`.
- **It does not touch `--stop`.** One stop rule, one label.
- **It does not count scans or processes.** 17 scans from five installations is a symptom of the supervisors; enumerating processes would be a second, noisier reading of the same fact.

## Done when

- **With two supervisors loaded, `--status` names both and marks which is this checkout's**, asserted against a fake `launchctl` on PATH returning two labels. The suite's own rule is that it never loads anything (`fleetctl.test.mjs:18-24`) and the `guardBin` seam at `:276` is how a fake is supplied.
- **With one supervisor loaded, the output is byte-identical to today's**, asserted. This is the common case and the regression that would matter.
- **A supervisor whose checkout cannot be determined is named with that as its answer**, not omitted. An unreadable `working directory` is `launchctl print` exiting 113 for an unheld label, which `plot-fleetctl.sh:141-151` already records having been bitten by once.
- **The systemd arm enumerates by unit-name glob and is asserted on the Linux runner**, where the launchd arm cannot be. Both arms exist or the slice is not done.
- **The prefix enumerated is named in the output**, so an operator can distinguish *no other supervisor* from *no other supervisor carrying this prefix*.
- `node --test test/reconcile/fleetctl.test.mjs` stays green — it runs 48 tests today. Any assertion that changes is named rather than renumbered.

## Slices

### Fleet status sees every supervisor (Branch: bug/fleet-status-sees-every-supervisor)

Enumerate by prefix on both platforms, resolve each checkout, print a second block only when there is one.

## Notes

**This is what #1048 could not become.** That plan's design section argued correctly that nothing needs adding to the unit — only reading from it — and built the per-label reading this reuses whole. What it could not do is find a label nobody told it about, and that limit was not visible until two supervisors ran at once on one machine.

**The operator found the fault before the tooling did.** The report was *"board seems again dead"*, and the board was answering in 4.5 s. Every component was behaving correctly and the machine was saturated; the missing thing was a reading whose scope matched the problem's.
