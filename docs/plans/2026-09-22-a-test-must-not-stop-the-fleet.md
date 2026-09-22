# A test must not stop the fleet

> `fleetctl.test.mjs` says it mints a label per case and never unloads anything. Fifteen of its twenty-two runs pass no label, so `--stop` boots out the operator's own supervisor.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- The fleet test suite stops unloading the machine's real supervisor. Its own header states that every run passes `PLOT_FLEET_LABEL` and that the suite never unloads anything; measured 2026-09-22, **9 of 21 runs pass the label** and three `--stop` runs pass none, so `launchctl bootout` is called on `com.plot-pm.registryd` — the label an operator's fleet is loaded under. The supervisor died three times in one morning, each time within two minutes of a test run.

Board impact: none in code. What changes is that a fleet keeps running while the suite does.

## Design

### The suite's own claim, and the measurement against it

`fleetctl.test.mjs:22-25`:

> `sandbox()` mints a label per case and **the runs pass it as `PLOT_FLEET_LABEL`**; the **suite never unloads anything**, because `--stop` ends work in flight and is a person's call.

**Both halves are false.**

```
run(ctl, …) call sites        21
      … passing a label        9
'--stop' call sites            3
      … passing a label        0
```

*(An earlier draft said 7 of 22. The panel recounted; a plan whose argument is that a header's count was false must get its own right.)*

`run()` defaults its `env` parameter to `{}` and spreads `process.env`, so a call without an explicit label inherits the operator's environment — where `PLOT_FLEET_LABEL` is unset. `plot-fleetctl.sh:84` then falls back:

```sh
LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"
```

and `:672` acts on it:

```sh
if supervisor_loaded; then
  launchd) launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null ;;
```

**`supervisor_loaded` asks launchd, which is machine-global** — the suite's own header says so two lines above the false claim. So a sandboxed `--stop` finds the operator's supervisor and unloads it.

### Why this was invisible

**The tests pass either way.** They assert on `--stop`'s OUTPUT — *"no agents on a branch"*, *"supervisor"* — and that output is identical whether the bootout hit a sandbox label or the real one. A test that unloads the machine's fleet and a test that unloads nothing produce the same transcript.

**And the failure lands elsewhere.** The operator sees an empty board and a fleet that hands nothing over, minutes later, with no error anywhere: `registryd.err` is empty, the last tick in the log is complete, and `launchctl list` shows the label simply gone. Three separate investigations on 2026-09-22 chased a dying daemon before the timestamps were compared.

### The evidence, and what finally identified it

| | |
|---|---|
| last tick | **11:40:46**, complete, no `tick failed` |
| newest leaked sandbox | **11:42:31** |
| leaked `plot-fleetctl-*` directories | **2822**, from 103 two hours earlier |
| `registryd.err` | 0 bytes |
| label afterwards | **not loaded** — not dead-but-loaded |

**The label being UNLOADED is what separates this from a crash.** The first two deaths left the label loaded with no process, which is a crash loop under `KeepAlive`. This one left no label at all, and nothing but `bootout` does that.

### The fix is the PATH, not the label — settled by the panel

**A required label closes one direction only.** It stops a call that UNLOADS the operator's unit. It cannot stop a sandbox plist being BOOTSTRAPPED under the production label, which occupies it — and that has already taken a supervisor down once on this machine, recorded in `a-loaded-label-is-not-a-running-daemon.md`. An operator cannot tell the two apart: both present as a supervisor that is not there.

**A stub `launchctl` on `PATH` can do neither**, so one seam closes both. It also sees a wrong-but-present label, which an unset-check never can.

**And the tool is already in this file.** `stubPlatform` mints exactly such a bin for two cases; the fix applies it to every case. `sandbox()` returns a `guardBin` beside the label it already mints, `run()` takes it as a required argument, and **throws** without it — the gate the header's claim never had.

**The two `stubPlatform` cases still override `PATH` deliberately**, to drive a LOADED launchd. Those are stubs too, so the guarantee holds: what the guard refuses is reaching the machine's own binary.

**It also makes the launchd arm run on CI**, which has no launchd at all — the reason `stubPlatform`'s own docstring gives for existing, applied to every case rather than two.

### What must not break

**The sandbox's label-per-case stays.** It is correct and it is what makes the fix possible; the defect is that it was optional.

**The three `--stop` tests keep testing `--stop`.** Scoping them away would remove coverage of the one verb that ends work in flight. They run against their own label, which is what they always claimed to do.

**`supervisor_loaded` stays machine-global.** It asks launchd and launchd keys by label; that is the truth of the platform and the reason the label must be right.

## Slices

### The suite cannot reach launchctl (Branch: bug/the-suite-passes-the-label-it-mints)

- `bug/the-suite-passes-the-label-it-mints` — `sandbox()` mints a `guardBin` with stub `launchctl` and `systemctl` returning the real exit codes, `run()` takes it as a required argument and throws without it, and all twenty-one call sites pass it. The header is corrected in the same commit, since it documents behaviour the file does not have. **Proven by loading a decoy under the production label**: the suite removes it before, and it survives after

## Notes

- **The leak's CAPABILITY is closed here; its disk cleanup is not.** A stubbed `launchctl` cannot `bootstrap` a unit under any label, so the suite can no longer create the occupation that took a supervisor down earlier the same day. **The 2822 existing directories and an `after()` teardown remain a separate housekeeping plan** — the panel accepted that split and refused the other one.
- **CI cannot see this defect.** `ubuntu-latest` has no launchd, so neither the bug nor the fix is observable there. The PATH gate partly repairs that by driving the real arm on Linux.
- Found by asking why the daemon still died after `a-failed-tick-must-not-end-the-daemon` merged. It did not die: it was stopped. The `catch` from that plan is what made the difference legible — the log shows a complete tick and no failure, which rules out the class that plan removed.
