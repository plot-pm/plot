# Juror: the cause

Position: amend

Lens: this plan asserts a causal chain and explicitly RETRACTS an earlier one. I verified both. **The asserted chain holds at every link. The retraction does not** — it is stated too broadly and rests on the wrong function, and the plan's own `Notes` section is the place a future reader will go to learn why timeouts are safe. It would teach them something false.

Amend rather than reject: no slice's `Done when` depends on the retraction, so the design survives. But the retraction is presented as a measured correction of a costly mistake, and a wrong correction recorded as a lesson is worse than no lesson.

---

## 1. The asserted chain — verified, link by link

### 1a. `--status` ends `supervisor_loaded; exit $?`

Confirmed, and the plan's quotation is exact except that the two statements are on two lines, not one:

```
skills/plot/scripts/plot-fleetctl.sh:363:  echo "summary: agents_running=$n_run agents_other=$n_other supervisor=$(supervisor_loaded && echo up || echo down)"
skills/plot/scripts/plot-fleetctl.sh:364:  supervisor_loaded
skills/plot/scripts/plot-fleetctl.sh:365:  exit $?
```

The script's own header at `:126-127` uses the plan's exact semicolon form (*"`--status`, whose last two lines are `supervisor_loaded; exit $?`"*), so the plan is quoting the comment rather than the code. Harmless.

**Is it the only exit path `--status` takes?** No, and I checked. Every `exit` reachable at or before line 365:

```
87:  git rev-parse --git-dir >/dev/null 2>&1 || { echo "plot-fleetctl: not a git repository" >&2; exit 1; }
274: --wait needs a number → exit 1
278: -h|--help → exit 0
279: unknown argument → exit 1
284: no mode given → exit 1
```

All five exit **before the status arm begins at :294**, so none prints a `summary:` line. `readSupervisor` gates on `summarised`, so each answers `unknown`, not `down`. `SUMMARY_PREFIX`'s docstring names the `:87` case explicitly as *"A SECOND ORIGIN, MEASURED 2026-09-07"*. **The plan's link holds: once the status arm is entered, `:365` is the only way out.**

`set -uo pipefail` at `:62` — **no `-e`**. So no command inside the status arm can abort the script early and skip the summary. The plan does not claim this and it is worth stating: the arm always reaches `:363`.

### 1b. `fleet_install_state` returns four values; `--status` has two arms

Confirmed exactly as the plan states.

```
skills/plot/scripts/plot-fleetctl.sh:203: fleet_install_state() {
204:   supervisor_loaded && { echo running; return; }
...
208:   if [ -n "$unit" ] && [ -f "$unit" ]; then
209:     [ -f "$(start_marker)" ] && { echo installed; return; }
210:     echo interrupted
211:     return
212:   fi
213:   echo not-installed
214: }
```

and the case, reachable only when `supervisor_loaded` is already false:

```
316:     case "$(fleet_install_state)" in
317:       interrupted)
...
328:       *)
329:         echo "supervisor: not installed ($LABEL) — no unit on this machine"
330:         echo "  start it: /plot-fleet --start"
```

**What `installed` actually prints — verified by reading the arms, not inferred.** `installed` falls to `*)` and prints `supervisor: not installed ($LABEL) — no unit on this machine`. The unit file demonstrably exists in that branch (`:208` tested `-f "$unit"` to reach `:209`), so the printed sentence is **false on its face**, exactly as the plan says.

Note the `installed` state is only reachable when `supervisor_loaded` is false (`:204` returns `running` otherwise) — a filled unit, a completed `--start`, and launchd not holding the label. That is a real state (unit unloaded after a completed install) and the plan is right that it is in the same three lines.

### 1c. `readSupervisor` → `exitCode: 1` → `supervisorState` → `down`

Traced and confirmed.

`packages/board/src/server/supervisor-reading.ts:88-99`:
```ts
    const run = await scripts.awaited(SCRIPT, ['--status'], {
      timeoutMs: SUPERVISOR_TIMEOUT_MS,
    });
    return {
      asked: true,
      exitCode: run.code,
      summarised: run.stdout.includes(SUMMARY_PREFIX),
    };
```

`packages/domain/src/rules/supervisor-reading.ts:147-153`:
```ts
export const supervisorState = (readings: SupervisorRun): SupervisorState => {
  if (!readings.asked) return 'unknown';
  if (!readings.summarised) return 'unknown';
  if (readings.exitCode === 0) return 'up';
  if (readings.exitCode === 1) return 'down';
  return 'unknown';
};
```

A completed `--status` on an `interrupted` machine prints its summary, `supervisor_loaded` returns 1, exit 1 → `asked:true, summarised:true, exitCode:1` → **`down`**. The banner then prints `/plot-fleet --start`, the expensive repair. **The plan's core defect claim is correct.**

### 1d. The predecessor's slice shipped the banner and not the third state — CONFIRMED, and stronger than the plan states

`git log` finds no ref `bug/the-board-says-the-fleet-is-stopped`; it merged as **#873 `Reporting`** (`c613ed21b`, 2026-09-10). Its diffstat touches `FleetControls.tsx`, `schema.ts`, `rules/supervisor-reading.ts`, its test, and the rebuilt artifact — the banner. No change to `plot-fleetctl.sh` and no fourth state.

**The gap was known at the time and deliberately excluded.** Commit `6dcb3f6b5`, *"plot: name the adapter gap in the-board-says-the-fleet-is-stopped brief"*, added to that slice's brief:

> **A gap the merged slice opened, and it is NOT yours to close.** #869 taught `--status` to distinguish `NOT LOADED` … from `not installed` … (`plot-fleetctl.sh:319` and `:328`). **The board cannot tell them apart**: `supervisor-reading.ts` reads the exit code, which is `1` for both, so `supervisorState` answers `down` either way and the alert can only ever print the more expensive repair. That is a reading the adapter does not take, so closing it is a plan amendment. **Report it; do not add a fourth state here.**

This **corroborates the plan's diagnosis independently**, from a different author, eight days earlier, naming the same two lines and the same conclusion. It is the strongest evidence in the plan's favour and the plan does not cite it.

It also sharpens one sentence. The plan writes *"no plan carries it as unfinished"* — true, and I checked: no amendment naming the adapter gap ever landed on the Released predecessor (`grep` for `adapter gap|fourth state|amendment` in that plan file returns nothing). But the brief did not merely leave the gap; it **instructed that a plan amendment be filed**, and none was. That is a routing failure worth one sentence, because it is the reason this defect survived eight days with everyone involved already knowing about it.

---

## 2. The retraction — REFUTED

The plan's `## What this is NOT` and its `## Notes` both assert:

> the adapter **rejects** on expiry (`scripts-shell.ts:147`), so the catch returns `{asked: false}` → state `unknown`

and

> **Every timeout path leads to `unknown`, not `down`** — the adapter rejects, the catch fires, the third state exists precisely for this.

**Both sentences are false.**

### 2a. `scripts-shell.ts:147` is in the wrong function

`readSupervisor` calls `scripts.awaited`. In `packages/domain/src/adapters/scripts/scripts-shell.ts`, `awaited` is `:93-106` and calls `runProcess`:

```ts
    awaited: async (script, args, options) => {
      ...
      const run = await runProcess(
        'bash',
        [scriptPath(context, script), ...args],
        withRepo(options),
      );
      return { stdout: run.stdout, stderr: run.stderr, code: run.code };
    },
```

Line 147, the `child.kill('SIGKILL'); … reject(…)` the plan cites, is inside **`stream`** (`:128-193`) — a different operation that `readSupervisor` never calls. The plan cited the rejection belonging to the fleet scan's streaming path and attributed it to the supervisor reading.

### 2b. `runProcess` has no reject path at all

`packages/domain/src/adapters/run-script.ts:60-82`:

```ts
export const runProcess = (…): Promise<ScriptRun> =>
  new Promise((resolve) => {
    execFile(command, [...args], { …, timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS, … },
      (error, stdout, stderr) => {
        const code =
          error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
      },
    );
  });
```

`new Promise((resolve) => …)` — **no `reject` parameter is even bound.** Its own docstring at `:51-53` states the contract:

> *Never throws for a non-zero exit: the exit code is the answer…*

So `readSupervisor`'s `catch` can never fire from a timeout. **The mechanism the retraction relies on does not exist on this code path.**

### 2c. A timeout produces `code: 1`, and `summarised` can be `true`

Measured, reproducing `runProcess`'s exact callback:

```
$ node -e '<execFile with timeout:300, the runProcess derivation>' \
    on: echo "summary: agents_running=3 agents_other=0 supervisor=up"; sleep 5
{"derivedCode":1,"killed":true,"signal":"SIGTERM","rawCode":null,
 "typeofRaw":"object","summarised":true}
```

`error.code` is `null` on a signal kill, so `typeof error.code === 'number'` is false and the expression falls through to **`: 1`** — the script's own word for *not loaded*. `SUMMARY_PREFIX`'s docstring says precisely this:

> `execFile` reports a `SIGTERM` timeout as exit code 1 — the script's own word for *not loaded* — so the code alone cannot tell the two apart.

and `SupervisorRun.asked`'s docstring at `:44-49` says it again:

> `execFile` maps a `SIGTERM` timeout to code 1, which is the script's own word for *not loaded*. Deriving the state from the code alone would render `down` from a call that never completed.

**Two docstrings in the code the plan is amending state the opposite of the plan's retraction.**

### 2d. The panel's question — can a timeout produce `down`? YES.

This is the case the retraction exists to rule out, and it is reachable. `summarised` is `stdout.includes('summary:')`, and the summary line is printed at `:363` — **before** the script blocks anywhere that could exceed the budget? No: `:363` is the *last* line, so on the ordinary timeout the summary has not been printed and `summarised` is `false` → `unknown`. **That much of the plan's conclusion is accidentally right, for a reason it does not give.**

But it is not guaranteed, and I measured two paths that defeat it:

```
B hang-before-summary: {"code":1,"summarised":false,"killed":true,"signal":"SIGTERM"}   → unknown
A hang-after-summary:  {"code":1,"summarised":true, "killed":true,"signal":"SIGTERM"}   → DOWN
C sigkill-self:        {"code":1,"summarised":true, "killed":false,"signal":"SIGKILL"}  → DOWN
```

Case **C** answers the panel's SIGKILL question directly: a process killed by SIGKILL **after** the summary flushed gives `code:1, summarised:true` → **`down`**. The promise resolves normally; nothing rejects. The window is the ~2 lines between `:363` and process exit, so it is narrow — but the retraction claims it is *impossible*, and it is merely *unlikely*.

Case **A** is the more realistic one. The summary at `:363` is the last thing printed, but stdout is a pipe and the process must still exit; more importantly, a caller with a shorter budget, a larger fleet walk, or an OS scheduling stall between the `echo` and `exit` lands in exactly this window.

**Conclusion on the retraction:** *"Every timeout path leads to `unknown`"* is not a property of the system. It is a property of where the summary line happens to sit — an ordering accident, not the guarantee the plan describes, and the two reasons the plan gives for it (the adapter rejects; the catch returns `{asked:false}`) are both wrong.

---

## 3. Is `summary:` the right carrier for slice 1's new field?

**Yes, and it is better-founded than the plan argues.** `SUMMARY_PREFIX = 'summary:'` (`supervisor-reading.ts:64`) and `readSupervisor` tests `run.stdout.includes(SUMMARY_PREFIX)` — a **substring** test, not a parse and not an anchored match. Appending a field to `:363` cannot break it, and the existing `key=value` shape (`agents_running=`, `agents_other=`, `supervisor=`) extends naturally.

**One risk the plan does not name.** The summary line is the `summarised` corroboration itself. Slice 1 puts the new field on the one line whose *presence* is load-bearing for the `unknown`/`down` split. If the install state is emitted on its own line, or before `:363`, the corroboration weakens. The slice should state that the field goes **on** the `summary:` line, not beside it — the plan's `Done when` already says *"in its `summary:` line"*, so this is a note for the implementer rather than a defect in the plan.

---

## 4. Can `--status` exit non-zero for a reason OTHER than the supervisor not being loaded?

**Yes — one path the plan misses, and it produces a false `FLEET STOPPED`.**

`:297-298`, the first arm:
```sh
  if [ "$plat" = "none" ]; then
    echo "supervisor: no init system here — neither launchd nor systemd"
```

On a machine with neither `launchctl` nor `systemctl`, this arm runs, the desk walk runs, `:363` prints the summary, and `:364` `supervisor_loaded` returns 1 (its `case` matches no platform and falls to `return 1`). Measured:

```
F noinit-exit1: {"code":1,"summarised":true,"killed":false,"signal":null}   → DOWN
```

So the board renders **FLEET STOPPED, start it: `/plot-fleet --start`** on a machine where `--start` refuses by design — `:406` is *"REFUSAL 3 — no init system to hand the daemon to."* That is the **same defect class the plan is fixing**: a state the script tells apart in prose and collapses to one bit for the board, producing a repair that cannot work. It is a fifth state, not a fourth, and `fleet_install_state` never sees it because the `none` arm returns before the `case`.

No test covers it (`grep` for `no init system|platform: none` finds only the script itself). I did not find a Linux-container or BSD deployment to prove it fires in practice, so I report it as reachable-by-construction rather than measured in the wild.

Beyond that: `set -uo pipefail` with no `-e` means no mid-arm failure aborts; `pipefail` affects no pipeline whose status reaches `:365`, since `:364` overwrites `$?` unconditionally. The five early `exit 1`s all precede the summary. **So within the status arm, the only non-zero exits are `supervisor_loaded` returning 1 — which now carries four meanings (`interrupted`, `installed`, `not-installed`, `no init system`) and not the three the plan counts.**

---

## 5. One factual claim I could not confirm

> *the exit code is unchanged, 0 loaded and 1 not, since it is the board's contract and **three callers read it***

I find **one** machine reader of that exit code: `readSupervisor` (`supervisor-reading.ts:88`). `skills/plot-fleet/SKILL.md:97` invokes `--status` for a person to read the prose. `grep` across `packages/`, `skills/`, `scripts/` for `fleetctl.sh --status` returns docstrings, changelog entries and plan prose — no second or third code that branches on the code.

The decision (keep the exit code unchanged) is right regardless — it is the board's contract and widening it would break `supervisorState`'s `0`/`1` gate. But *three callers* is a number carrying a claim, and this repository's own writing rule is *"Give the number, the name, or the date, and let it carry the claim … With no fact to give, make the claim smaller."* Name the one caller, or drop the count.

---

## What to amend

1. **Rewrite the retraction.** Delete the `scripts-shell.ts:147` citation and the *"the adapter rejects"* mechanism; both are wrong for this path. Replace with what is true: `awaited` → `runProcess` (`run-script.ts:60`) never rejects, `execFile` maps a SIGTERM timeout to `code: 1`, and what keeps a timeout out of `down` is **`summarised`** — the `summary:` line at `:363` is the script's last, so a killed run usually has not printed it. Say *usually*: measured, a kill after the summary flushes gives `code:1, summarised:true` → `down`.
2. **Keep the retraction's conclusion.** The original diagnosis really was wrong and the cause really is the exit code on a completed run. That part survives intact; only the mechanism is misdescribed.
3. **Add the `platform: none` state** to the table in *"The script knows three answers"* — it is a fourth non-running answer the script prints in prose, it collapses to the same bit, and it prints a repair (`/plot-fleet --start`) that `:406` refuses. Either fold it into slice 1 (it is two lines beside the ones already being touched) or name it as out of scope with a reason.
4. **Cite `6dcb3f6b5`.** The predecessor's brief diagnosed this exact gap at `plot-fleetctl.sh:319`/`:328` and instructed that a plan amendment be filed. It corroborates the plan and names the routing failure that let the defect sit for eight days.
5. **Fix *"three callers read it"*** — I find one.
6. **Slice 1 note:** the install state must go **on** the `summary:` line, since that line's presence is the `unknown`/`down` corroboration.

## What I tried to refute and could not

- The exit-code chain `interrupted → exit 1 → down → wrong repair`. Verified at every link and independently corroborated by a commit eight days older.
- `installed` printing *"no unit on this machine"*. Verified by reading the `case`; the unit file provably exists in that branch.
- `--status` having a second exit path past the summary. It has none.
- The predecessor shipping the banner without the third state. Confirmed from #873's diffstat.
- The design's shape — optional field, `down` when absent, exit code unchanged, banner gains a case. Sound, and correctly scoped to two slices.
