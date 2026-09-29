Position: amend
Evidence: executed

# Type design and exhaustiveness — #1073

## What I ran and what it showed

### 1. Every cited file:line, checked

| Plan cites | Actual | Verdict |
|---|---|---|
| `reapable.ts:13` — the union | `export type MergeReading = 'merged' \| 'not-merged' \| 'unreachable';` | **exact** |
| `gates.ts:104-110` — three arms | `prGate` at 104-110, last arm is a bare `return` | **exact** |
| `acting.ts:117` — tests `branch === ''` | `  if (branch === '') {` | **exact** |
| `free.ts:66` — tests `branch === ''` | `  return reading.branch === '' \|\| reading.sliceHasMerged;` | **exact** |
| `reapable.ts:51` — consumer | `  merge: MergeReading;` | **exact** |
| `gates.ts:20` — consumer | `  merge: MergeReading;` | **exact** |
| `supervisor.ts:56`, `:278` | `merge(branch: string): Promise<MergeReading>;` / `prMerged(...)` | **exact** |
| `registryd-main.ts:20` | import is at **`:22`**, not `:20` | **off by two** |

The `registryd-main.ts:20` slip is cosmetic. Everything else is quoted accurately. The plan's *reading* of the code is honest — its **inference** from that reading is not.

### 2. I applied the change and typechecked. This is the finding.

Scratch worktree (`git worktree add --detach`, never a stash in the shared tree), `not-asked` added to the union, Node v24.21.0, pnpm 10.27.0:

```
=== DOMAIN tsc, exit code check ===
DOMAIN_EXIT=0

=== BOARD typecheck (WITH not-asked) ===
> @plot-pm/board@0.15.0 typecheck
> tsc --noEmit
(no output)
```

**Zero errors. Both packages. The compiler named nothing.**

### 3. Why: there is no exhaustiveness site to trigger

```
$ grep -rn "switch" gates.ts reapable.ts supervision.ts supervisor.ts
(none)
```

Every consumer reads the type by **equality**, never by a discriminated switch:

```
gates.ts:105:     if (readings.merge === 'merged') return null;
gates.ts:106:     if (readings.merge === 'unreachable') {
reapable.ts:113:  if (readings.merge !== 'merged') {
reapable.ts:235:  if (readings.merge !== 'merged') {
reapable.ts:454:  noMergedPr: readings.merge === 'merged' ? 'false' : 'true',
```

`landed.ts:61` has the repo's only `switch (readings.merged)` — a **different type**. Adding a member to a union consumed only by `===` / `!==` is invisible to `tsc` by construction. Not a gap in the plan's list of four consumers — a category error about what widening a union does.

### 4. I ran `prGate` over all four values with an empty branch

```
PRGATE merge=merged       -> null (PASS)
PRGATE merge=not-merged   -> No merged PR for ``. The host holds no PR for this branch that has merge
PRGATE merge=unreachable  -> The git host could not be asked whether a PR for `` merged. This is not
PRGATE merge=not-asked    -> No merged PR for ``. The host holds no PR for this branch that has merge
```

**`not-asked` produces byte-for-byte the message the plan exists to remove.** Slice 1 as written — "add `not-asked` to `MergeReading`" — ships the defect unchanged, silently, and green.

### 5. Full domain suite with the change: no regression

`Tests 3 failed | 2764 passed`. All three were one file, `ports-real-state.test.ts > answers the merged question with three values`, at **5003 ms** — a timeout. Run alone: baseline **32 passed**, with the change **32 passed**. Load flake, not the change. Nothing in 2767 tests notices `not-asked` exists.

### 6. The reading really is `unreachable` today — this claim holds

```
$ bash skills/plot/scripts/plot-host.sh pr-merged ""
plot-host.sh: line 3342: 1: pr-merged needs a branch
EXIT=1
```

Exit **1**, not the contract's exit 3. `host-shell.ts:216 record()` treats anything but `EXIT_OK`/`EXIT_UNASKABLE` as a refusal → failed `PortResult` → `registryd-main.ts:344` `if (!answer.ok) return 'unreachable'`. Confirmed: the rule receives `'unreachable'`.

And the population is real — the live registry right now:

```
2c84bba2… "branch": ""   pid 83877  ALIVE
d1cc0112… "branch": ""   pid 95283  ALIVE
fc4f1048… "branch": ""   pid 39329  ALIVE
a9bc4536… "branch": "bug/a-slice-starts-its-own-conversation"
```

Three of four agents hold no branch, and `supervisor.ts:186` calls `world.merge(branch)` unconditionally in its `Promise.all`. So a spurious `unreachable` is genuinely computed every tick. **That half of the motivation is sound.**

## What a measurement contradicts

**1. THE FALSE CENTRAL CLAIM — plan line 80: "The compiler will name every site that must decide, which is why this is a contained change rather than a search."**

Measured: `DOMAIN_EXIT=0`, board `tsc --noEmit` silent. The compiler names **zero** sites. The question the brief asked — "Is the count 4, or more, or fewer?" — has the answer **zero**, and that is worse than either direction it anticipated. The plan's stated reason for confidence is the one thing that does not hold, and it is load-bearing: "Done when" item 3 says *"Every consumer decides the new word deliberately, with the exhaustiveness error resolved rather than defaulted"*. **There is no exhaustiveness error to resolve.** That acceptance criterion is vacuously satisfiable by the empty change — an implementer can add the word, run `tsc`, see green, and honestly report the item met.

This is precisely the estate's recurring shape the brief warned about: a **measured symptom** (a real spurious `unreachable`, verified above) paired with an **inferred mechanism** (the compiler will drive the work). The symptom is real. The mechanism is absent.

**2. `prGate`'s message is unreachable for a free agent — the framing claim in the title line is wrong.**

The plan's subtitle says the fallthrough is *"telling an operator to push a branch that does not exist."* Trace the only path:

- A free agent is defined by `isAgentFree` (`free.ts:65-67`) as `state === 'running'` **and** no branch. *Alive* is half the definition.
- `supervision.ts:273`: `if (readings.workerAlive) return at('leave', 'worker-alive', [], …);` — returns **before** `gateFailures` at line 284.
- All three live free agents measured above are `ALIVE`.

So for the population this plan is about, `prGate` never runs and no operator ever sees that message. The plan half-concedes it — *"a gate message that would name an empty branch **if it ever reached a person**"* (line 56) — but then leads with the message in its opening sentence and spends its longest Design section ("The fallthrough is why a word must be added rather than borrowed") on two messages nobody receives. **The real cost is one wrong value fed to a rule that discards it, and one needless failed subprocess per free agent per tick.** That is a smaller, truer defect than the one advertised.

**3. "Exhaustiveness names the work" is the section that should not survive review.**

Four consumers are named. Two (`reapable.ts:51`, `gates.ts:20`) are `interface` **field declarations** — they cannot "decide" anything; widening a field's type is always assignment-compatible. Two (`supervisor.ts:56/:278`) are **port signatures**, same. `registryd-main.ts:342` is the one site that *produces* a `MergeReading`, and it is the only place real work happens — and the plan lists it as `:20`, its import line, rather than `:342`, its `prMerged` implementation. **Not one of the four listed sites is a site the compiler would flag, and the one site that must change is cited at the wrong line.**

**4. "The supervision rule's per-tick reading for a free agent stops being `unreachable`" cannot be asserted where the plan implies.**

`supervise` has no branch-empty arm (the plan says so at line 82: *"that is where the word is returned"*). But `supervise` **receives** readings; it does not take them. The value is produced in `registryd-main.ts:342` and in `readAgent` (`supervisor.ts:186`). Returning `not-asked` "in `supervise`" is not possible — by the time `supervise` runs, `merge` is already a field on `DeskReadings`. The plan names the wrong layer for its own change.

## What it must say before someone builds it

1. **Delete the claim that the compiler names the work, and replace it with the measurement.** State: `tsc --noEmit` on both packages reports **0 errors** after adding `'not-asked'`; there is no `switch` over `MergeReading` anywhere in the estate; every read is `===`/`!==`. The change is a **search**, not a contained compiler-driven edit. Whatever else changes, this sentence must go — an implementer trusting it will ship a no-op green.

2. **Either add the exhaustiveness site, or drop the word "exhaustiveness".** If the design intent is that the compiler enforces future decisions, the slice must convert the equality chains into a discriminated `switch` with a `never`-typed default (at minimum `prGate`, and `reapable.ts:113`/`:235` deliberately left as `!== 'merged'` with a comment saying why). That is real, reviewable work and should be named as such. If it is not in scope, say the additions are enforced by **tests only** and name them.

3. **Name the one production site: `registryd-main.ts:342`, not `:20`.** That is where `prMerged` maps the port answer, and it is where a `branch === ''` guard returning `'not-asked'` belongs — *before* `merges.ask(branch)`, which also removes the failed subprocess. Also fix `supervisor.ts:186`, or state that routing through `prMerged` covers it.

4. **Restate the cost honestly and drop the operator-message framing from the summary.** Measured: `prGate` is unreachable for a free agent because `supervision.ts:273` short-circuits on `workerAlive`, and a free agent is alive by definition (`free.ts:65`). Verified against three live agents. Keep the `prGate` arm — it is correct defensive work and cheap — but as a **guard against a future caller**, not as a fix for a message a person sees today. The honest cost is: a spurious `unreachable` per free agent per tick (3 of 4 agents right now), plus one failed `plot-host.sh` invocation each.

5. **Add the one assertion that would have caught this.** A test that feeds `merge: 'not-asked'` to `prGate` and asserts the message differs from the `not-merged` one. Without it, "Done when" items 1-3 all pass on a change that does nothing. Item 3 as written ("with the exhaustiveness error resolved rather than defaulted") must be rewritten — there is no such error, and the sentence's warning about a `default:` arm guards against a failure mode that cannot occur.

6. **Correct the `'unreachable'` premise's detail while keeping its conclusion.** `plot-host.sh pr-merged ""` exits **1** (`${1:?…}`), not the documented 3. The mapping to `unreachable` is via `record()`'s refusal path, not via the `code === 3` contract branch. The plan's conclusion is right; its implied mechanism is not, and a reader chasing exit 3 will not find it. Worth noting separately: the script's own header promises exit 3 for a failed call and exit 0 for `unknown` — an empty branch fits neither, which is arguably where the real fix belongs.

## What executing revealed that reading would not

**Reading this plan is persuasive; running it is not.** Every quote is accurate, every file:line but one resolves, and the argument from `unreachable`'s own docstring ("`not-asked` is the third member of that family") is genuinely good type design in the abstract. I expected to find a miscount — four consumers versus five or three. What I found by running `tsc` is that the count is **zero**, which no amount of reading the four cited sites would surface, because each of them *is* a real `MergeReading` reference. They are just all references the compiler has nothing to say about.

Two things only execution gave me:

- **`git grep switch` over the consumers returning nothing** turned "the compiler won't complain" from a suspicion into the mechanism. The type is never discriminated, so its cardinality is invisible.
- **`ps -p` on the three live free-agent pids.** Reading `supervision.ts:273` tells you a live worker short-circuits; reading `free.ts:65` tells you a free agent is running. Connecting them into *"therefore `prGate` is unreachable for exactly the population this plan is about"* needed the registry on disk and three ALIVE answers. The plan's own hedge at line 56 shows its author sensed this and did not measure it.

The plan is worth building. Its symptom is real, its vocabulary argument is sound, and the agent that raised it was right to stop rather than guess. But as written, **the slice that implements it literally — "Add `not-asked` to `MergeReading`" — compiles clean, passes 2767 tests, and changes no behaviour whatsoever.** Amend, do not reject.
