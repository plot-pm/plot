# Panel — a supervisor says which checkout it serves (#1048)

Subject: `docs/plans/2026-09-28-a-supervisor-says-which-checkout-it-serves.md`
Round 1, 2026-09-28. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| evidence | amend | executed |

**One lens, not three.** This plan was briefed in the bundled run and received a single juror. The verdict stands on executed measurements against the live supervisor and the amendment is unambiguous, so a second lens was not commissioned — but the panel is narrower than #1051's and this record says so rather than implying parity.

## The premise survives

The fact IS in the loaded job, readable with exit 0 and no sudo:

```
$ launchctl print "gui/$(id -u)/com.plot-pm.registryd"
	working directory = /Users/jwloka/Quatico/Agentic-Tools/plot
	environment = { PLOT_REPO_ROOT => /Users/jwloka/Quatico/Agentic-Tools/plot }
```

Confirmed on a **second, independently installed** job — `com.plot-pm.registryd.ewz-kus-portal`, serving `/Users/jwloka/Quatico/ewz/ewz-kus-portal`. So the *another checkout, named* case the plan designs for exists on this machine right now, and the `sed` extraction works on both. The plan's *"nothing needs to be added to the unit — only read from it"* is correct on macOS.

## Both lines saying HOW are wrong, and both fail silently

This is the finding. The plan's design rests on one sentence describing how its single input is obtained, and that sentence contains two independent errors:

1. **`launchctl print system/<label>` returns `Bad request`.** The job is a LaunchAgent in `gui/$(id -u)`; `system/` is the wrong domain and always will be, since `plot-fleetctl.sh:686` bootstraps into `gui/` and `:155`/`:166` already read from there.
2. **The printed key is `working directory`, not `WorkingDirectory`.** `grep -c 'WorkingDirectory'` over the real output returns **0**. The plan quotes genuine XML from the template and describes it as what `launchctl` prints — quoting its input as evidence for its output.

**Neither failure would be caught by any assertion the plan lists.** Both route into *cannot determine*, which the plan's own safety argument designates the acceptable answer. A builder implementing from the plan as written ships a command that permanently answers "cannot determine" and passes its own tests.

## The third answer's stated cause cannot exist

*"the job predates this field"* describes no reachable state. `git log --diff-filter=A` and `git log -S WorkingDirectory` both return one commit, `f8cb6b03` — the template and the field arrived together. Naming an impossible cause hides the reachable ones: **exit 113** for an unheld label (which `plot-fleetctl.sh:141-151` records having leaked out as an exit code once), a foreign user's domain, and a hand-written unit.

## Linux gets a different plan than the one implied

`launchctl print` does not exist there; the counterpart is `systemctl --user show plot-registryd -p WorkingDirectory --value`, which the juror could not run. More structurally: `plot-fleetctl.sh:156`, `:167`, `:220`, `:648` hardcode one unit name, so two Linux checkouts share one unit file and **there is never a second job to name**. The three-way answer degenerates to two.

This inverts the plan's Notes. *"Either can ship first"* is true on macOS and false on Linux, where this command needs #1053's per-checkout unit name before its central case is reachable.

## Amendments required before approval

1. Correct the domain to `gui/$(id -u)` and the key to `working directory`, with the verified `sed` extraction. Keep the XML as *what the installer writes*, separated from *what launchctl prints*.
2. Replace *"the job predates this field"* with the reachable unreadable cases, and note that `launchctl print`'s failure codes are not uniformly 1.
3. State the systemd counterpart and mark it unverified; say the *named checkout* answer is unreachable on Linux until #1053.
4. Name the `guardBin` seam (`fleetctl.test.mjs:276`) for the write-count bullet rather than describing a call counter.
5. Add an assertion that the reading is taken against real `launchctl print` output — a test grepping the plist passes while the feature is broken.
6. Cite the live second supervisor. It makes the hardest assertion testable with no loading.

## What is sound and confirmed

The three-way answer, the *"unreadable must not become yours"* rule, the refusal to add a second identity mechanism, and the `plot-boardctl.sh --status` precedent (`:294-296`, `:381`) were all checked against the estate and hold. **The amendment is to two lines, not to the design.**
