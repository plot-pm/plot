# Fix-shape lens — a-test-must-not-stop-the-fleet

Position: amend

The defect is real, reproduced, and worth fixing today. The fix is aimed one layer too high, and the file already contains the lower mechanism the plan does not mention.

## 1. Does the stated problem exist, verified in code?

Yes. Every link in the chain is present.

- `plot-fleetctl.sh:84` — `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"`. The fallback is the production label.
- `plot-fleetctl.sh:672` — `launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null`, guarded only by `supervisor_loaded`.
- `plot-fleetctl.sh:137` — `supervisor_loaded` asks `launchctl print "gui/$(id -u)/$LABEL"`, which is machine-global. No `HOME` override reaches it; the file's own comment at `:70-73` says so.
- `fleetctl.test.mjs:105` — `function run(ctl, args, cwd, env = {})`, spreading `{ ...process.env, ...env }`. An omitted label inherits the operator's environment, where `PLOT_FLEET_LABEL` is unset.
- The three `--stop` runs — lines 136, 224, 247 — pass no `env` argument at all.

So a sandboxed `--stop` on this machine calls `bootout` on `com.plot-pm.registryd`. The plan's claim is confirmed at every step.

**One count is off.** The plan says "7 of 22 runs pass the label". Measured: 22 `run(` occurrences includes the definition line, so there are 21 call sites; 9 pass `PLOT_FLEET_LABEL` (lines 493, 512, 530, 567, 644, 662, 679, 709, 725) and 12 do not. The plan's "3 `--stop` sites, 0 passing a label" is exactly right, and that is the half that matters. The 7-vs-9 discrepancy does not change the conclusion but should be corrected, because this plan's whole rhetorical force is that a header's count was false.

## 2. Is the proposed change the smallest one that fixes it?

No — and more importantly it is not the *strongest* one available at equal cost. It is a wide change (21 call sites) that buys a weak guarantee.

The plan's shape:
- make `run()` take the label as a required argument,
- pass the sandbox's label at every call site,
- add a guard refusing a run whose `PLOT_FLEET_LABEL` is unset.

**A required argument is not a gate, it is a rule with a type signature.** CLAUDE.md's own test applies: *"Can you answer 'Did I complete this?' without actually doing the work?"* A caller that passes `run(ctl, ['--stop'], root, someLabel)` satisfies the signature completely while passing the wrong label — a sibling sandbox's label, a stale variable, a copy-paste from the case above. The prompt's own framing asks this and the answer is no: requiring an argument converts *forgot to pass one* into a compile-time-ish error and leaves *passed the wrong one* exactly as reachable as it is today. Given the file mints `fleetLabel` per sandbox and destructures it separately from `root`/`ctl`/`box`, a case that destructures `{ root, ctl }` and then needs a label is precisely the copy-paste shape that produced the current defect.

The refusal guard is the stronger half of the plan and it is in the right place conceptually — but it is stated as *refuse a run whose `PLOT_FLEET_LABEL` is unset*, which is a check on the harness's own wrapper. It still cannot see a wrong-but-present value.

## 3. What could I NOT verify?

- **The three supervisor deaths and their timestamps.** `registryd.err` being 0 bytes, the 11:40:46 tick, the 11:42:31 sandbox — I did not attempt to reconstruct these, and I was instructed not to load or unload any launchd job. The causal chain is verified from the code, which is stronger evidence than the timeline anyway; the timeline is corroboration.
- **That `bootout` actually fired rather than `supervisor_loaded` returning false first.** On a machine with no fleet loaded, the `--stop` tests reach the `else` arm and print "supervisor was not loaded" harmlessly. The damage requires a live fleet — which is exactly the operator's machine and exactly not CI (`ubuntu-latest`, no launchd). This makes the defect *invisible in CI by construction*, which the plan says but is worth stating as a verification limit: no CI run will ever confirm or refute this.
- **The 7-of-22 figure**, which I measured as 9-of-21.

## 4. What breaks if it ships as written?

Nothing breaks. That is a real point in its favour — the change is mechanical, the three `--stop` tests keep their coverage, `supervisor_loaded` stays machine-global, and the sandbox's label-per-case is preserved. I find no regression risk.

What it *fails to prevent* is the next instance. Three concrete ones:

- **A new test added later.** The guard refuses an unset label; a contributor adding a case copies a neighbouring line, gets a label, and the guard is silent. If they copy from the wrong neighbour they get a *different sandbox's* label, and on a concurrent `node --test` run that is another live sandbox.
- **Any other verb that reaches launchd.** `--start` calls `launchctl bootstrap` at `:535`. The plan scopes itself to `--stop` because that is what was measured, but `bootstrap` under the production label is how the *sibling* defect happened (see §6). A label-passing discipline covers this only as far as discipline goes.
- **Any other test file.** The fix lives entirely inside `fleetctl.test.mjs`. Nothing stops a future `fleet.test.mjs` or an e2e suite from invoking `plot-fleetctl.sh --stop` with a bare environment. The guard the plan adds is a guard on *this file's* wrapper.

## 5. Is there an existing mechanism, or a nearer one the plan ignored?

**Yes, and it is in the same file, 340 lines below the defect.**

`fleetctl.test.mjs:599` — `stubPlatform(box, { kernel, loaded })` — creates a `stub-bin` directory and writes an executable `launchctl` into it:

```js
write('launchctl', loaded ? 'exit 0' : 'exit 113');
write('systemctl', loaded ? 'exit 0' : 'exit 3');
write('uname', `[ "$1" = "-s" ] && echo ${kernel} || exec /usr/bin/uname "$@"`);
```

Its own docstring at `:576` names the seam explicitly:

> **THE SEAM IS `PATH`, NOT THE SOURCED FORM.** … `platform` keys off `uname -s` and `command -v launchctl`, and both resolve through `PATH`. Stubbing them drives the REAL arm — the state machine, the summary line, and `exit $?` — on Linux and macOS alike.

This is the mechanism the prompt asks about, it already exists, it is already used by two cases (lines 643, 661), and **the plan does not mention it once.** The three dangerous `--stop` tests simply never call it.

The estate does this everywhere. `grep "PATH:" test/` returns stub-bin prepends across `host.test.mjs` (20+ sites), `approve.test.mjs`, `budget.test.mjs`, `release-refs.test.mjs`, `boardprobe.test.mjs`, `bb-capability-probe.test.mjs`, `index-read-once.test.mjs`. **Shadowing a machine-global binary on `PATH` is this repository's settled answer to exactly this question**, and the fleetctl suite is the one place it was applied to `--status` and not to `--stop`.

**Why PATH-shadowing is the better layer.** It is a gate where the label is a rule:

| | required label argument | `launchctl` on `PATH` |
|---|---|---|
| forgot to pass | caught | caught |
| passed the *wrong* label | **reaches the machine** | caught |
| a new verb reaches launchd | uncovered | caught |
| runs on CI (no launchd) | vacuous | exercises the real arm |

A stubbed `launchctl` cannot boot out anything, whatever label it is handed. The failure mode the plan is fixing — *a value was wrong and the call reached the machine* — is structurally unreachable, not merely discouraged. And it makes the header's claim *"nothing here touches the real init system"* true in the strong sense rather than the conditional one.

**The narrower alternative the plan also ignores.** Should `plot-fleetctl.sh` itself refuse to act on the default label when it detects a sandbox? I judge **no**, and this is the one place the plan's instinct is right even though it does not argue it. The script cannot define "a sandbox" without inventing a heuristic — repo path under `$TMPDIR`, a missing remote, a `.nvmrc` that looks synthetic — and every such heuristic is a guess. `plot-boardctl.sh`'s design note in CLAUDE.md is the precedent, refusing a `pkill -f` pattern-match for exactly this reason: *"a pattern over process names is exactly that guess."* Putting sandbox-detection in the production script would be the same class of error, and would make `--stop` refuse for an operator whose repo happens to sit in an unusual path. **The isolation belongs in the harness, not in the script.** That is an argument the plan should make rather than leave implicit, because it is the reason the fix is a test-side fix at all.

**Recommended shape.** Keep the plan's diagnosis and its `--stop`-keeps-testing-`--stop` constraint. Replace the required-argument-at-21-sites mechanism with:

1. `sandbox()` returns a `bin` from `stubPlatform` (or `run()` prepends it unconditionally), so **no run in this file can reach the real `launchctl`, `systemctl` or a real `uname -s`**. This is one change at one seam instead of 21, and it is strictly stronger.
2. Keep the label — it is correct, it is what makes `--status` assertions meaningful, and the plan is right that the sandbox's label-per-case stays. Pass it from the same seam rather than at every call site.
3. Keep a guard, but point it at the gate rather than the rule: refuse a run whose `PATH` does not lead with the stub dir. That is checkable without knowing which label was intended.
4. Correct the header, as the plan says — and note that after (1) the header's claim becomes *enforced* rather than *restated*.

If the panel prefers the plan's shape, the required argument should at minimum be the whole sandbox handle (`run(box, args)`) rather than a bare string, so a caller cannot supply a plausible-looking wrong value as easily as the right one.

## 6. Scope: are the 2822 leaked directories a separate defect?

**No. It is the same wire, and deferring it is not defensible as written.**

Measured now: `ls -d $TMPDIR/plot-fleetctl-* | wc -l` → **2822**. `sandbox()` calls `mkdtempSync` and the file never removes `box` — there is no `after()`, no `rmSync(box)`, nothing. The two `rmSync` calls at lines 262 and 308 remove a desk and a temp file inside a sandbox, never the sandbox.

The plan's own Notes concede the connection and then step over it:

> One of them held the production label earlier the same day, which is recorded in `a-loaded-label-is-not-a-running-daemon.md`.

Reading that sibling plan makes the case decisive. Its post-panel amendment says the label it measured was **a leaked test unit** — `com.plot-pm.registryd.test-start-interrupted-25315`, pointing at a temp repo, `runs = 43` — and:

> launchd keys by label, so the repository's own supervisor could not load while a test's sandbox held it — the fourth refusal `plot-fleetctl.sh` already names, reached from a direction nobody expected. … **`fleetctl.test.mjs` should not be able to leave one behind.**

That is the same sentence this plan is about, and it names this plan's file. Both defects are *the test suite's artifacts escaping into machine-global state*:

- this plan: a test's **call** reaches the machine's launchd and removes the operator's label;
- the leak: a test's **plist** reaches the machine's launchd and occupies the operator's label.

One unloads the fleet; the other prevents it loading. An operator cannot distinguish them — both present as a supervisor that is not there. Fixing only the first leaves the second live, and the second has *already* been observed taking production down once.

**And the cheap fix is the same seam.** A stubbed `launchctl` on `PATH` cannot `bootstrap` a leaked unit any more than it can `bootout` a real one. Choosing the PATH gate over the label argument closes both defects with one change; choosing the label argument closes one and leaves 2822 directories and a demonstrated production incident to another plan.

I would accept deferring the *disk cleanup* — deleting 2822 directories and adding `after()` teardown is genuinely separate housekeeping, and reasonable to split. I do not accept deferring the *capability*: the suite must not be able to install a unit under any label, and that belongs here because it is the same mechanism and the same seam.

## Amendments requested

1. **Replace the fix mechanism with PATH-level isolation.** Route every `run()` in `fleetctl.test.mjs` through a stub `bin` so no test can reach the real `launchctl`/`systemctl`. Reuse `stubPlatform`, which already exists in this file and already does this for two cases. State why the isolation belongs in the harness and not in `plot-fleetctl.sh` — the sandbox-detection heuristic is a guess of the class `plot-boardctl.sh` already refuses.
2. **Keep the label, drop the 21-site edit.** Pass `fleetLabel` from the same seam. If the required argument is kept anyway, take the sandbox handle rather than a bare string.
3. **Point the guard at the gate.** Refuse a run whose `PATH` does not lead with the stub dir, not merely one whose `PLOT_FLEET_LABEL` is unset — the latter cannot see a wrong-but-present value, which is the failure this plan exists to make unreachable.
4. **Correct the count.** 9 of 21 call sites pass a label, not 7 of 22. A plan whose argument is that a header's count was false must get its own right.
5. **Bring the leak's *capability* into scope.** The suite must not be able to install a unit under any label; that falls out of (1) at no extra cost. Disk cleanup and the 2822 existing directories may stay deferred, and the plan should say which half it is deferring.
6. **Note that CI cannot see this defect.** `ubuntu-latest` has no launchd, so neither the bug nor the fix is observable in CI. The PATH gate partly repairs this by driving the real arm on Linux — which is what `stubPlatform`'s docstring already claims as its reason for existing.

The diagnosis is excellent and the evidence chain is sound. The fix picks the weaker of two mechanisms while the stronger one sits unused in the same file.
