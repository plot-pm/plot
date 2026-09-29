Position: amend
Evidence: executed

## What I ran and what it showed

**Every reading the plan quotes reproduces. The gap is real. The mechanism it blames is not.**

### The two supervisors — confirmed exactly

```
$ launchctl list | grep -i plot
8411	-9	com.plot-pm.registryd
27932	0	com.plot-pm.registryd.ewz-kus-portal
```

### `--status` is blind to the second — confirmed

```
$ skills/plot/scripts/plot-fleetctl.sh --status
platform: launchd
supervisor: running (pid 8411) — com.plot-pm.registryd
  serves:  THIS repository (/Users/jwloka/Quatico/Agentic-Tools/plot)
  last tick: 13s ago (evidence, not the verdict — a busy tick writes at most every 60s)
  bug/a-state-sweep-is-one-request  waiting (pid 39329)
  bug/a-slice-starts-its-own-conversation  running (pid 82882) — quiet 1057s
  (detached) scratch-implement-sprint-item  none
summary: agents_running=1 agents_other=2 supervisor=up install=running tick_age=14
```

The second supervisor does not appear. Confirmed.

### The `serves_line` claim — VERIFIED, both citations exact

```
224: serves_line() { # $1=the answer
456:     serves_line "$(supervisor_checkout)"
478:     serves_line "$(supervisor_checkout)"
```

Those are the only two call sites in 981 lines. `supervisor_checkout` → `supervisor_workdir` → `launchctl print "gui/$(id -u)/$LABEL"`. **There is no existing path that would find another label.** The plan is right, and it is right at the exact line numbers it cites.

### The enumeration is cheap — the plan UNDERSTATES it

```
$ time (launchctl list | grep -c 'com.plot-pm.registryd')
2
0.007 total     # plan says 0.058; measured 7–8 ms, 8x cheaper
```

### Per-label checkout resolution — confirmed

```
com.plot-pm.registryd                    -> /Users/jwloka/Quatico/Agentic-Tools/plot
com.plot-pm.registryd.ewz-kus-portal     -> /Users/jwloka/Quatico/ewz/ewz-kus-portal
```

### The test seam — PROVEN by execution, not by reading

I built a throwaway `launchctl` stub returning two labels and drove the real script through it in a scratch repo:

```
$ PATH="$SB/bin:$PATH" PLOT_FLEET_LABEL=com.plot-pm.registryd bash skills/plot/scripts/plot-fleetctl.sh --status
platform: launchd
supervisor: running (pid 8411) — com.plot-pm.registryd
  serves:  ANOTHER checkout (/Users/jwloka/Quatico/Agentic-Tools/plot) — this repository is /private/tmp/.../fakerepo
summary: agents_running=0 agents_other=0 supervisor=up install=running
```

A PATH-supplied `launchctl` fully drives `--status` **including `serves_line` and the `another` arm**. The two-supervisor case is assertable. **The plan's testability claim is sound — but its line number is wrong:** `guardBin` is minted at `fleetctl.test.mjs:130`, not `:276`. `:276` is inside a comment block about why the PATH rather than the label.

## What a measurement contradicts

### 1. THE CENTRAL CAUSAL CLAIM IS FALSE. The supervisors are not what is spending.

The plan's Motivation makes one causal assertion — the second supervisor is the hidden cost, and `17 scans from five installations is a symptom of the supervisors` (line 121). I traced the actual process ancestry of every running scan:

```
=== are 8411/27932 ancestors of ANY scan? ===
8888<-46011<-1        # parent 46011 = board-server.mjs (plugin cache 2.21.0)
28599<-66504<-1       # parent 66504 = board-server.mjs (plugin marketplace)
28689<-28599<-66504<-1
```

**Not one scan descends from either supervisor.** Every traceable scan's parent is a `board-server.mjs`. And there are **three boards running**, from three different installations:

```
43308  .../Agentic-Tools/plot/.worktrees/free-28240a.../board-server.mjs
46011  ~/.claude/plugins/cache/plot-marketplace/plot/2.21.0/.../board-server.mjs
66504  ~/.claude/plugins/marketplaces/plot-marketplace/.../board-server.mjs
```

The scan installations bear this out:

```
   4 ~/.claude/plugins/marketplaces/plot-marketplace/.../plot-fleet-scan.sh
   2 .../Agentic-Tools/plot/.worktrees/free-dfdc5491/.../plot-fleet-scan.sh
   1 ~/.claude/plugins/cache/plot-marketplace/plot/2.21.0/.../plot-fleet-scan.sh
```

Three installations, and the two heaviest are **plugin installs and a worktree — none of them a supervisor's repo root.** Current load is **17.14** (higher than the plan's 11.48), with 14 scans and 33 `plot-host.sh` processes live.

**This is the estate's named failure mode reproducing: a measured symptom paired with an inferred mechanism.** The symptom (a saturated machine, a board reading dead) is real and reproduces. The mechanism (a second *supervisor*) is inferred from co-occurrence and the ancestry refutes it. Naming every supervisor would have shown the operator **two supervisors and told them nothing about the three boards that are actually spawning the scans.**

The plan even half-sees this — it says at line 121 that counting processes would be *"a second, noisier reading of the same fact."* It is not the same fact. It is the fact.

### 2. THE PREFIX ASSUMPTION UNDER-REPORTS IN A COMMONER CASE THAN THE PLAN ADMITS

The plan calls a non-prefix label *"a stated limit rather than a silent one"* (line 108), framing it as an operator *"free to choose any string."* Executed:

```
$ launchctl list           # operator chose com.quatico.ewz.registryd
com.plot-pm.registryd
com.quatico.ewz.registryd

$ # what the plan's prefix enumeration finds:
com.plot-pm.registryd
```

The second supervisor is invisible **again** — the exact bug, unfixed, and now with a status line saying it looked.

The plan justifies the prefix by *"an override appends to it by convention (…written by hand per `units/README.md:67`)."` **That citation is wrong: `units/README.md:67` is a closing code fence.** The override example is at `:69–72`. And it is a worked example in one README paragraph, not a convention anything enforces:

```
PLOT_FLEET_LABEL=com.plot-pm.registryd.other-repo skills/plot/scripts/plot-fleetctl.sh --start
```

`plot-fleetctl.sh:84` is `LABEL="${PLOT_FLEET_LABEL:-com.plot-pm.registryd}"` — **any string, no validation, no warning.** A convention with one documented example and zero enforcement is not a convention; it is a hope. The plan's own stated limit is therefore reachable by an operator who simply typed a company-flavoured label, which on this very machine (`com.quatico.*` is this operator's own namespace everywhere else) is likely rather than exotic.

### 3. THE SYSTEMD ARM AS SPECIFIED CANNOT FIND A SECOND SUPERVISOR, BECAUSE A SECOND ONE CANNOT EXIST

The plan says the Linux enumeration is `systemctl --user list-units 'plot-registryd*'` and requires *"Both arms exist or the slice is not done"* (line 128). I am on macOS and did not run `systemctl`; both invocations are valid per the documented interface (`list-units` accepts glob patterns; `show -p WorkingDirectory --value` prints the bare value). **The interface is fine. What is broken is the premise underneath it.**

`$LABEL` never reaches the systemd arm. Nine hardcoded sites:

```
156:    systemd) systemctl --user is-active --quiet plot-registryd
167:    systemd) systemctl --user show plot-registryd -p MainPID --value
191:    systemd) systemctl --user show plot-registryd -p WorkingDirectory --value
280:    systemd) printf '%s' "$HOME/.config/systemd/user/plot-registryd.service"
731:      template="$UNIT_DIR/plot-registryd.service"
732:      target="$HOME/.config/systemd/user/plot-registryd.service"
785:      systemctl --user enable --now plot-registryd
913:      systemd) systemctl --user disable --now plot-registryd
```

The fill path writes to a **hardcoded target filename**, and the service template carries **no label placeholder at all** — three placeholders, none of them the unit name. The script says so itself at `:739`:

> `# THE LABEL IS FILLED, not only the filename. … The systemd unit carries no label and the expression finds nothing there.`

And `supervisor_workdir`'s own comment at `:183`:

> `# The systemd arm is read, not run: no Linux machine was available to verify it, and one hardcoded unit name means it can never name another checkout.`

**So on Linux, #1051 was never delivered.** A second Linux checkout's `--start` overwrites the first's unit file and `enable --now plot-registryd` re-points the same unit. `list-units 'plot-registryd*'` will match exactly one unit, forever, by construction. The plan would ship a Linux glob that is correct code over an estate that cannot produce a second match — **a feature that looks delivered on the platform CI can assert and does nothing there**, which is a sharper version of the very defect shape the plan quotes `fleetctl.test.mjs:533-534` to avoid. (That quote is also mis-cited: the plan says `:523`, which is a systemd-directive assertion loop.)

### 4. Citation accuracy, as a class

Four of the plan's six file:line citations are wrong. `:456`/`:478` and `:681-696` and `:141-151` are right. Wrong: `units/README.md:67`, `fleetctl.test.mjs:276`, `fleetctl.test.mjs:523`. In an estate whose plans are read as the specification a worker implements from, three bad pointers in one plan is a defect in the artifact.

## What it must say before someone builds it

1. **Retract or prove the causal claim.** Either measure that the supervisors spawn the scans, or rewrite the Motivation to say what is true: the machine was saturated, three board servers from three installations were spawning the scans, and the second supervisor was *found* during the investigation without being shown to be the cost. The deliverable survives this rewrite — *nothing on the estate answers "what else is Plot running here"* is a real and sufficient gap. The plan does not need the false mechanism and is stronger without it.

2. **Widen the reading, or justify the narrowness against the ancestry.** The measurement says the expensive population is board servers, not supervisors. Either the slice enumerates Plot supervisors *and* boards (`plot-boardctl.sh --status` already answers `server.repo` per board), or the plan states explicitly that it deliberately reports the cheap population and names the issue that covers the other. As written it promises an operator a machine-scoped reading and delivers a supervisor-scoped one.

3. **Replace the prefix with an enumeration that cannot miss.** Options, in order of preference: (a) enumerate `~/Library/LaunchAgents/*.plist` and read each `Label` and `WorkingDirectory`, which finds any label whatever it is called; (b) enumerate every loaded label and match on the `program`/`ProgramArguments` containing `plot-registryd.mjs`, which is identity by what it runs rather than by what it was named; (c) keep the prefix but make `--start` **refuse** an override that does not carry it, turning the convention into a gate, per *Gates Over Rules*. Any of these is testable with the same stub. Shipping a prefix scan plus a disclaimer leaves the bug live for the operator most likely to hit it.

4. **Fix `units/README.md:69-72`'s citation and say the convention is unenforced.** One sentence.

5. **Either make `$LABEL` reach the systemd arm first, or drop the Linux arm from this slice and file it.** The Done-when as written (*"Both arms exist or the slice is not done"*) is unsatisfiable in spirit: the Linux arm can be written and asserted green while being incapable of ever returning two units. State the dependency explicitly — Linux multi-supervisor support is a prerequisite, not a co-deliverable. A `# systemd: one unit per machine today, see #NNNN` comment beside the glob is the honest minimum.

6. **Correct the three citations** so a worker reading the plan lands where it says.

## What executing revealed that reading would not

**Reading the plan, every claim is plausible and the design is careful.** The `serves_line` analysis is correct to the line, the cost argument is real (and conservative by 8x), and the test seam works exactly as claimed — I proved that by writing the stub rather than trusting the sentence.

Three things only execution produced:

**The process ancestry.** `ps -eo pid,ppid,command` walked up from every scan and landed on three `board-server.mjs` processes and never on a supervisor. Reading the plan, `17 scans from five installations` sits under a heading about supervisors and reads as caused by them. The ancestry says otherwise, and no amount of re-reading the plan would have surfaced it. The second supervisor is real, invisible, and — on this evidence — **not the thing that was costing**.

**The second supervisor runs from the plugin cache, not a checkout.** `ps` shows pid 27932 executing `~/.claude/plugins/cache/plot-marketplace/plot/2.21.0/.../plot-registryd.mjs` with cwd `/Users/jwloka/Quatico/ewz/ewz-kus-portal`. The plan models the world as *two checkouts, two supervisors*. The real world here is *a checkout and a plugin install*, and the load comes from installations that are neither. A reading scoped to "supervisors" cannot see that shape at all.

**The systemd arm's impossibility is only visible by grepping the fill path.** The plan reasons from `units/README.md`'s documented Linux install, which looks symmetric with the macOS one. It is not: the plist template has `__LABEL__` and the service template has no label placeholder, and `--start` writes a hardcoded filename. Two greps, and the script's own comments then confirm it in the author's words. Reading the plan's systemd paragraph, the glob looks like a straightforward port.

**Load is currently 17.14 with both supervisors still up** — the plan's 11.48 was measured at a quieter moment than now. The problem it responds to is real and ongoing. That is the case for doing something; it is not the case for this mechanism.
