# Juror: READING — `a-loaded-label-is-not-a-running-daemon`

Position: amend

Lens: what `--status` actually reads, what `launchctl` actually reports, whether exit 1 is right for the middle row, and whether `plot-boardctl.sh --status` is the precedent claimed.

---

## 1. Does the stated problem exist, verified in code?

**Yes. Reproduced live on this machine, 2026-09-22 12:20, while writing this verdict.**

The reading is `supervisor_loaded` at `skills/plot/scripts/plot-fleetctl.sh:135-141`:

```sh
launchd) launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1 && return 0 ;;
```

`launchctl print` succeeds on a label launchd **holds**, whether or not a process is under it. The `--status` arm at `:310` branches on exactly that, and the exit at `:408-409` is `supervisor_loaded; exit $?`.

Live, right now:

```
$ skills/plot/scripts/plot-fleetctl.sh --status
platform: launchd
supervisor: running — com.plot-pm.registryd
...
summary: agents_running=1 agents_other=19 supervisor=up install=running
EXIT=0

$ pgrep -fl 'registryd.mjs'
(nothing)        # rc=1

$ launchctl print gui/501/com.plot-pm.registryd
	active count = 0
	state = spawn scheduled
	last exit code = 0
```

`supervisor: running`, exit 0, `install=running`, `supervisor=up` — with **no supervisor process in existence**. The premise is not prose; it is the state of this machine.

So the board's `readSupervisor` (`packages/board/src/server/supervisor-reading.ts:105`) reads code 0 → `supervisorState` returns `up` → `supervisorShown` returns false → **the board says nothing at all** about a supervisor that is not there. That is the worst direction, and it is the one the plan names.

## 2. Is the proposed change the smallest one that fixes it?

**No — and the smaller fix is already sitting in the file, unused.**

`supervisor_pid()` (`:145-152`) already exists, with a docstring that states this plan's own premise verbatim:

> *"Asked separately from liveness because a loaded-but-not-running job is a real state and the two answers differ."*

It is already called in the `running` arm at `:312`, and on this machine it returns **empty** — because `launchctl print` emits no `pid =` line when nothing is running. The fix is one `if` on a value the arm already computed:

```sh
elif supervisor_loaded; then
  pid=$(supervisor_pid)
  if [ -n "$pid" ]; then  … running …  else  … loaded, not running …  fi
```

The plan instead proposes a **new** reading:

```sh
ps ax -o command= | grep -c '[r]egistryd.mjs'
```

Three objections, each measurable:

- **It is a pattern match over process names.** That is the exact guess `plot-boardctl.sh` refuses in a header comment the plan cites approvingly: *"AND NEVER BY PATTERN MATCH. On 2026-09-04 a `pkill -f 'board-server.mjs'` killed an operator's board."* Reading by pattern is safer than killing by it, but it inherits the same flaw: **it is not scoped to this checkout**. Any other repository's registryd on the machine answers `running` for this one. `supervisor_pid` asks launchd about *this label* and cannot make that mistake.
- **It is a second implementation of a question launchd already answers authoritatively**, and `supervisor_loaded`'s own comment (`:121-122`) states the rule the plan would break: *"Answered by the init system, never by a pidfile: … this question has an authoritative answer."*
- **It breaks the systemd arm silently.** `systemctl --user is-active --quiet` (`:138`) is **already process-aware** — it returns 0 only for an *active* unit, not a merely loaded one. So on systemd the defect does not exist, and a `ps | grep` bolted on top adds a reading that can only disagree with a correct one. The plan never mentions systemd; the table has one column named "label" and assumes launchd throughout.

**Smallest fix: gate on `supervisor_pid` in the launchd arm.** No new reading, no new pattern, no systemd regression.

## 3. What the plan claims that I could NOT verify — and two claims I actively refuted

### REFUTED — "`launchctl list`'s third column was `-`"

The plan's table says *"`launchctl list` | label loaded, status `-`"* and §"The reading, and why it is wrong" says *"the third column of `launchctl list` was `-` on both occasions, which is launchd saying no pid."*

`man launchctl`:

> *"The **first** column displays the PID of the job if it is running. The **second** column displays the last exit status. The **third** column is the job's label."*

Measured:

```
$ launchctl list | awk '$3=="com.plot-pm.registryd"{print}'
-	0	com.plot-pm.registryd
     ^col1=- (no pid)   ^col2=0 (last exit)   ^col3=label
```

The `-` is column **one**. Column three is the label, and it is never `-`. The plan has the columns off by two and then reasons from the mistake. Column **two** — which the plan does not mention — carries the last exit status, `0` here, and that is the field the lens question asked about: **yes, it carries an exit code, and the plan's sentence attributes that column's role to the wrong column.** Harmless to the conclusion, fatal to a reader who implements from the prose.

### REFUTED — "`KeepAlive: true` … did not restart it"

§"The reading, and why it is wrong" calls this *"its own finding"*, and the Notes call it *"launchd saying it asked to stop."* The sibling plan `a-failed-tick-must-not-end-the-daemon.md:55` doubles down: *"**`runs = 1`.** Over a period in which the process died twice, launchd counted one start."*

Measured on the live loaded label, three samples:

```
12:20:xx  runs = 38
12:21:12  runs = 39
12:21:52  runs = 40
```

**`runs` incremented twice in ~40 seconds.** KeepAlive is restarting it, exactly as configured, throttled by `ThrottleInterval 60` in the unit template (`skills/plot/units/com.plot-pm.registryd.plist:65`). This is a **crash loop**, not a daemon launchd declined to restart. `runs = 1` was a reading of a *different* label-load, not evidence that KeepAlive is inert.

This matters beyond pedantry: a `ps | grep` sampled inside a 60 s throttle window is a **coin flip**. The proposed reading would report `running` or `loaded, not running` for the same machine depending on when it was asked. `supervisor_pid` has the same sampling problem, but it at least agrees with launchd's own view of the label rather than inventing a second one.

### NOT VERIFIABLE — the two measurements themselves

The 2026-09-22 table (two occurrences, 15:52 and 09:15 last ticks, 131 MB then 8 KB log) is unreproducible now. I take it in good faith; it is consistent with what I see. But the *interpretation* laid on it — a passive dead label — is the part I can check, and it is wrong: what I see is an active respawn loop.

### UNCONSIDERED — the loaded label is not this repository's

The single largest thing the plan misses. The loaded `com.plot-pm.registryd` points at a **test sandbox**:

```
path = /private/var/folders/…/T/plot-fleetctl-start-interrupted-tk8DCK/home/Library/LaunchAgents/
         com.plot-pm.registryd.test-start-interrupted-25315.plist
working directory = /private/var/folders/…/plot-fleetctl-start-interrupted-tk8DCK/repo
```

That is `test/reconcile/fleetctl.test.mjs:699`, *"--start writes no completion marker when it is interrupted cutting desks"*. Its `plot-registryd.mjs` is a **17-byte stub** that exits 0 immediately; both its log files are 0 bytes. So: process exits instantly, `registryd.err` empty, `last exit code = 0`, KeepAlive respawns every 60 s, label stays loaded — **every symptom in the plan's table, produced by a leaked test unit.**

The test comment at `:719-722` shows the author knew the label is machine-global and set `PLOT_FLEET_LABEL` for *other* cases. This case leaked anyway, and the leak now owns the default label on the operator's machine — which also means `--start` here would hit REFUSAL 4 (`:461`, *"is already loaded"*) and point the operator at `/plot-fleet --stop`, which would bootout somebody else's unit.

The plan asserts in Notes that *"Why the daemon dies is NOT in this plan and is the more important question"* and that it *"needs its own measurement"*. **The measurement is available and it says the two 2026-09-22 occurrences may not have been this repository's supervisor at all.** A plan whose entire evidentiary base is two observations should establish that the thing observed was the thing it names.

## 4. What would break if this shipped as written?

**a) The board would start rendering `down` on a machine it cannot distinguish from a healthy one — sampled inside a throttle window.** Exit 1 flows to `readSupervisor` → `supervisorState` returns `down` (or `died` when `install=installed`) → `supervisorProminence` returns **`alert`** when `agentsRunning > 0`. Live right now `agents_running=1`, so this machine would go to `alert` on every board refresh where the sample landed between respawns, and `quiet` where it did not. An alert that flickers is an alert people learn to ignore — which `supervisor-reading.ts`'s own header calls out as the failure mode it exists to prevent.

**b) The `install=` field and the exit code would start disagreeing.** `fleet_install_state` (`:203`) opens with `supervisor_loaded && { echo running; return; }`. Under the plan, `--status` exits **1** while still printing `install=running`. Nothing in `supervisorState` handles that pair: it tests `install === 'installed'` for `died` and falls through to `down`. So the board silently loses the new state, and the script's summary line contradicts its own exit code. The plan's §"What must not break" says *"The exit code and the `summary:` line are unchanged"* — but it changes the exit code without touching `fleet_install_state`, so it breaks the invariant it names. **Either `fleet_install_state` gains the state, or `install=running` beside `exit 1` ships as a lie.**

**c) `--start`'s REFUSAL 4 becomes unreachable in the case that needs it most.** `:461` calls `supervisor_loaded` directly, not the status arm. If the plan only changes the `--status` prose, `--start` still refuses a label whose process is dead — telling the operator to `--stop` when they wanted `--start`. The plan's own repair text (*"say `--stop` then `--start` repairs it"*) is therefore correct but undelivered: nothing in the slice touches `--start`. Worth stating explicitly so the implementer does not assume the refusal moved.

**d) Tests.** `test/reconcile/fleetctl.test.mjs:207,216,493,512,530,567,644,662,679` all drive `--status`. Several assert on exit status. On a CI runner (`ubuntu-latest`, per `:244`) the launchd arm never runs, so **the new row is untestable in CI by the file's own admission** — the same gap `:243-246` already documents. The slice says *"Tests pin all three rows"*; on launchd that is not achievable in CI, and the plan does not say how. That is the slice's largest unfunded promise.

**e) The `ps | grep` self-match.** `ps ax -o command= | grep -c '[r]egistryd.mjs'` can match a *sibling agent's* shell command line containing that string. I hit exactly this while probing: a first `grep` returned 1, and the match was my own `ps ax … | grep` invocation's command line, not a daemon. The bracket trick guards the grep itself, not other processes whose argv quotes the pattern — and on this estate, agents run commands containing `registryd.mjs` constantly. A liveness reading that another agent's `ps` can flip to `running` is worse than the label it replaces.

## 5. Existing mechanism, or a nearer one the plan ignored?

**Three, and the plan cites the wrong one.**

### `supervisor_pid` — same file, already written for this

Covered in §2. Nearest mechanism by a wide margin, and the plan does not mention it once despite it being fifteen lines below the function it criticises, with a docstring stating this plan's thesis.

### `plot-boardctl.sh --status` — the cited precedent does NOT do what is claimed

§"What the reading should be" says:

> *"`plot-boardctl.sh` already holds the pattern for this exact problem on the board side: it requires **two facts to agree** — the recorded pid and the port's listener."*

Read the file. The two-fact agreement rule belongs to **`--stop`**, not `--status`. `plot-boardctl.sh:29-31`: *"`--stop` FINDS THE BOARD BY TWO FACTS THAT MUST AGREE."* The `--status` arm (`:255-300`) does the opposite: it **reports all three facts separately and reconciles none of them** — `pidfile: N (running)` or `(STALE — no such process)`, `port N: pid M listening` or `nothing listening`, `answers: yes/no` with the served repo. Three lines, no verdict, no refusal.

So the precedent, read correctly, is **stronger support for a different design than the plan proposes**: the board's *status* command reports the facts and lets a person reconcile them; only its *destructive* verb demands agreement. A fleet `--status` following that precedent would print the label fact and the process fact on separate lines — which is exactly the plan's §"What must not break" instinct about tick age (*"Report the age; do not derive liveness from it"*), applied one item earlier than the plan applies it.

And the analogy's stated bridge — *"The supervisor has no port, so the pair is the label and the process"* — does not survive the substitution. The board's two facts are **two independent sources** (a file this repo wrote, and the kernel's socket table) that can disagree about *which tree* is serving. The supervisor's "pair" is launchd's label and launchd's own pid for that label: **one source, asked twice.** They cannot disagree about identity, only about liveness. That is a weaker, simpler relation than the one cited, and it is served by reading `pid` from the answer already in hand.

### The sibling plan already removes the cause — and shipped before this one

`docs/plans/2026-09-22-a-failed-tick-must-not-end-the-daemon.md` exists, and `.changeset/the-loop-survives-a-failed-tick.md` is on main:

```
$ git log --oneline origin/main -3
65071ef52 plot: a failed tick must not end the daemon
cace27e2c plot: the supervisor's loop has no catch
742b7bdfa plot: a loaded label is not a running daemon
```

That plan's Notes name this one as its parent (*"Found by asking why the daemon dies, after `a-loaded-label-is-not-a-running-daemon` made the deaths visible"*), so the ordering is deliberate and the division of labour is sound: **this plan reports the symptom, that one removes a cause.** I do not read the sibling as making this plan redundant — a supervisor can still die of something the `catch` does not cover, and the reading would still lie. But it does change the urgency, and it means this plan's §"What must not break" and its Notes are now describing a world that has moved. The Notes' claim that the cause *"needs its own measurement"* is stale: the measurement happened, in the branch next to it, on the same day.

---

## What would move me to `proceed`

1. **Fix the two refuted facts.** `launchctl list` columns are `pid | last-exit | label`; the `-` is column one. And KeepAlive **does** restart the daemon — measured `runs` 38→39→40 in ~40 s — so the deaths are a throttled crash loop, not launchd declining to act. Both sentences currently teach an implementer something false.
2. **Read `supervisor_pid`, not `ps | grep`.** It exists, it is already called in the arm being changed, it is scoped to the label, it cannot be flipped by a sibling agent's command line, and it does not silently regress the systemd arm — which `is-active` already answers correctly.
3. **Say what `install=` carries in the new state.** `fleet_install_state` returns `running` for any loaded label. Either it gains the third state or the plan explicitly accepts `install=running` beside `exit 1` — and if it accepts, `supervisorState` needs the matching arm, or the board renders the new state as plain `down`.
4. **Withdraw or correct the `plot-boardctl.sh` precedent.** Its `--status` reports three facts and reconciles none; the two-fact rule is `--stop`'s. Correctly read, it argues for reporting both readings on separate lines rather than folding them into one verdict.
5. **State how the three rows get tested on a launchd-only path under `ubuntu-latest` CI**, or scope the slice's test promise to what is reachable. `:243-246` already concedes the launchd arm is unexercisable there.
6. **Establish that the 2026-09-22 observations were this repository's supervisor.** The label currently loaded belongs to a leaked sandbox from `fleetctl.test.mjs:699`, whose stub registryd exits 0 instantly with an empty err log — reproducing every symptom in the plan's table. If the two measured occurrences were that unit, the plan's evidence describes a test leak and the fix, while still correct, is aimed at a defect that was never observed in production. **This should be checked before the plan is approved, not after.**

## On the one thing the plan gets exactly right

`--status` must not derive liveness from tick age, and must start nothing. Both are stated clearly and both are correct. And the framing — *"A status command exists to be believed when something is broken, and this one is confidently wrong in exactly that case"* — is the right reason to do this work. The defect is real, I reproduced it, and it should be fixed. The plan's **diagnosis of the symptom is sound; its account of the mechanism, its chosen reading, and its cited precedent are each wrong in a way that would ship into the code.**

Position: amend
