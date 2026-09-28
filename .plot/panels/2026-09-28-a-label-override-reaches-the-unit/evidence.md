Position: amend
Evidence: executed

# EVIDENCE — #1051 a label override reaches the unit

## What I ran and what it showed

### The central defect is REAL. I reproduced it.

I ran the fill exactly as `plot-fleetctl.sh:654-657` performs it, into a sandbox `HOME`, with an override label and without loading anything:

```
sed -e "s|__REPO_ROOT__|…|g" -e "s|__NODE__|…|g" -e "s|__REGISTRYD__|…|g" \
    skills/plot/units/com.plot-pm.registryd.plist > $SB/Library/LaunchAgents/test.probe.jl1.plist
```

Result:

```
=== FILENAME: test.probe.jl1.plist ===
=== Label INSIDE the written plist ===
  <key>Label</key>
  <string>com.plot-pm.registryd</string>
=== placeholder survivor count (the verify gate) ===
0
=== plutil === OK
```

The file is named for the override, the `Label` is the default, the verify gate passes, and `plutil` accepts it. That is the plan's claim, executed. `--start --dry-run` under `PLOT_FLEET_LABEL=test.probe.jl1` likewise prints `would fill and load test.probe.jl1` — the operator is told the override took effect and it did not.

### The guard claim also holds.

Plan's "a fill that misses the label cannot install" — I ran the exact gate (`plot-fleetctl.sh:666-674`) against a mutant template carrying `__LABEL__`:

```
survivors=1  -> gate refuses? YES
16:  <string>__LABEL__</string>
```

And the gate at `:666` precedes `plutil -lint` (`:679`) and `launchctl bootstrap` (`:686`). The guard argument is sound.

## What a measurement contradicts

### 1. FALSE: "Every other field in that template is a `__PLACEHOLDER__`… The label is the one that isn't."

`grep -n '__[A-Z_]*__'` over the plist returns lines 7-9 (the comment), 30, 31, 40, 45, 72, 74. The template's **non**-placeholder literals are not one field — they are `ProgramArguments`'s `--start-agents`, `RunAtLoad`, `KeepAlive`, `ThrottleInterval 60`, `ProcessType Adaptive`, `Nice 10`, and the whole `PATH` string `/opt/homebrew/bin:/usr/local/bin:…`. The `PATH` is an installation-specific literal the unit's own comment flags as wrong on Intel Macs (`README.md:157`), and it is not filled either.

The claim is only true if read as *every field the installer fills is a placeholder* — which is a tautology. As written it is a false premise, and it is doing rhetorical work: it makes the label look like an oversight in an otherwise uniform template rather than one of several baked-in constants.

### 2. FALSE, AND THIS IS THE CENTRAL ONE: "It does not touch … the systemd unit beyond the same placeholder, if that unit hardcodes its identity too — the slice checks."

I checked, because the plan asked someone to. **The systemd unit has no `Label` field and cannot have one.** `grep -n -E 'plot-registryd|com\.plot-pm' skills/plot/units/plot-registryd.service` returns only comment lines plus `SyslogIdentifier=plot-registryd` (`:64`) and the `Description` (`:11`). A systemd unit's identity **is its filename**, which is why `README.md:115` says *"Copy the file to `plot-registryd-<name>.service` and enable that name"* — a different instruction from the launchd one at `:67`.

So "the same placeholder" is not available on systemd, and the defect there is a different shape: **`PLOT_FLEET_LABEL` is ignored entirely.** Eight sites hardcode the systemd identity:

| line | code |
|---|---|
| `plot-fleetctl.sh:156` | `systemctl --user is-active --quiet plot-registryd` |
| `plot-fleetctl.sh:167` | `systemctl --user show plot-registryd -p MainPID` |
| `plot-fleetctl.sh:220` | `$HOME/.config/systemd/user/plot-registryd.service` |
| `plot-fleetctl.sh:451` | `echo "systemctl --user enable --now plot-registryd"` |
| `plot-fleetctl.sh:648` | `target="$HOME/.config/systemd/user/plot-registryd.service"` |
| `plot-fleetctl.sh:696-697` | `systemctl --user enable --now plot-registryd` |
| `plot-fleetctl.sh:824` | `systemctl --user disable --now plot-registryd` |

On launchd the override reaches the **filename** and not the Label — a half-working override. On systemd it reaches **nothing**: `unit_target` (`:220`) and the `--start` target (`:648`) both write `plot-registryd.service` regardless, so two checkouts on Linux overwrite one another's unit file, which is strictly worse than launchd's failure and is not in the plan's failure list. The plan's two-bullet failure analysis ("default label taken" / "default label free") is launchd-only and does not describe Linux at all.

This is the plan's false central claim. It was delegated to the slice with "the slice checks", and the answer changes the slice's size from one `sed` line to a rename of the systemd unit plus eight call sites.

### 3. UNSTATED: three existing tests fail.

`test/reconcile/fleetctl.test.mjs` is green on `main` — I ran it: `tests 48, pass 48, fail 0` (50.4 s, Node v24.21.0). I then applied the plan's change to a **copy** of the template (real templates verified clean via `git status --porcelain skills/plot/units/`) and ran the three assertions:

```
TEST :450 found: ["__LABEL__","__NODE__","__REGISTRYD__","__REPO_ROOT__"]
TEST :450 PASSES? false
TEST :459 survivors: ["__LABEL__"] PASSES? false
TEST :486 Label regex PASSES? false
```

- `fleetctl.test.mjs:450` — *"both unit templates carry exactly the three documented placeholders"*, an explicit `assert.deepEqual` against the three-name list.
- `fleetctl.test.mjs:459` — *"the fill leaves no placeholder in either unit"*, whose fill is a hardcoded three-way `replaceAll`.
- `fleetctl.test.mjs:486` — `assert.match(filled, /<key>Label<\/key>\s*<string>com\.plot-pm\.registryd<\/string>/)`.

These are contract tests naming *three*, and the plan adds a fourth placeholder. They are not defects to fix silently; `:450`'s message is *"names a placeholder the fill does not replace"*, so the number three is the assertion's subject. The plan says nothing about them.

### 4. The upgrade path does not work as stated, and I measured why.

Plan: *"A checkout that installed before this ships keeps its hardcoded label until `--stop` then `--start`. That is the documented upgrade path."*

`--stop` finds the supervisor through `supervisor_loaded` (`:152-159`), which asks about **`$LABEL`** — the override, not the installed unit's label. Measured:

```
$ PLOT_FLEET_LABEL=com.plot-pm.registryd.NOSUCH skills/plot/scripts/plot-fleetctl.sh --status
supervisor: not installed (com.plot-pm.registryd.NOSUCH) — no unit on this machine
$ launchctl print "gui/501/com.plot-pm.registryd.NOSUCH" >/dev/null 2>&1; echo $?
113
```

Meanwhile the live job **is** loaded under the default:

```
$ launchctl list | grep plot
8411   -9  com.plot-pm.registryd
30516   0  com.plot-pm.registryd.ewz-kus-portal
```

So the operator who sets `PLOT_FLEET_LABEL=x` and runs `--stop` gets *"supervisor was not loaded"* (`:838`) while the old job under the default label keeps running. `--stop` then `--start` does not migrate it; it **orphans** it, and the operator now has two supervisors on one estate. The plan asserts the upgrade path works and it does not for the exact operator the feature is for.

`unit_target` (`:219`) compounds this: it composes `$HOME/Library/LaunchAgents/$LABEL.plist`, so the pre-existing `com.plot-pm.registryd.plist` is invisible to `fleet_install_state` under an override too. The state machine reports `not-installed` over a machine that has a unit and a running daemon.

### 5. "Done when" contains a bullet the branch cannot execute.

*"`launchctl list` shows the job under `x` … asserted against the loaded unit, not the file."* This requires **loading a unit** in a test. `fleetctl.test.mjs:18-24` states the suite's own rule: *"the suite never unloads anything"*, and every case runs under a label launchd does not hold precisely to avoid touching the machine. CI is `ubuntu-latest` only (`plot-fleetctl.sh:315-317`), so the launchd arm is unreachable there at all. The plan names this as *"the assertion that would have caught the defect"* — and it is, but it is not an assertion this repository's test estate can make. Either the slice loads and boots out a real launchd job in CI (it cannot: no macOS runner) or the bullet is a manual step that must say so.

## What it must say before someone builds it

1. **State the systemd defect in its own words.** It is not "the same placeholder". The systemd unit's identity is its filename; the override reaches nothing there today, and two Linux checkouts overwrite one unit. Either scope the slice to launchd and say Linux is a separate finding, or size the slice to include the systemd rename plus the eight hardcoded sites listed above.
2. **Name the three failing tests** (`fleetctl.test.mjs:450`, `:459`, `:486`) and say what they become. `:450`'s "exactly three" is a contract with a message; it needs a deliberate rewrite, not a number bumped to four.
3. **Fix the upgrade path or delete the claim.** `--stop` under an override cannot find a unit installed under the default. State the real migration: boot out the old label explicitly (`launchctl bootout gui/$(id -u)/com.plot-pm.registryd`), remove the old plist, then `--start`. Or have `--start` detect a default-labelled unit on disk and name it.
4. **Make the `launchctl list` bullet honest** about being manual, or replace it with what CI can assert: the written plist's `Label` equals the override, plus a corpus test that `unit_target`'s filename and the file's `Label` agree.
5. **Drop or correct "the label is the one that isn't."** The unfilled `PATH` is the counter-example and it is a real installation-specific literal.

## What executing revealed that reading would not

- **The systemd unit has no `Label` key.** Reading the plan, "the same placeholder, if that unit hardcodes its identity too" reads as a small conditional. Grepping the file shows there is no field to make a placeholder of, which changes the slice's shape rather than its size.
- **A second relabelled supervisor is already running on this machine** — `com.plot-pm.registryd.ewz-kus-portal`, `working directory = /Users/jwloka/Quatico/ewz/ewz-kus-portal`, pid 30516. Its plist carries `<string>com.plot-pm.registryd.ewz-kus-portal</string>` as its `Label`, edited by hand per `README.md:67`. So the manual path works and the scripted override is the broken one — a fact that strengthens the plan's motivation and is nowhere in it.
- **The three test failures are only visible by executing the assertions**, because `:459`'s fill is a hardcoded `replaceAll` chain rather than a loop over discovered placeholders. Reading the test name *"the fill leaves no placeholder"* suggests it would adapt; it does not.
- **`--status`'s exit contract survives the override** — I checked, because an override that changed it would break `rules/supervisor-reading.ts`'s 0/1 gate. Measured: `PLOT_FLEET_LABEL=test.probe.nosuch.jl1 … --status` exits **1**, the default label exits **0**. No finding here, and it is the one thing about the override that works as documented.
