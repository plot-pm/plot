# A test must not stop the fleet

> `fleetctl.test.mjs` says it mints a label per case and never unloads anything. Fifteen of its twenty-two runs pass no label, so `--stop` boots out the operator's own supervisor.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- The fleet test suite stops unloading the machine's real supervisor. Its own header states that every run passes `PLOT_FLEET_LABEL` and that the suite never unloads anything; measured 2026-09-22, **7 of 22 runs pass the label** and three `--stop` runs pass none, so `launchctl bootout` is called on `com.plot-pm.registryd` — the label an operator's fleet is loaded under. The supervisor died three times in one morning, each time within two minutes of a test run.

Board impact: none in code. What changes is that a fleet keeps running while the suite does.

## Design

### The suite's own claim, and the measurement against it

`fleetctl.test.mjs:22-25`:

> `sandbox()` mints a label per case and **the runs pass it as `PLOT_FLEET_LABEL`**; the **suite never unloads anything**, because `--stop` ends work in flight and is a person's call.

**Both halves are false.**

```
run(ctl, …) call sites        22
      … passing a label        7
'--stop' call sites            3
      … passing a label        0
```

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

### The fix, and the two halves it needs

**Pass the label on every run.** `run()`'s `env` default is the defect: an omitted label is not a choice, it is an oversight that reaches the machine. The sandbox already mints one; `run` must require it rather than default around it.

**And make the claim checkable.** The header's *"never unloads anything"* is a rule in CLAUDE.md's sense — nothing enforces it, and it was false for the whole life of the file. A guard that refuses a `--stop` run without an explicit label turns it into a gate.

### What must not break

**The sandbox's label-per-case stays.** It is correct and it is what makes the fix possible; the defect is that it was optional.

**The three `--stop` tests keep testing `--stop`.** Scoping them away would remove coverage of the one verb that ends work in flight. They run against their own label, which is what they always claimed to do.

**`supervisor_loaded` stays machine-global.** It asks launchd and launchd keys by label; that is the truth of the platform and the reason the label must be right.

## Slices

### The suite passes the label it mints (Branch: bug/the-suite-passes-the-label-it-mints)

- `bug/the-suite-passes-the-label-it-mints` — `run()` takes the label as a required argument rather than defaulting its env, all twenty-two call sites pass the sandbox's own, and a guard refuses a run whose `PLOT_FLEET_LABEL` is unset so the header's claim becomes checkable. The suite's header is corrected in the same commit, since it currently documents behaviour the file does not have

## Notes

- **The 2822 leaked sandbox directories are a separate defect** and are not this plan's scope. One of them held the production label earlier the same day, which is recorded in `a-loaded-label-is-not-a-running-daemon.md`.
- Found by asking why the daemon still died after `a-failed-tick-must-not-end-the-daemon` merged. It did not die: it was stopped. The `catch` from that plan is what made the difference legible — the log shows a complete tick and no failure, which rules out the class that plan removed.
