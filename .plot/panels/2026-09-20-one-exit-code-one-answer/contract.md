# Juror: the contract

Position: amend

Lens: what slice 1 actually costs, and what the single-definition demand breaks.

The defect is real and slice 1's core is achievable. Two of its Done-when clauses
are not, one of its stated causes is refuted at source, and slice 2 is built on a
premise the shell already contradicts in its own comments.

---

## 1. `resultOf` KEEPS stdout. Slice 1's Done-when is achievable.

The panel prompt asked whether `resultOf` discards stdout before `record` is
consulted. It does not, and the ordering is the other way round.

`record` builds the refusal FIRST, from the live `run`, then delegates:

```ts
// packages/domain/src/adapters/host/host-shell.ts:191-199
const record = <T>(run: ScriptRun, parse: (stdout: string) => T): PortResult<T> => {
  if (run.code === 0 || run.code === 4) {
    refusal = null;
  } else {
    const said = run.stderr.trim() || run.stdout.trim() || `plot-host.sh exited ${run.code}`;
    refusal = { kind: refusalKindOfExit(run.code), said };
  }
  return resultOf(run, parse);
};
```

`ScriptRun` carries both streams on every exit — `runProcess` resolves rather
than rejects:

```ts
// packages/domain/src/adapters/run-script.ts:76-80
(error, stdout, stderr) => {
  const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
  resolve({ code, stdout: stdout ?? '', stderr: stderr ?? '' });
},
```

and the interface says so in as many words:

```ts
// packages/domain/src/adapters/run-script.ts:8-11
 * The exit code is separate from stdout because the contract lives in the
 * code: a non-empty stdout beside a non-zero exit is a partial answer, and
 * only the code says whether it may be read.
```

The discard is one line, and it is `resultOf`'s, not `record`'s:

```ts
// packages/domain/src/adapters/run-script.ts:210-218
export const resultOf = <T>(run: ScriptRun, parse: (stdout: string) => T): PortResult<T> => {
  if (run.code === 4) return unaskable<T>();
  if (run.code !== 0) return failed<T>();
  ...
```

**So the rows survive as far as `record`.** Slice 1 can be built by branching in
`record` before it delegates — `if (run.code === 7) return answered(parse(run.stdout))`
— with no change to `resultOf` and no change to `PortResult`. That is the
cheap, correct shape, and the plan does not name it.

This is a finding FOR the plan and it also bounds it, which matters for the
next two sections.

---

## 2. The plan's blast-radius framing is wrong in the direction that inflates it

> *"`ports/host.ts` has no `partial` at all — `PortResult` is answer-or-refusal."*

Half verified, half wrong, and the wrong half is load-bearing.

**Verified:** `ports/host.ts` contains no `partial`. `PortResult` is three-armed,
not two (`port-result.ts:9-12`) — `answered` / `failed` / `unaskable` — so
"answer-or-refusal" understates it by one, but not in a way that helps the plan.

**The number:** `PortResult` appears **274 times across 58 files**. Sixteen ports
declare it, nine adapter families implement it, and the board reads it
(`agent-log.ts`, `plan-cost.test.ts`). Adding a fourth arm to `PortResult`
touches every one of those — every `if (!answer.ok)` becomes wrong, silently,
because `ok: true` with incomplete rows still passes.

**And it is unnecessary.** Section 1 shows `partial` can be expressed at exit 7
without a new arm: the rows ARE the answer, and the sentence already has a home
in `lastRefusal()`, which the port documents as *"the sentence `PortResult`
cannot carry"* and which `record` already sets on every non-zero exit.

So the plan neither names the cheap route nor costs the expensive one. Slice 1's
Done-when — *"`record()` treats exit 7 as an answer that carries rows AND a
sentence"* — is satisfiable, but only if it is written to say `answered` + a
`lastRefusal`, and not a new `PortResult` variant. **It should say which.**

### The port's own docstrings argue a position the plan does not engage

`ports/host.ts:66-70`:

> *"`PortResult` says a call failed and stops there, which is right for every
> caller that only needs to know whether it holds a value. A caller deciding
> how long to wait needs more … So the refusal travels beside the result rather
> than inside it."*

That is the port ALREADY having answered the question the plan reopens: extra
information about a call travels beside `PortResult`, not inside it. The plan
quotes `ports/scripts.ts`'s opposite argument (`partial` as a variant) as
precedent, without noting that the two ports deliberately disagree, and that the
one it proposes to change is the one arguing the other way.

---

## 3. The single-definition demand is the slice's stated point, and it cannot be met as written

> *"the exit-to-meaning mapping is defined in one place that both
> `scripts-shell.ts` and `host-shell.ts` read … a test asserts both adapters
> agree for every code they know"*

**The constants are not duplicated today.** Measured:

```
packages/domain/src/adapters/host/host-shell.ts:128:const EXIT_QUOTA = 5;
packages/domain/src/adapters/host/host-shell.ts:131:const EXIT_SECONDARY = 6;
skills/plot/scripts/plot-host.sh:553:PR_LIST_PARTIAL_RC=7
```

That is the WHOLE estate. `scripts-shell.ts` defines no exit constants at all —
it uses bare literals:

```ts
// packages/domain/src/adapters/scripts/scripts-shell.ts:88-101
if (run.code === 0) return { answer: 'answered', stdout: run.stdout };
const said = run.stderr.trim() || run.stdout.trim() || `plot-host.sh exited ${run.code}`;
if (run.code === 7) return { answer: 'partial', stdout: run.stdout, said };
return run.code === 4 ? { answer: 'unaskable', said } : { answer: 'failed', said };
```

So the plan's evidence for a shared module is a duplication that does not exist.

**And the two adapters cannot agree "for every code they know", because they
know different things and must.** Enumerated:

| code | `hostSaid` | `record` + `resultOf` |
|---|---|---|
| 0 | `answered` | answered |
| 3 | `failed` | `failed` + refusal `failed` |
| 4 | `unaskable` | `unaskable`, refusal CLEARED |
| 5 | `failed` | `failed` + refusal **`throttled`** |
| 6 | `failed` | `failed` + refusal **`secondary`** |
| 7 | `partial` | (the defect) |

`hostSaid` collapses 5 and 6 into `failed`; `host-shell` splits them. That is
not drift — `host-shell` is a CONNECTOR that must answer *how long to wait*
(`ports/host.ts:66-76`, `observe()`, `correctForRefusal`), and `hostSaid` is the
generic `Scripts` port, which carries no limit vocabulary. A shared definition
forced to make them "agree for every code" either lifts `throttled`/`secondary`
onto the `Scripts` port — the exact mistake `ports/host.ts:100-107` names
(*"lifting a sentence onto every filesystem port … would be the same mistake as
lifting `limit`"*) — or it is a definition of numbers only, in which case the
Done-when's "agree" clause asserts nothing about meaning.

**A numbers-only module is defensible and is what should be written.** It also
has a legal home: the purity gate excludes `adapters/`, so a shared file under
`packages/domain/src/adapters/` is fine —

```yaml
# .github/workflows/ci.yml:246-247
hits=$(grep -rlaE "from '(node:|fs|child_process|http|https|net)" packages/domain/src/ \
       | grep -v '^packages/domain/src/adapters/' || true)
```

— and a constants file importing nothing would pass even OUTSIDE `adapters/`,
since the gate greps imports, not location. But CI also asserts every
`ports/<name>.ts` has an `adapters/<name>/` directory (`ci.yml:593`), so the new
module must not look like a port. **The Done-when should name the file and say
it defines codes, not meanings.**

### One more, smaller: `refusalKindOfExit` is exported "for test" and has no test

```ts
// packages/domain/src/adapters/host/host-shell.ts:142-143
 * Exported for test — the mapping is the contract between the script's exit
 * codes and the port.
```

`grep -rn "refusalKindOfExit" packages/domain/test/` returns **nothing**. The
Done-when says *"`refusalKindOfExit(7)` no longer returns `'failed'`, pinned"* —
that pin does not exist to amend; it must be written from scratch. Minor, but the
Done-when reads as though a test is being changed.

---

## 4. Slice 2's premise is refuted by the shell's own comments

This is my strongest finding.

> *"`plot-host.sh` carries 20 `die` calls … and `die` runs `exit 1`. An `exit`
> ends the script, so the collector never runs, `_ok` is never read, and the
> classification does not happen."*

**That is not how the pr-list path is built, and the shell says so twice.**

The failure inside the state loop goes through `pr_list_call`, which is invoked
in a COMMAND SUBSTITUTION:

```bash
# skills/plot/scripts/plot-host.sh:606
_raw="$(pr_list_call "$@" --state "$_s" --json 2>"$_tmp")"; _rc=$?
```

`pr_list_call` calls `pr_list_failed`, whose `exit 6` / `exit 5` / `exit 3`
(`:486`, `:492`, `:501`) therefore leave **only the subshell**. `_rc` captures
it, and `:608-622` counts the failure and `continue`s. The shell documents this
as the reason the design is what it is:

```bash
# skills/plot/scripts/plot-host.sh:569-576
# WHY THE LOOP CANNOT KEEP `|| exit $?`. That propagation is not a style tic:
# `pr_list_call` is invoked in a command substitution — a subshell — so the
# `exit` inside `pr_list_failed` leaves only that subshell … Collecting across
# states means the first failure can no longer end the run, so the subshell's
# exit code is captured and classified instead
```

and again at `:517-524` (*"EVERY CALL SITE MUST WRITE `|| exit $?` … the `exit`
inside `die5`/`die3` leaves that subshell only"*).

**So the classification DOES happen for every host-call failure in the loop.**

I enumerated all 20 `die`/`die3` sites. Their positions relative to the loop:

- **17 are argument-parse or usage failures** (`:2579`, `:2628`, `:2796`,
  `:2874`, `:2925`, `:2928`, `:2951`, `:3007`, `:3290`, `:3390`, `:3556`,
  `:3886`, `:3889`, `:4132`, `:4151`, plus `:1870`, `:4043`). Every one runs
  **before** any row is printed. The plan's own slice-2 text concedes this
  (*"each ends an operation that printed nothing"*), which is the argument for
  leaving them — and it is also the argument that they cannot be the cause.
- **2 are pre-loop guards on the bitbucket pr-list arm**: `bb_require_json`
  (`die3` at `:1671`) runs at `:3209`, and `bb_states_for` (`die` at `:1438`)
  at `:3215` — **both before the `for` loop is entered**, both with a
  deliberate `|| exit 1` because a `die` in that substitution would otherwise
  be swallowed (`:3210-3214` says exactly this).
- **The GitHub arm never reaches `pr_list_states` at all.** `--state all` is one
  `gh` call (`:3122`, `:3152`, `:3183`), each `|| exit $?` at top level.

**I could not find a `die` that fires mid-loop after rows were printed.** Slice
2's Done-when — *"a test that a `die` path reached mid-loop still yields 7 when
an earlier state answered"* — asks for a test of a path I cannot show exists. If
the author has one, the plan must name the line; as written the slice has no
demonstrated defect.

---

## 5. The measurement and the shell contract disagree, and nobody has reconciled them

The plan's diagnosis rests on:

> *"the board has two `pr-list` sites and they are different calls:
> `hostSaid([...,"--state","all",...])` and the port's `prList(state, limit)`,
> which asks ONE state. Three rows is the `open` state."*

Verified — `fleet.ts:2477` asks `--state all`; `host-shell.ts:319-323` passes one
state; `registryd-main.ts:436` asks `prList('merged', 500)`.

**But a single-state call cannot return 7.** The shell's own header:

```bash
# skills/plot/scripts/plot-host.sh:587-590
# A SINGLE-STATE CALL HAS NO PARTIAL ANSWER TO REPORT. With one state asked,
# "some answered and some did not" is unreachable by construction: either the
# one state answered (0) or none did (its own code).
```

Mechanically: `bb_states_for merged` prints one word (`:1437`), the loop runs
once, and `_ok -eq 0` holds on failure, so `:635` returns `_first_rc` — 3, 5 or 6
— never 7.

**So on the port's path, exit 7 is unreachable, and teaching `record` about it
fixes nothing the board measured.** The plan half-concedes this in Notes —
*"One trigger is still unmeasured: what makes the port's `prList` call fail on
this repository at all"* — but then draws the conclusion the evidence does not
support: it attributes the seven rows reading *no PR ever opened* to the port's
`prList`, when `registryd-main.ts:436` is a **merge-queue** consumer that does
not render rows at all, and its refusal path is:

```ts
// packages/board/src/server/entry/registryd-main.ts:436-437
const answer = await host.prList('merged', 500);
if (!answer.ok) return new Set<string>();
```

An empty merged-set makes finished branches look unlanded — a queue defect — not
*no PR ever opened* on a card. The rendering path is `fleet.ts:2477`'s `hostSaid`
with `--state all`, which is the one that CAN return 7 and **is already correct**
(`fleet.ts:2494-2496` keeps the rows and the sentence). `prAgeSeconds: null`
points at that path throwing, and `fleet.ts:2494` throws on `failed`/`unaskable`
— codes 3, 5, 6 — which slice 1 explicitly leaves byte-identical.

**The fix as scoped cannot produce the reported symptom.** That does not make it
wrong — the port SHOULD read 7 correctly, on the `--state all` route a future
caller will take — but the plan's headline claim (*"A Bitbucket board stops
discarding the pull requests the host already returned"*) is not supported by its
own measurement, and the Changelog says it as fact.

---

## What I would amend

1. **Say which shape `partial` takes.** `answered(rows)` + `lastRefusal()` — not
   a fourth `PortResult` arm. State that `PortResult` is untouched, and state the
   58-file count as the reason.
2. **Drop "both adapters agree for every code"** and replace it with the true
   claim: one file defines the NUMBERS; each adapter keeps its own meanings,
   because a connector answers *how long to wait* and the `Scripts` port must
   not. Name the file's path and note `ci.yml:593` forbids a `ports/`-shaped name.
3. **Say `refusalKindOfExit` has no test today**, so the clause reads as writing
   one rather than amending one.
4. **Slice 2: name the mid-loop `die` line, or cut the slice.** The shell
   documents the subshell capture at `:569-576` and `:517-524`; both pre-loop
   guards carry a deliberate `|| exit 1`. As written the Done-when asks for a
   regression test of a path I could not demonstrate.
5. **Correct the causal claim in Changelog and Design.** Exit 7 is unreachable
   on `prList`'s single-state path (`:587-590`), and the rendering path that CAN
   return 7 already handles it (`fleet.ts:2494-2496`). The slice is worth
   building as a contract fix; it is not the fix for the seven rows.

Nothing here is a reason to reject. The defect in `record` is real, cheap, and
correctly located. The plan overstates what fixing it achieves and understates
what its own single-definition clause would cost.
