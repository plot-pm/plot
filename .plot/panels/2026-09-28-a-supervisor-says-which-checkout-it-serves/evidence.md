Position: amend
Evidence: executed

# EVIDENCE — #1048 a supervisor says which checkout it serves

## What I ran and what it showed

### The fact IS in the loaded job. The plan's design premise survives.

```
$ launchctl print "gui/$(id -u)/com.plot-pm.registryd"
gui/501/com.plot-pm.registryd = {
	active count = 1
	path = /Users/jwloka/Library/LaunchAgents/com.plot-pm.registryd.plist
	state = running
	…
	working directory = /Users/jwloka/Quatico/Agentic-Tools/plot
	…
	environment = {
		PLOT_REPO_ROOT => /Users/jwloka/Quatico/Agentic-Tools/plot
	}
	pid = 8411
}
```

Exit 0, **no sudo**, from the live supervisor. The checkout is readable, twice over. The plan's *"nothing needs to be added to the unit — only read from it"* is correct on macOS.

I confirmed it parses on a second, independently-installed job too:

```
$ launchctl print "gui/501/com.plot-pm.registryd.ewz-kus-portal" | sed -n 's/^[[:space:]]*working directory = \(.*\)$/\1/p'
/Users/jwloka/Quatico/ewz/ewz-kus-portal
```

That job is a real second checkout, relabelled by hand per `units/README.md:67`. So the *"another checkout, named"* case the plan designs for **exists on this machine right now**, and the sed form extracts it cleanly from both.

## What a measurement contradicts

### 1. FALSE, and it is in the plan's own design section: the command does not work.

The plan writes, in *"The fact is already in the unit"*:

> `launchctl print system/<label>` prints it.

Measured:

```
$ launchctl print system/com.plot-pm.registryd
Bad request.
Could not find service "com.plot-pm.registryd" in domain for system
```

The job is a **LaunchAgent in `gui/$(id -u)`**, not a system daemon. `launchctl print` confirms `type = LaunchAgent`, `domain = gui/501 [100018]`. `system/` is the wrong domain and always will be: `units/README.md:50` bootstraps with `launchctl bootstrap "gui/$(id -u)"`, `plot-fleetctl.sh:686` does the same, and `:155` and `:166` already read `gui/$(id -u)/$LABEL`. The unit is a user agent by design — `plot-registryd.service:30-33` gives the reason (*"A USER SERVICE, NOT A SYSTEM ONE"*).

This is the plan's false central claim. It is not a typo in prose: it is the one line stating how the design's single input is obtained, and the whole plan rests on *"only reading"* being cheap and already-possible. A builder copying that command gets `Bad request` and no `working directory` at all — which routes straight into the plan's own third answer, *cannot determine*, permanently.

### 2. FALSE: the field is not named `WorkingDirectory`.

The plan quotes the **template** (`units/com.plot-pm.registryd.plist:39-40`, `<key>WorkingDirectory</key>`) and then says a loaded job "carries it". `launchctl print` renames it:

```
$ launchctl print "gui/501/com.plot-pm.registryd" | grep -c 'WorkingDirectory'
0
```

Zero. The printed key is `working directory` — lowercase, space-separated, `sed`-extractable as I showed above. Anyone implementing from the plan's quoted XML greps for the wrong string and gets the empty answer, again landing in *cannot determine*. Two independent routes to the same silent wrong answer, and the plan's own safety argument says that answer is the acceptable one — so neither failure would be noticed by the assertions the plan lists.

### 3. The "job predates this field" case cannot exist, and its presence hides the case that can.

Plan: *"unreadable — `launchctl print` failed, **or the job predates this field**."*

```
$ git log --oneline -S 'WorkingDirectory' -- skills/plot/units/com.plot-pm.registryd.plist
f8cb6b03 The machine keeps the daemon alive (#699)
$ git log --oneline --diff-filter=A -- skills/plot/units/com.plot-pm.registryd.plist
f8cb6b03 The machine keeps the daemon alive (#699)
```

One commit for both: `WorkingDirectory` has been in the template since the template was added. No Plot-installed unit has ever lacked it.

The real unreadable cases are different and none is named: a **hand-written** unit (the README's manual path at `:43-47` fills the template, so this is narrow), a job in another **user's** domain, and — the live one — a label whose job launchd does not hold, which answers **exit 113**:

```
$ launchctl print "gui/501/com.plot-pm.registryd.NOSUCH" >/dev/null 2>&1; echo $?
113
```

`plot-fleetctl.sh:141-151` already documents that 113 is launchd's answer for an unheld label and that it leaked out as an exit code once. A reader of this plan would not learn that the third answer's trigger is an exit code the script has been bitten by before.

### 4. Unaddressed: systemd gets none of this, and the plan implies parity.

Every arm of `plot-fleetctl.sh` is two-platform, and the plan's "Done when" lists `--start` and `--status` behaviour without qualification. On systemd there is no `launchctl print`; the equivalent is `systemctl --user show plot-registryd -p WorkingDirectory --value`. I cannot execute it here (macOS), and that is precisely why the plan must name it rather than leave a builder to infer it. Note also `plot-fleetctl.sh:156` and `:167` hardcode the unit name `plot-registryd`, so on Linux the *"another checkout"* answer is unreachable in a different way: two Linux checkouts share one unit file (`:220`, `:648`), so there is never a second job to name. The plan's three-way answer degenerates to two on Linux and it does not say so.

### 5. "Done when" bullet 5 asserts something the design already guarantees, and the way it is phrased is untestable.

> *"Nothing is unloaded or overwritten on any path, asserted by a test that counts `launchctl` write calls as zero."*

The suite's own rule (`test/reconcile/fleetctl.test.mjs:18-24`) is that it *"never unloads anything"* and every case runs under a label launchd does not hold. Counting `launchctl` write calls requires a stub on PATH — the suite already has a `guardBin` mechanism (`fleetctl.test.mjs:276`, passed as an argument to `run`), so this is buildable, but the bullet should name that seam rather than describe an ambition. Baseline is green and worth preserving: I ran `node --test test/reconcile/fleetctl.test.mjs` — **48 tests, 48 pass, 0 fail**, 50.4 s, Node v24.21.0.

## What it must say before someone builds it

1. **Correct the command to `launchctl print "gui/$(id -u)/<label>"`.** `system/` returns `Bad request` and there is no path from it to the design.
2. **Name the printed key as `working directory`**, not `WorkingDirectory`, and give the extraction: `sed -n 's/^[[:space:]]*working directory = \(.*\)$/\1/p'` — verified against two live jobs. Keep the XML quote as *what the installer writes* and separate it from *what launchctl prints*, because the plan currently conflates the two and the mismatch is silent.
3. **Replace "the job predates this field"** with the unreadable cases that exist: exit 113 for an unheld label, a foreign user's domain, a hand-written unit. Say that `launchctl print`'s non-zero codes are not uniformly 1 — `plot-fleetctl.sh:141-151` records that lesson already.
4. **State the systemd answer or scope the plan to launchd.** `systemctl --user show … -p WorkingDirectory --value` is the counterpart; and because `:220`/`:648` hardcode one unit file, Linux has no second-checkout case to name until #1051's systemd half lands. That dependency runs the opposite way from the Notes' *"Either can ship first"* — true on macOS, not on Linux.
5. **Name the test seam** for bullet 5 (`guardBin`, `fleetctl.test.mjs:276`) rather than describing a call counter in the abstract.

Nothing above touches the plan's shape. The three-way answer, the *"unreadable must not become yours"* rule, the refusal to add a second identity mechanism, and the `plot-boardctl.sh --status` precedent (`plot-boardctl.sh:294-296`, `:381` — I read it; it does say *"serving THIS repository"* / *"serving ANOTHER checkout"*) are all sound and all confirmed against the estate. The amendment is to the two lines that say how the fact is obtained, and they are both wrong.

## What executing revealed that reading would not

- **`launchctl print system/<label>` fails outright.** Reading the plan, the command is plausible — it is the form most launchd documentation shows for daemons. Running it prints `Bad request. Could not find service … in domain for system` and nothing else. No amount of reading the plan surfaces the domain mismatch, because the plan never mentions `gui/`.
- **The printed key differs from the plist key.** The plan quotes real XML at `units/…plist:39-40`, so the claim reads as verified. `grep -c 'WorkingDirectory'` over the actual output returns **0**. The plan is quoting the input and describing it as the output.
- **The "another checkout" case is live on this machine.** `com.plot-pm.registryd.ewz-kus-portal`, pid 30516, `working directory = /Users/jwloka/Quatico/ewz/ewz-kus-portal` — installed by hand. So a builder has a real second job to test the named-checkout answer against without loading anything, which the plan does not know and which makes its hardest assertion cheap.
- **The field's git history closes the third answer's stated case.** One commit added the template and the field together (`f8cb6b03`), so *"the job predates this field"* describes no reachable state — visible only by asking git, not by reading either the plan or the unit.
