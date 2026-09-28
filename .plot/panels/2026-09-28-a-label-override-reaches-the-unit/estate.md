Position: amend
Evidence: executed

# The estate lens — a label override reaches the unit

The central claim is **true**, which on this author's recent record is itself the finding. I executed it rather than read it. What the plan gets wrong is not its premise but its **blast radius**: it names three tests it must change and names none of them, and its one hedge — about the systemd unit — hides a second defect of a different shape that the stated fix cannot reach.

## 1. The sharpest question: launchd keys by `Label`, executed

Ran in `/private/tmp/claude-501/…/scratchpad/labtest`, labels under `com.plot-panel-test.` only.

**Two filenames, one label:**

```
=== bootstrap alpha.plist (label com.plot-panel-test.shared) ===
exit=0
=== launchctl list | grep plot-panel-test ===
14859	0	com.plot-panel-test.shared
=== bootstrap beta.plist (DIFFERENT filename, SAME label) ===
Bootstrap failed: 5: Input/output error
exit=5
=== launchctl list again ===
14859	0	com.plot-panel-test.shared
=== which plist is launchd holding? ===
	path = /private/tmp/.../labtest/alpha.plist
```

One job, keyed by the label, holding the FIRST file. The second filename bought nothing.

**Inverse — one filename base, two labels:**

```
=== INVERSE: same filename base, DIFFERENT labels ===
exit1=0
exit2=0
32106	0	com.plot-panel-test.two
32029	0	com.plot-panel-test.one
```

Two jobs. The filename is irrelevant; the label is the key. **`docs/plans/2026-09-28-a-label-override-reaches-the-unit.md:38` is verified.**

**Cleanup, as instructed:** all three test labels booted out; `launchctl list | grep plot-panel-test` prints nothing. `com.plot-pm.registryd` (pid 8411) and `com.plot-pm.registryd.ewz-kus-portal` (pid 30516) were never addressed — no `bootout`, no `kickstart`, no unload. They were observed in one `launchctl list` and are both still loaded.

## 2. The defect reproduces end to end

Not inferred — run against the live script and the live template:

```
$ PLOT_FLEET_LABEL=com.plot-panel-test.probe skills/plot/scripts/plot-fleetctl.sh --start --dry-run
state: not-installed
would fill and load com.plot-panel-test.probe (launchd)
```

Then the fill exactly as `plot-fleetctl.sh:654-657` performs it:

```
filename would be: $HOME/Library/LaunchAgents/com.plot-panel-test.probe.plist
Label INSIDE the filled file:
  <key>Label</key>
  <string>com.plot-pm.registryd</string>
surviving placeholders: 0
```

The operator is told the override took effect, the file is named for it, the placeholder gate at `:666-674` passes with **0 survivors**, and `plutil` accepts it. Every guard in the path reports success and the label is the default. That is the plan's claim, executed.

## 3. THE FINDING THIS LENS EXISTS FOR — the estate already contains the workaround, hand-built

`~/Library/LaunchAgents/` on this machine, right now:

```
com.plot-pm.registryd.ewz-kus-portal.plist   Label: com.plot-pm.registryd.ewz-kus-portal
                                             WorkingDirectory: /Users/jwloka/Quatico/ewz/ewz-kus-portal
com.plot-pm.registryd.plist                  Label: com.plot-pm.registryd
                                             WorkingDirectory: /Users/jwloka/Quatico/Agentic-Tools/plot
```

The second checkout's label **matches its filename and is correct**. `--start` cannot produce that file — I just measured that it cannot. So it was written by hand, following `skills/plot/units/README.md:67`:

> **Two repositories need two files.** … change both `com.plot-pm.registryd` occurrences to something like `com.plot-pm.registryd.other-repo`, and the filename to match.

This is not a reason to reject. It is the **strongest available evidence for the plan** and the plan does not use it: the documented workaround is already in production on the author's own machine, and the feature's whole value is making `--start` produce what the operator produced with an editor. The plan should say so — it converts "an override nobody has exercised" into "a manual step two checkouts on this machine perform today".

It also sharpens the upgrade path at `:63`. The existing hand-made unit's label already equals its intended override, so a future `PLOT_FLEET_LABEL=com.plot-pm.registryd.ewz-kus-portal --start` would *adopt* it rather than orphan it — but only because a human happened to pick the same string. The plan should state the rule the operator must follow, not merely that the template is read at install time.

## 4. Undeclared blast radius — three tests the plan must change and does not name

`test/reconcile/fleetctl.test.mjs`. This is the amendment that matters, because `Done when` reads as if the change is additive.

**`:450` — the placeholder inventory asserts the set is exactly three:**

```js
assert.deepEqual([...found].sort(), ['__NODE__', '__REGISTRYD__', '__REPO_ROOT__'],
  `${f} names a placeholder the fill does not replace`);
```

It iterates **both** templates. Adding `__LABEL__` to the plist fails this immediately. And it cannot simply gain a fourth entry, because the systemd template will not have one (§5).

**`:459` — the fill test replaces exactly three and asserts nothing survives.** Also both templates.

**`:487` — the filled-plist test asserts the default label literally:**

```js
assert.match(filled, /<key>Label<\/key>\s*<string>com\.plot-pm\.registryd<\/string>/);
```

With `__LABEL__` in the template this string is never produced by that fixture. The assertion is not wrong today; it becomes a statement about the *filled* output rather than the template, and must move to a fill that supplies a label.

Three failures, in a suite the sprint has already broken once (`a-test-must-not-stop-the-fleet`, #986). `Done when` should name them. A fourth bullet is also owed: **a `--start --dry-run` under an override reports the label it will actually write** — `:622`'s `fakeHome(box, {label})` and `:1231`'s `${fleetLabel}.plist` already build the seam, so this is cheap.

## 5. The hedge at `:59` hides a second, different defect

The plan writes:

> It does not touch `--stop`, `--status` or the systemd unit **beyond the same placeholder, if that unit hardcodes its identity too — the slice checks.**

I checked. **"The same placeholder" is not available on systemd, and the phrasing invites an implementer to look for one and find nothing.**

A systemd user unit has no `Label` field. Its identity **is its filename**, and `skills/plot/units/plot-registryd.service` carries only `__REPO_ROOT__`, `__NODE__`, `__REGISTRYD__` — no identity string to parameterise. `Description=` at `:11` already interpolates `__REPO_ROOT__`, so it is not hardcoded either.

The defect on systemd is the opposite shape: **`PLOT_FLEET_LABEL` is ignored entirely.** Eight sites in `plot-fleetctl.sh` hardcode `plot-registryd`:

- `:156` `systemctl --user is-active --quiet plot-registryd`
- `:167` `systemctl --user show plot-registryd -p MainPID`
- `:220` `$HOME/.config/systemd/user/plot-registryd.service`
- `:451` the remediation line it prints
- `:647`, `:648` template and target
- `:696` `systemctl --user enable --now plot-registryd`
- `:824` `systemctl --user disable --now plot-registryd`

Compare `:219`, which composes the launchd target from `$LABEL`. And `README.md:115` documents the manual systemd workaround — *"Copy the file to `plot-registryd-<name>.service`"* — which is the unit NAME, not a field inside it.

So the `Done when` bullet *"The systemd unit is checked for the same defect and fixed in the same slice, or the plan records that it has none"* offers a binary whose second arm is misleading. The unit **has none**; the **script** has eight, and they are a different fix — deriving a unit name from `$LABEL`, in every one of the eight. That is plausibly its own slice. **The plan must say which**, because "records that it has none" lets an implementer close the systemd question truthfully and leave `PLOT_FLEET_LABEL` silently inert on Linux, which is the identical class of failure the plan exists to remove.

## 6. What I checked and found clean

- **No duplicate plan.** `docs/plans/2026-09-28-a-supervisor-says-which-checkout-it-serves.md` (#1048) reads `WorkingDirectory` out of a loaded job; this writes `Label` into a template. Complementary, and #1048's `Design` already says *"#1051 gives them a way to run both"*. The `Notes` cross-reference at `:83` is accurate.
- **`git log -S __LABEL__`** → one commit, `de023478`, which is this plan being filed. Nothing built and reverted.
- **`--stop` and `--status` genuinely need no change.** Both already read `$LABEL` on the launchd arm (`:823`, `:155`, `:165`, `:219`). I confirmed the exit contract survives: `PLOT_FLEET_LABEL=com.plot-panel-test.probe … --status` printed `supervisor: not installed (com.plot-panel-test.probe)`. The claim at `:59` is true **for launchd**; it is true on systemd only because nothing there reads the override at all.
- **No other `PLOT_FLEET_LABEL` reader.** `grep -rn` finds `plot-fleetctl.sh:84`, the test suite, panel files and plan prose. No doc or script assumes the label is constant beyond the three test assertions in §4.
- **The verify-gate inheritance at `:53` is correct.** `:666-674` greps `__[A-Z_]*__` generically, so a new placeholder is covered with no change.

## Against my own position

**The case for `proceed`:** the premise is executed and true, the fix is four characters in a template plus one `sed -e` clause, the placeholder gate covers the new field for free, the default is unchanged, and no other reader exists. Everything in §4 is a test edit an implementer discovers on the first `pnpm run test:contracts` and fixes in ten minutes — arguably exactly what a slice is for, not what a plan must enumerate. `Done when`'s fourth bullet already says a surviving `__LABEL__` must refuse, which is the §4 machinery acknowledged obliquely. A plan that lists every assertion it perturbs is a plan doing the implementer's reading.

That case is decent and I do not take it, for one reason: **the systemd half is not a test edit.** `Done when`'s last bullet lets an implementer answer *"the unit has none"* — which is **true** — and ship. The result is a feature that works on macOS and is inert on Linux, with a plan recording that the question was asked and closed. This estate's own rule for that shape is `both units start the daemon with --start-agents` at `fleetctl.test.mjs:523`: *"a fleet that assigns on macOS and not on Linux is a defect reproducing on half the installations."* The plan's own words are what would let it recur.

**The case for `reject`:** none that I can support. The defect is real, reproduced, and narrow.

## What the plan must state differently

1. **Split the systemd question out of the hedge.** Replace `:59` and the last `Done when` bullet with the measured fact: the systemd unit carries no identity field, and `plot-fleetctl.sh` hardcodes `plot-registryd` at eight sites (`:156 :167 :220 :451 :647 :648 :696 :824`), so `PLOT_FLEET_LABEL` does nothing on Linux. Then decide **in the plan**: same slice, or a named follow-up. Not "the slice checks".
2. **Name the three test assertions** `:450`, `:459`, `:487` in `Done when`, and say `:450` cannot simply gain a fourth entry because it iterates both templates and only one gains the placeholder.
3. **Add the `--dry-run` bullet.** The operator-visible lie measured in §2 is `would fill and load <override>`; `Done when` asserts the written file and the loaded job but not the line the operator reads before either exists.
4. **Cite the live evidence.** `~/Library/LaunchAgents/com.plot-pm.registryd.ewz-kus-portal.plist`, hand-built per `README.md:67`, with a label `--start` cannot produce. It is the plan's best argument and it is on the author's own machine.
5. **State the upgrade rule, not just the mechanism.** `:63` says a pre-existing unit keeps its label until `--stop` then `--start`. Say what the operator must set: the override must equal the label the old unit was loaded under, or `--stop` will not find it and `--start` will orphan a running supervisor.
