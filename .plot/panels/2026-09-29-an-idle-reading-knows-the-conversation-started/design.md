Position: amend
Evidence: executed

# Design fitness — the `unstarted` mechanism and the alternatives it rejected

The rule is right. **The instrument is wrong for the case the plan is about**, and the plan does not know it, because it never measured a hopping worker. Two of the six Done-when bullets are unassertable or guard nothing, and the cheaper fix the plan says does not exist is already in the estate and already in the monitor's environment.

## What I ran and what it showed

### 1. `.plot-worker.pid` is written ONCE PER LOOP, not once per slice

```
$ grep -rn 'PLOT_PID_FILE' skills/plot/scripts/ | grep -E '>|touch|printf|cp |mv '
skills/plot/scripts/plot-dispatch.sh:1457:  ... ( '"$cmd"' ) & agent=$!; printf "%s" "$agent" > "$PLOT_PID_FILE"; ...
```

**One write, in the wrapper, before `$cmd` starts.** `$cmd` is `plot-worker-loop.sh`, which hops across many slices under that one pid.

```
$ grep -n 'PLOT_PID_FILE\|plot-worker.pid' skills/plot/scripts/plot-worker-loop.sh
826:# reset would rewrite. `reset_desk` uses plain `git checkout` throughout, so a
903:reset_desk() { ... }
939:# THE DECLARATION FILE, per branch. `.plot-worker.exit`, `.plot-worker.pid`,
```

**Zero writes.** `reset_desk` (`:903-938`) removes exactly one file — `rm -f "$wt/$DECLARATION_FILE_NAME"` — then two `git checkout`s. It does not touch the pid file.

So the answer to the question the lens asks — *is it recreated on a branch hop?* — is **no**, and the comparison is therefore **completely broken for a hop**, not exactly right.

### 2. Measured on the live estate: one pid, nine conversations, 7h22m of frozen mtime

```
$ for p in .worktrees/*/.plot-worker.pid; do ... done
free-02487045   waves=5  pid_age=10294  manifest_age=186    newest_txt_age=188
free-c7b58b4f   waves=3  pid_age=26581  manifest_age=22877  newest_txt_age=22727
free-dfdc5491   waves=4  pid_age=10294  manifest_age=4037   newest_txt_age=205
```

`free-c7b58b4f` in detail:

```
pid file mtime : 2026-09-29 12:20:10
process elapsed: 07:22:26          (pid 39329 = bash plot-worker-loop.sh)
current branch : bug/a-state-sweep-is-one-request
manifest       : wavesCount 3, startedAt 2026-09-29T10:20:10Z

distinct MAIN session transcripts at that desk:
06b0fb43…  27a2f3ab…  4b8f759c…  602538c7…  69a23e17…
6d50bcb6…  ce5aec1e…  d3be841c…  fc4f1048…          (9 files)
```

**Nine conversations. One pid file whose mtime has not moved in 7 hours 22 minutes.** The plan says (`:76`) *"its own mtime is when this worker started — … a file whose meaning is exactly `this worker began here`"*. On this desk it means *this LOOP began here*, eight conversations ago.

### 3. The rule does not fire on a hop — executed both directions

Hopping worker, slice 2 silent 2000 s (past the 900 s window), pid written 14400 s ago:

```
pid mtime    : 14400s ago   (the LOOP's launch — fixed forever)
slice2 mtime : 2000s ago    (this slice's conversation, silent 2000s)

PLAN'S RULE: newest transcript OLDER than pid?
  -> NO. Rule does NOT fire. Verdict stays 'quiet' -> idle can fire.

$ ... sample_verdict
quiet=2014 verdict=quiet
```

Restart on a reused desk, prev transcript 10800 s, pid 60 s:

```
  plan's rule: transcript < pid? YES -> 'unstarted'. Rule FIRES here.
```

**So the mechanism covers reading (2) — a `--restart` or a fresh dispatch onto a reused desk — and covers the hop not at all.** The plan's motivation (`:33`) says *"a worker whose first prompt is slow inherits the previous session's last write as its own activity clock"*, and #1074 frames the whole defect around the hop that #1067 fixes. The instrument shields the case the plan mentions in passing and misses the case the ticket was filed from.

### 4. The degradation bullet guards a path that cannot be reached

`plot-worker-monitor.sh:465-471`:

```sh
sample_verdict() {
  monitor_pid_alive; alive=$?
  [ "$alive" = 1 ] && { printf 'gone'; return; }
  [ "$alive" = 2 ] && { printf 'unknown'; return; }
```

and `:343-345`:

```sh
monitor_pid_alive() {
  [ -n "$pid_file" ] && [ -s "$pid_file" ] || return 2
```

Executed against the real script:

```
== CASE A: NO pid file at all (dir exists) ==
no-pid-file    -> verdict=unknown  pid_alive_rc=2
== CASE B: empty pid file ==
empty-pid-file -> verdict=unknown  pid_alive_rc=2
```

**`unknown` publishes nothing** (`:559`: *"`busy` and `unknown` are not findings"*). A desk with no pid file can never reach the `quiet` arm, so it can never reach `idle`. Done-when bullet 4 — *"A desk with no pid file answers as it does today… defaulting to `unstarted` would silently disable `idle` wherever the pid file is missing"* — describes a risk that `monitor_pid_alive`'s `return 2` already eliminates. The bullet is true and vacuous.

### 5. The rejected alternatives

**(a) Joining on session id.** The plan claims (`:80`) the time comparison *"still reads as activity, whoever's session wrote it"*. Constructed and checked:

```
Worker starts T0. Operator opens a session at the desk at T0+60 and types.
operator.jsonl mtime = 1790703766 > pid 1790703706 ? YES
```

**The claim holds for an operator who types AFTER the worker started.** It fails for an operator who typed BEFORE — which on a reused desk is the normal shape, and is the very population the rule exists to detect. The plan states the preserved half and does not state the lost half. The rejection is under-argued rather than wrong.

**(b) A grace period.** The plan rejects it (`:85`) as *"a timer where a measurement is available"* and *"wrong in both directions"*. Measured, the objection cuts both ways: the pid-mtime rule has **no upper bound at all**. It shields `idle` until the conversation's first write, so a launch that never writes is shielded forever. There is no second finding that catches it — the WorkerMonitor has exactly two (`grep -n "finding='"` → `gone` at `:539`, `idle` at `:550`) and the AgentMonitor's is a PR-row finding. A grace period is bounded and wrong at the edges; this is unbounded and silent. The plan should argue against the grace period on the `Worker bound` backstop, not on "a measurement is available" — because the measurement it reaches for is not the one it claims.

### 6. The cheaper fix the plan says does not exist

`plot-worker-loop.sh:301` `update_manifest_on_hop` writes the manifest through `mv -f` on **every hop**. Its mtime tracks slices where the pid's does not — measured above: `free-c7b58b4f` pid 26581 s, manifest 22877 s (3704 s later, the last hop).

And the identity already exists per-slice:

- `session_handle()` (`:717`) → the manifest's `resumeId`, **written on every hop** (`:315`, *"the handle carried across a hop is the handle the hop arrives with"*).
- `session_transcript_exists()` (`:694`) — already does the exact per-session existence join, already in the estate.

**And the monitor can already reach it.** The wrapper exports `PLOT_MANIFEST_FILE` and `PLOT_SESSION_ID` to the monitors:

```
$ sed -n '1440,1458p' skills/plot/scripts/plot-dispatch.sh | grep -o 'PLOT_[A-Z_]*='
PLOT_MANIFEST_FILE=  PLOT_PID_FILE=  PLOT_SESSION_ID=  PLOT_WORKTREE=  ...
```

So *"The monitor does not need a new record"* (`:75`) is right, and the record it names is the wrong one. `stat -f %m "$dir/$(session_handle).jsonl"` — or its absence — answers *has THIS slice's conversation started* exactly, on every hop, with no new field and no new clock.

### 7. The change touches a second caller the plan never names

```
$ grep -rn 'plot_transcript_quiet_seconds' skills/
skills/plot/scripts/plot-worker-loop.sh:1539:  case "$(plot_transcript_quiet_seconds ...)" in
skills/plot/scripts/plot-worker-monitor.sh:374:  plot_transcript_quiet_seconds "$worktree"
```

`ended_reading_available()` (`:1537-1543`) matches `''|*[!0-9]*) printf 'no'`. A new non-numeric word makes it print *"no transcript could be read for this worktree"* (`:1959`) when a transcript **was** read. The plan's "What this does NOT do" lists four things and not this.

Worse: `plot_transcript_quiet_seconds` takes `$1=worktree` only. It cannot see the pid file. Producing `unstarted` there **requires a signature change**, which the plan does not mention while asserting (`:84`) *"It does not change `plot-transcript-quiet.sh`'s question."* Changing its arity is changing its contract.

### 8. Baseline, and what the change would touch

```
$ node --test test/reconcile/workermonitor.test.mjs
ℹ tests 36   ℹ pass 36   ℹ fail 0   duration_ms 55253
```

The plan names `test/reconcile/worker-monitor.test.mjs`. **That file does not exist**; the real path is `test/reconcile/workermonitor.test.mjs`.

36 tests, 63 assertions. The `drive()` harness (`:48-73`) uses a fresh `mkdtempSync` as `PLOT_WORKTREE` and **writes no pid file** — 11 tests stub `monitor_transcript_quiet` and 5 use the `QUIET` ports that drive the idle conjunction. Whether those stay green depends entirely on where `unstarted` is produced: stubbed at `monitor_transcript_quiet` they survive; produced inside `sample_verdict` from a real `stat` on an absent pid file, the answer depends on an unwritten default. The plan asserts they stay green without naming which.

The estate sets test mtimes with `fs.utimesSync` in 8 places across 6 files, including `workermonitor.test.mjs:831` itself. The plan's bullet 1 prescribes `touch -t`, which appears **nowhere** in `test/` or `skills/`.

## What a measurement contradicts

1. **`.plot-worker.pid`'s mtime is not "when this worker started".** It is when the worker LOOP launched. Measured: `free-c7b58b4f`, pid mtime frozen 7h22m, nine main-session transcripts, `wavesCount: 3`. Plan line 76 is false as written.

2. **The mechanism does not fire on a hop.** Executed: slice-2 transcript newer than the pid → `verdict=quiet`, `idle` still reachable. The shape #1074 was filed from is the shape the fix misses.

3. **Done-when bullet 4 guards nothing.** `monitor_pid_alive` returns 2 on an absent or empty pid file and `sample_verdict:471` short-circuits to `unknown`. Executed: `no-pid-file -> verdict=unknown`. The path to `idle` is already closed.

4. **The operator-at-the-desk preservation is half true.** An operator typing after the worker's start is preserved (measured); one who typed before is now read as *unstarted*. The plan states only the preserved half.

5. **A cheaper fix exists and is already wired.** `resumeId` is written on every hop; `session_transcript_exists` already performs the per-session join; `PLOT_MANIFEST_FILE` and `PLOT_SESSION_ID` are already in the monitor's environment. Plan line 75's *"does not need a new record"* is right about the need and wrong about the file.

6. **The change has a second caller.** `ended_reading_available` (`plot-worker-loop.sh:1537`) collapses every non-digit to `no` and would report *no transcript could be read* on a reading that succeeded.

7. **`plot-transcript-quiet.sh` cannot produce `unstarted` at its current arity.** It takes the worktree and nothing else. The plan claims its question is unchanged while requiring its signature to change.

8. **The test path is wrong.** `test/reconcile/worker-monitor.test.mjs` does not exist. `workermonitor.test.mjs` does: 36 tests, 63 assertions, green on main at 55.3 s.

9. **A grace period is bounded; this is not.** The pid-mtime shield persists until the first write, with no ceiling, and the WorkerMonitor has no second finding that would catch a conversation that never starts.

## What it must say before someone builds it

1. **Replace the instrument, or scope the plan to restarts only.** Either read the CURRENT SLICE's transcript — `"$(plot_transcript_dir "$wt")/$(session_handle).jsonl"`, the handle `update_manifest_on_hop` writes on every hop — or state in as many words that this fixes the restart/reuse case and leaves the hop case to #1067, and say what covers a slow hop after #1067 merges.

2. **Correct line 76.** `.plot-worker.pid` is written once per loop by `plot-dispatch.sh:1457`; `plot-worker-loop.sh` never rewrites it and `reset_desk` does not touch it. Cite the measurement: one desk, one pid, nine conversations, 7h22m.

3. **Cut or re-aim Done-when bullet 4.** Absent or empty pid file → `monitor_pid_alive` returns 2 → `sample_verdict` answers `unknown` → nothing published. If the bullet stays, it must assert `unknown`, not "as it does today", and say that the path to `idle` was already closed.

4. **Name the second caller.** `ended_reading_available` (`plot-worker-loop.sh:1537-1543`) must be updated in the same change or the plan must say why `unstarted → no` is the right answer there.

5. **State the signature change.** `plot_transcript_quiet_seconds "$1=worktree"` cannot see the pid file or the session handle. Say which argument is added and that both callers are updated, or move the rule into `plot-worker-monitor.sh` and drop the claim that the reader is unchanged.

6. **State the shield's upper bound.** A conversation that never writes suppresses `idle` indefinitely, and the WorkerMonitor has no other finding. Say `Worker bound` (28800 s) is the backstop — and then rewrite the grace-period rejection to argue against it on that basis rather than on "a measurement is available", which the measurement above does not support.

7. **Name the lost half of the operator case.** An operator whose session last wrote before the worker started now reads as `unstarted`. Say whether that is acceptable and why.

8. **Fix the test path** to `test/reconcile/workermonitor.test.mjs`, and state the baseline: 36 tests, 63 assertions, green.

9. **Use `fs.utimesSync`, not `touch -t`.** The estate's idiom in 8 places across 6 files, including this very test file at `:831`. CI is ubuntu-latest and BSD/GNU `touch -t` forms differ; this repo already measured a `stat -f` cross-platform failure (`plot-transcript-quiet.sh:126-133`).

10. **Say where `unstarted` is produced relative to the `drive()` harness.** Its dir carries no pid file; whether the 5 `QUIET`-port tests stay green depends on the default there, and the plan asserts the outcome without naming the mechanism.

11. **Add a Done-when bullet for the hop.** A desk whose worker hopped to a new slice, whose PREVIOUS slice's transcript is the newest file, must read as `unstarted` — asserted with two transcripts and one pid file older than both. This is the assertion that would have caught the defect above, and no current bullet does.

## What executing revealed that reading would not

Reading the plan, the pid-mtime choice is persuasive: the file is written at launch, the header at `:87-91` already defends mtime, and the argument that this is "the same kind of question" is well made. Nothing in the plan's prose is internally inconsistent.

What reading cannot show is that `plot-worker-loop.sh` contains **zero** writes to `PLOT_PID_FILE`. I found that by grepping for the write, not by reading the argument — the plan never says "written once per loop" and never says "written per slice", so the reader supplies whichever is convenient. Executing `ls -lT` against a live desk with `wavesCount: 3` and nine transcript files, beside a pid file untouched for 7h22m, settles it in one command.

Likewise the degradation bullet: it reads as prudent defensive design. Driving `sample_verdict` with no pid file printed `unknown` in one run and showed the guard was already there at `:471`, twenty lines above the code the plan quotes.

And the cheaper fix: the plan asserts *"The monitor does not need a new record"* and then reaches for the wrong file. Grepping `PLOT_MANIFEST_FILE` in the wrapper's env list showed the manifest is already handed to the monitor — so the per-hop handle the plan needs was one variable away the whole time, and the plan's own "what this does NOT do" section rules out the session join that would have used it.
