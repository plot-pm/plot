# Evidence lens — a-test-must-not-stop-the-fleet

Position: amend

My brief was to REFUTE the central claim. I could not. I loaded a decoy under the production label and the suite booted it out, twice, independently, green. The premise survives execution. What does not survive is the plan's arithmetic, and it ignores a mechanism already in its own file that is strictly stronger than the fix it proposes.

## 1. Does the stated problem exist, verified in code?

**Yes — proved by execution, not by reading.**

No supervisor was loaded when I started (`launchctl list | grep -i plot` → empty, exit 1), while `~/Library/LaunchAgents/com.plot-pm.registryd.plist` sat on disk. I backed that plist up (`shasum` 8976376a…), then bootstrapped a decoy from the scratchpad under the **production label** `com.plot-pm.registryd`, pointing at `/bin/sleep 3600`, RunAtLoad true, KeepAlive false.

```
launchctl bootstrap "gui/$(id -u)" "$SP/decoy.plist"     # exit 0
launchctl print "gui/$(id -u)/com.plot-pm.registryd"     # state = running, program = /bin/sleep
```

Then, each test in isolation:

```
node --test --test-name-pattern='stop with nothing running' test/reconcile/fleetctl.test.mjs
  BEFORE: LOADED  →  ✔ passed (594ms)  →  AFTER: GONE

node --test --test-name-pattern='once per branch' test/reconcile/fleetctl.test.mjs
  BEFORE: LOADED  →  ✔ passed (1236ms) →  AFTER: GONE
```

**Two separate tests, each passing green, each booting out the machine's supervisor.** Nothing refused first. Neither `supervisor_loaded`, nor the platform check, nor `PATH` stood in the way.

I then traced the mechanism by hand in a sandbox I built myself, running `--stop` against a freshly re-loaded decoy in two worlds:

```
WORLD A — no label passed (what the test does):
  no agents on a branch; stopping the supervisor
    supervisor unloaded
  decoy now: GONE

WORLD B — PLOT_FLEET_LABEL=com.plot-pm.registryd.test-sandbox-$$ :
  no agents on a branch; stopping the supervisor
    supervisor was not loaded
  decoy now: LOADED
```

The chain the plan names is exactly the chain that runs: `run()` defaults `env = {}` and spreads `process.env` (`:105`), `PLOT_FLEET_LABEL` is unset there, `plot-fleetctl.sh:84` falls back to `com.plot-pm.registryd`, `supervisor_loaded` (`:135`) asks `launchctl print` machine-globally, and `:671` runs `launchctl bootout "gui/$(id -u)/$LABEL"`.

**Does the sandbox shadow `launchctl`?** For these three tests, no. A `PATH` stub exists — `stubPlatform()` at `:598` writes a fake `uname`/`launchctl`/`systemctl` — but it is reached only from the `--status` tests at `:644` and `:662`. The three `--stop` sites run on the bare inherited `PATH`. I confirmed the real binary was in play: the decoy died.

**The invisibility claim is also correct, and I checked it rather than assumed it.** The two assertions (`/no agents on a branch/`, `/supervisor/`) and the ordering assertion (`iSuper > iBranch`) all pass identically against World A's transcript and World B's. A run that destroys the fleet and a run that touches nothing produce the same green.

## 2. Is this the smallest change that fixes it? — No, and that is my amendment

The plan proposes making `run()`'s label a required argument, changing **all** call sites, plus a guard. Its own file already contains a narrower and stronger instrument.

`stubPlatform()` puts a fake `launchctl` on `PATH`. **A `PATH` stub makes the real `launchctl` unreachable no matter what label is computed.** The label fix is a correctness fix that still calls the real binary and relies on the label being right every time, forever; the stub removes the machine from reach entirely. The file's own docstring at `:588` states the property — *"Prepending to `PATH` can only ADD a command — the machine's real `launchctl` still sits behind the stub"* — which the plan cites nowhere.

The smallest fix is three lines: give the three `--stop` tests `stubPlatform(box, { loaded: true })` on their `PATH`. That is defence in depth the label alone does not give, and it is already written, tested and documented in the same file.

I am not arguing against the label fix. Pass the label too — it is correct and it fixes the two labelless `--status` tests below. But the plan presents the label as *the* fix and never weighs the mechanism sitting forty lines from the defect. **Naming `stubPlatform` and saying why it is or is not the route is the amendment I require.**

## 3. What I could NOT verify — the counts, which are wrong

The plan states:

```
run(ctl, …) call sites        22
      … passing a label        7
'--stop' call sites            3
      … passing a label        0
```

Recounted with a balanced-paren walk over the source, so multi-line calls are read whole:

```
real run(ctl, …) CALL sites  21   (the plan counted `function run(ctl, args, cwd, env = {})` at :105 as a call)
      … passing a label       9   (it missed the multi-line calls at :644 and :662)
      … passing none         12   (not 15)
'--stop' call sites           3   ✓
      … passing a label       0   ✓
```

**Three of the four numbers are wrong**, and the headline sentence — *"Fifteen of its twenty-two runs pass no label"* — is wrong in both halves. The `--stop` half, which is the half that carries the argument, is exact.

The two miscounted calls are the very ones that use `stubPlatform`. A recount that read them would have surfaced the mechanism in §2. The arithmetic error and the missed alternative are the same oversight.

**Also unverified by me:** the "2822 leaked sandbox directories, from 103 two hours earlier" figure. I measured **2825** now, but I created some myself, so this is not a check of the plan's number. The plan correctly scopes it out.

**Timestamp correlation — execution SUPPORTS it, with a caveat.** `.plot/logs/registryd.log` last modified **11:40:46**, exactly as stated; `registryd.err` is **0 bytes**, as stated. Execution converts the correlation from circumstantial to mechanistic: I no longer need the timestamps to argue the suite can do it, because I watched it do it. The caveat is that the timestamps alone never identified the *culprit* — they identified the *class*. My decoy runs at 13:22 left the log untouched, which confirms the log records ticks, not deaths, so a bootout is silent there by design. That silence is the plan's point and it holds.

## 4. What breaks if this ships as written?

Very little — blast radius is one file. `grep -rn 'PLOT_FLEET_LABEL'` finds hits only in `test/reconcile/fleetctl.test.mjs`. Three other suites mention `plot-fleetctl` (`controller-gate`, `script-name-gate`, `boardprobe`) but by name, not by running `--stop`.

Two concerns:

**The plan under-scopes its own fix.** It frames the defect as `--stop`, but `:207` and `:216` run `--status` with no label and assert `/^summary: agents_running=\d+ /m`. Those read the **operator's live fleet** as the sandbox's. Not destructive, but it is the same defect and it makes those two tests non-deterministic on a machine with a running fleet — the exact failure the header at `:21-23` says was already measured once. The plan's fix happens to cover them; its prose does not claim them, so a narrow implementer may leave them.

**A guard that refuses an unset `PLOT_FLEET_LABEL` must not live in `plot-fleetctl.sh`.** The plan says "a guard that refuses a `--stop` run without an explicit label". Unset is the **production** default — `:80-84` says so explicitly: *"An operator sees no change. Unset is the default and the only value any skill passes."* A guard in the script would refuse every real `/plot-fleet --stop`. It must be in the test helper. The plan's wording is ambiguous on which side it lands, and on the wrong side it breaks the operator verb this plan exists to protect.

## 5. Existing or nearer mechanism?

`stubPlatform()` at `test/reconcile/fleetctl.test.mjs:598` — covered in §2. It is nearer, stronger, already in the file, and unmentioned. This is the finding that moves me off `proceed`.

Secondary: `--start` is already safe by a different route, which the plan does not credit. I tested it against the loaded decoy — refusal 4 (`:461`) fires:

```
plot-fleetctl: 'com.plot-pm.registryd' is already loaded
decoy after --start: LOADED
```

So the asymmetry is real and load-bearing: `--start` refuses on a foreign label, `--stop` acts on it. That contrast is a better argument for the plan's premise than any count it prints, and it is absent from the plan.

## What would change my position to proceed

1. Correct the four counts, or drop the table — the argument does not need it and the numbers as printed are refutable in one command.
2. Name `stubPlatform` and either adopt it for the three `--stop` tests or state why the label alone suffices.
3. Say the guard lives in the test helper, never in `plot-fleetctl.sh`.
4. Bring `:207` and `:216` into scope explicitly.

The central claim stands. The reasoning around it does not yet.

## Commands run

```
cat docs/plans/2026-09-22-a-test-must-not-stop-the-fleet.md
git status --short; git branch --show-current
launchctl list | grep -i plot ; ls ~/Library/LaunchAgents | grep -i plot
sed -n '1,80p;80,140p;132,142p;220,265p;200,220p;570,620p' test/reconcile/fleetctl.test.mjs
sed -n '75,95p;125,150p;440,470p;640,700p' skills/plot/scripts/plot-fleetctl.sh
node -e '<balanced-paren recount of run(ctl,…) sites>'
cp ~/Library/LaunchAgents/com.plot-pm.registryd.plist $SP/operator-plist.bak
launchctl bootstrap "gui/$(id -u)" $SP/decoy.plist
launchctl print "gui/$(id -u)/com.plot-pm.registryd"
node --test --test-name-pattern='stop' test/reconcile/fleetctl.test.mjs
node --test --test-name-pattern='stop with nothing running' test/reconcile/fleetctl.test.mjs
node --test --test-name-pattern='once per branch' test/reconcile/fleetctl.test.mjs
<hand-built sandbox> bash plot-fleetctl.sh --stop            # with and without PLOT_FLEET_LABEL
<hand-built sandbox> bash plot-fleetctl.sh --start           # refusal 4
stat -f '%Sm' .plot/logs/registryd.log ; wc -c .plot/logs/registryd.err
launchctl bootout "gui/$(id -u)/com.plot-pm.registryd"       # already gone: the test did it
shasum ~/Library/LaunchAgents/com.plot-pm.registryd.plist $SP/operator-plist.bak   # identical
pkill -f '^/bin/sleep 3600' ; rm -rf <manual sandbox>
git status --short                                           # clean
```

**Cleanup verified.** Decoy unloaded (`GONE`; the suite's own bootout had already removed it). Operator plist byte-identical to the backup — `8976376a06af51ad9db14d20f54a75dbdd4f3edd` both sides. Decoy `sleep` processes killed, hand-built sandbox removed, `git status` clean. **The machine's supervisor was already not loaded before I began**, so nothing of the operator's was destroyed — only my decoy.

## Note on the working tree

`git status` was clean when I began and clean when I finished my measurements. At **13:25:32** — two minutes after my last measurement at 13:23 — a concurrent agent in this session modified `test/reconcile/fleetctl.test.mjs` in this shared checkout, implementing the plan's fix (`run()` takes a required positional `label`, with a `throw` guard). **All evidence above was taken against the pristine file**, which `git show HEAD:test/reconcile/fleetctl.test.mjs` still holds. I did not make that edit and did not revert it; it is another agent's in-flight work.

Two observations on it, offered as review rather than as part of my verdict:

- It implements the label half and leaves the three `--stop` call sites at `:136`, `:224` and `:247` **still passing no label** — the argument was added to `run()`'s signature but those three sites were not updated at the time I looked. If that is the finished state, the defect I proved is still live and the `throw` will fire instead. Worth checking before it lands.
- Its comment block repeats the plan's wrong counts verbatim — *"7 of 22 call sites"* — so the arithmetic error is now propagating into the code's permanent record. §3 above has the recount: 21 sites, 9 labelled, 12 not.
