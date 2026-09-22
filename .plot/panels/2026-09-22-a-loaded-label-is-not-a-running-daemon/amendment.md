# Juror: AMENDMENT — `a-loaded-label-is-not-a-running-daemon`

Position: amend

Lens: the six requirements Round 1 raised, checked one at a time against the amended file — and specifically whether the SLICE line matches the amended Design, or whether the prose moved while the work did not.

Round 1's verdict was `amend`. The amendment is commit `60d840441`, **19 lines changed on the plan** (`+11 −8`). I read that diff, then re-read the file, then measured the claims again.

**Three of six are answered. One is answered in the Design and contradicted by the slice heading. Two are not answered at all — the plan still prints both refuted sentences verbatim.** And the amendment introduced one NEW unverified claim that Round 1 did not have the chance to test.

---

## The six requirements, scored

| # | requirement | verdict |
|---|---|---|
| 1 | correct the two refuted facts | **NOT ANSWERED** — both sentences survive unchanged |
| 2 | read `supervisor_pid`, not `ps \| grep` | **answered**, Design and slice agree |
| 3 | say what `install=` carries | **half-answered** — the plan says the slice must decide, and the slice does not decide |
| 4 | withdraw the boardctl precedent | **answered**, and correctly |
| 5 | scope the test promise to CI | **half-answered** — scoped, but on a premise I measured false |
| 6 | establish the observations were production | **answered, and the answer is no** |

### 1. The two refuted facts — NOT ANSWERED

This is the requirement Round 1 put first, and the amendment did not touch either sentence. Both are still in the file, at lines the diff never reached:

**Line 32**, the evidence table:

```
| `launchctl list` | label loaded, status `-` | label loaded, status `-` |
```

**Line 38**:

> *"the **third column** of `launchctl list` was `-` on both occasions, which is launchd saying *no pid*."*

Measured independently this session, not taken from Round 1. `man launchctl`, subcommand `list`:

> *"The **first** column displays the PID of the job if it is running. The **second** column displays the last exit status of the job."*

And the live header row, which is unambiguous:

```
$ launchctl list | head -1
PID	Status	Label
```

The `-` is column ONE. Column three is the label and can never be `-`. The plan has the columns off by two and reasons from the mistake — exactly as Round 1 said, and the correction did not happen.

**Line 40**, the KeepAlive claim, likewise untouched:

> *"`KeepAlive: true` is set in the unit and did not restart it, which is its own finding: the daemon exits in a way launchd treats as final."*

Round 1 measured `runs` 38→39→40 in ~40 s and identified a throttled crash loop. I confirmed the unit's configuration that makes that reading coherent — `skills/plot/units/com.plot-pm.registryd.plist:59` `KeepAlive true`, `:65` `ThrottleInterval 60`. The label is not loaded on this machine now, so I cannot re-sample `runs`; what I can check is that the plan's sentence is the one Round 1 refuted, word for word, and that nothing in the amendment addresses it.

**The amendment's own header claims otherwise.** Line 5:

> *"**three facts in the evidence were wrong and are corrected below.**"*

Two of the three are not corrected below. The panel moderation file (`panel.md`) tabulates all three as corrected, and the commit message says *"Three facts corrected."* **The record says the work was done and the file shows it was not.** That is the failure mode this lens exists to catch, and it is the worst one available: a reader who trusts the AMENDED banner will implement from lines 32, 38 and 40 believing they were checked.

**This one fact has already escaped into shipped code.** `registryd-main.ts`, the `catch` the sibling branch landed, carries the refuted claim in its own comment:

```
// `launchctl print` reporting `runs = 1` across both deaths, so
// `KeepAlive` did not restart it.
```

So the false mechanism is now in a source comment on main, in a file nobody will re-open to fix. Every day this sentence stands uncorrected it gets copied one place further.

### 2. `supervisor_pid` — ANSWERED

The Design now reads *"**Ask `supervisor_pid`**, which already exists in `plot-fleetctl.sh`, is already called in the arm being changed, and is **scoped to the label**"*, and the fenced `ps ax … grep -c` block is deleted. **The slice line agrees**, naming `supervisor_pid` and naming both rejected reasons inline.

Verified in code. `plot-fleetctl.sh:145-152` is the function, with the docstring Round 1 quoted:

> *"Asked separately from liveness because a loaded-but-not-running job is a real state and the two answers differ."*

`:312` already calls it in the `running` arm and interpolates `${pid:+ (pid $pid)}`. And the systemd concern is real: `:138` is `systemctl --user is-active --quiet`, which is active-not-merely-loaded, so a `ps` reading bolted on top could only disagree with a correct answer. The smallest change is one `if` on a value the arm already computes, and that is now what the plan describes.

**This is the requirement that mattered most for the code, and it is properly done.**

### 3. `install=` — HALF-ANSWERED, and the half missing is the half that was asked for

The Design gained a whole section, `### install= must move with it`, which states the problem correctly and ends:

> *"**The slice must say which.**"*

**The slice does not say which.** It says:

> *"`install=` either gains the third state or the slice states that it does not and gives `supervisorState` the matching arm"*

That is the same either/or, relocated. The Design delegates the decision to the slice; the slice restates the Design's menu. **Nobody chose.** An implementer reads both and still has two designs in front of them — which is precisely the gap Round 1 asked to close, because the two branches differ in where the work lands: one edits `fleet_install_state` in shell, the other edits `supervisorState` in `packages/domain/`, a different package with a different test suite and a different changeset.

The stakes are verifiable. `supervisor-reading.ts:220`:

```ts
if (readings.exitCode === 1) return readings.install === 'installed' ? 'died' : 'down';
```

Under the plan as written — exit 1, `install=running` — this falls to plain `down`. The script's summary line and its exit code contradict each other, and the board renders a state it cannot name. `supervisorProminence` then returns `alert` when agents are running. That is a shipped defect either way; which fix ships is exactly what nobody decided.

**Requirement 3 asked for a decision and received a restatement of the question.**

### 4. The boardctl precedent — ANSWERED, and the correction is sound

The Design now says *"**The `plot-boardctl.sh` precedent is withdrawn.**"* and re-derives what it actually supports: reporting both readings on separate lines.

I read the file rather than trusting the summary. `plot-boardctl.sh:28-31` puts the two-facts rule on `--stop` explicitly. The `--status` arm at `:255-300` prints `port:`, then `pidfile: N (running)` or `(STALE — no such process)`, then `port N: pid M listening` or `nothing listening`, then `answers: yes/no` with the served repo — four facts, no verdict, no refusal. One comment says so in the file's own words: *"It is reported rather than repaired: removing it here would delete the evidence `--stop` reads."*

**And the correction propagated to the slice**, which now says *"reports both readings on separate lines"*. Design and slice agree. This is the requirement handled best.

### 5. The test promise — HALF-ANSWERED, on a premise I measured false

The slice's old *"Tests pin all three rows"* is now *"**The test promise is scoped to what CI can reach** — `:243-246` already concedes the launchd arm is unexercisable under `ubuntu-latest`"*.

Scoping it was right. **The stated reason is wrong, and it scopes away more than it needs to.**

`test/reconcile/fleetctl.test.mjs:27-30` does say CI is `ubuntu-latest` only. But `:392-398` describes the seam that defeats it:

> *"These drive `fleet_install_state` through the sourced seam with `platform` and `supervisor_loaded` stubbed, **which is what makes the launchd arm reachable on CI's `ubuntu-latest`**."*

And `:616-618`: *"PLATFORM-INDEPENDENT, so CI runs it."*

So the suite already has two techniques for reaching launchd logic on a Linux runner: stub the platform seam, and assert the platform-independent contract separately. The new `loaded, not running` row needs `supervisor_loaded` true and `supervisor_pid` empty — **both stubbable through the same seam the file already uses**, since both are shell functions in the sourced script.

**A slice that concedes untestability where a seam exists will ship untested.** The honest scope is narrower than the plan's: what CI genuinely cannot do is load a real plist and observe a real launchd state. Everything the slice actually changes — the branch, the message, the exit code, the `install=` field — is reachable through the stub seam that already exists. The plan cites `:243-246` as covering this and the relevant concession is at `:27-30`; the line numbers do not point where the plan says either.

### 6. Was it production? — ANSWERED, and the answer is no

This is where the amendment is at its best. A banner at the top of the file, before `## Status`, states plainly that the measured label was a leaked test unit pointing at a temp repo, that it had taken the production label so this repository's own supervisor could never load, and — the sentence that earns the amendment — **"its evidence did not describe production."**

A Notes entry records the leak as a separate defect with the mechanism (`launchd keys by label`), the count, and the remedy (`fleetctl.test.mjs` should not be able to leave one behind).

**The plan says the thing that is least comfortable for it, in its own voice, at the top.** That is the right handling of a refuted evidentiary base, and I would not ask for more here.

**One measurement worth adding, because it moved.** Round 1 counted 103 leaked directories. I counted now:

```
$ ls -d /private/var/folders/*/*/T/plot-fleetctl-* 2>/dev/null | wc -l
9700
```

**9700.** Two orders of magnitude in hours. And the label is currently unloaded, with this repository's own plist present at `~/Library/LaunchAgents/com.plot-pm.registryd.plist` but not bootstrapped — so the state has changed again since the panel wrote. The leak Notes calls this *"worth its own plan"*; at 9700 directories it is worth one now, and the number in the Notes is already stale by 94×.

---

## The NEW claim the amendment introduced, which nothing has checked

Round 1 could not review this, because the amendment created it. The Notes' first bullet was rewritten to:

> *"**Why the daemon dies has its own plan and is already fixed**: `2026-09-22-a-failed-tick-must-not-end-the-daemon.md`, merged the same day."*

**Measured: that plan is `State: Draft`.**

```
$ grep -n 'State:' docs/plans/2026-09-22-a-failed-tick-must-not-end-the-daemon.md
7:- **State:** Draft
```

The code did land — the `catch` is in `registryd-main.ts` and `.changeset/the-loop-survives-a-failed-tick.md` is on main under commit `65071ef52`. So *"already fixed"* is true of the CODE and false of the PLAN, and the two words the sentence uses — *"merged"*, of a plan — name the lifecycle fact that did not happen.

On this estate that distinction is the whole of `/plot-deliver`. A Draft plan whose code shipped is `plot-reconcile-scan.sh`'s own drift finding, and a plan asserting a sibling *merged* when it is Draft is planting a false reading in the one place a reconciler would look. **The amendment replaced a stale claim with an incorrect one.**

It is also not what Round 1 asked for. Requirement 6 was about this plan's evidence; nothing required rewriting the sibling's status, and the rewrite is where the new error entered.

---

## The rubric

**1. Does the problem exist, verified in code?** Yes, and the amendment does not weaken it. `supervisor_loaded` (`:135-141`) is `launchctl print … && return 0`, true for a label launchd holds with nothing under it. `--status` branches on it at `:310` and exits `supervisor_loaded; exit $?` at `:408-409`. `readSupervisor` reads code 0 → `supervisorState` → `up` → the board says nothing. The premise survives every correction to its evidence, which is the amendment's strongest structural feature: the finding that the measured label was a test leak makes the evidence wrong and the defect MORE general, since a leaked unit is simply one more way to reach a loaded label with no process.

**2. Smallest change?** Now yes, at the Design level. `supervisor_pid` is one `if` on a value the arm already computes. Unresolved requirement 3 is what keeps the total size unknown: the `install=` branch decides whether this is a shell-only change or a two-package one.

**3. What I could not verify.** The two 2026-09-22 occurrences remain unreproducible, and the plan now says so itself. `runs` cannot be re-sampled with the label unloaded. I did not test whether `supervisor_pid` returns empty in the live loaded-but-dead state — Round 1 measured that and the state no longer exists on this machine.

**4. What would break as written.** (a) `install=running` beside `exit 1` renders `down` and flips `supervisorProminence` to `alert` — unresolved, per requirement 3. (b) `--start`'s REFUSAL 4 (`:458-467`) calls `supervisor_loaded` directly, so it still refuses a dead-process label and tells the operator to `--stop` when they asked to `--start`. The plan's repair text says `--stop` then `--start` repairs it, which is correct and undelivered — nothing in the slice touches `--start`. Round 1 raised this as observation (c) and did not make it a requirement, so the amendment did not address it; it is still true. (c) An implementer reading lines 32, 38 and 40 writes a comment repeating both refuted facts, as `registryd-main.ts` already does.

**5. Existing mechanism.** `supervisor_pid` — now correctly cited. Nothing nearer.

---

## What would move me to `proceed`

Three edits, all to the plan file, none requiring new measurement:

1. **Actually correct lines 32, 38 and 40.** Columns are `PID | Status | Label` and the `-` is column one. KeepAlive DOES restart, throttled at 60 s — the deaths were a crash loop, not launchd declining. Until these change, the banner claiming they were corrected is itself the most misleading line in the file. Fix the same sentence in `registryd-main.ts`'s comment while the reason is fresh.
2. **Let the slice DECIDE the `install=` branch.** Name one: either `fleet_install_state` gains a third state, or it does not and `supervisorState` gains the arm. The Design already says the slice must say which; the slice must then say which.
3. **Correct the sibling's status.** It is `Draft`; its code merged as `65071ef52`. Say that, or say nothing about its lifecycle. Optionally refresh the leak count — 103 is now 9700.

Requirements 2, 4 and 6 need nothing further. **Requirement 2 in particular is answered in both the Design and the slice, which is the test this lens applies, and it passes it.**

## On what the amendment got right

The banner is the model for how a plan should survive having its evidence refuted: it states the refutation at the top, in its own voice, before the reader reaches the claim. It did not quietly delete the evidence table or soften the framing. And the boardctl withdrawal is a genuine design change rather than a prose repair — the plan now proposes a different output shape because it read the precedent correctly the second time.

**Two requirements were answered in the panel record and not in the file.** That is why this is `amend` and not `proceed`: not because the remaining work is large — it is three edits — but because a plan that announces corrections it did not make has moved from wrong to wrong-and-self-certifying, and the next reader has no reason to check.

Position: amend
