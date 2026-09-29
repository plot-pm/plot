Position: amend
Evidence: executed

scope: amend

# Blast radius and undeclared cost

The premise is TRUE and I could not refute it. The design argument that makes it a "contained change" is FALSE and I refuted it by executing it.

## What I ran and what it showed

### BASELINE (unmodified `main`, 1a9c92be)

```
$ pnpm --filter @plot-pm/domain test
 Test Files  116 passed (116)
      Tests  2767 passed (2767)
   Duration  10.52s
```

```
$ cd packages/domain && npx tsc --noEmit
(no output, exit 0)
```

```
$ pnpm --filter @plot-pm/domain run test:corpus
 Test Files  1 failed | 10 passed (11)
      Tests  1 failed | 65 passed (66)
   Duration  530.33s
```
**One corpus failure pre-exists this plan.** Any builder must baseline before blaming their branch.

`pnpm test` at the repo root is **not a test suite** — it is `skills add . --list`, a skills-parser validator. It exits 0 and proves nothing about this change. A brief listing it as a repo gate for this work is listing a no-op.

### The premise: CONFIRMED, not refuted

```
$ skills/plot/scripts/plot-host.sh pr-merged ""
skills/plot/scripts/plot-host.sh: line 3342: 1: pr-merged needs a branch
exit=1
```

Exit 1 → `answer.ok === false` → `registryd-main.ts:344` returns `'unreachable'`. And `readTick` (`supervisor.ts:143-145`) loops **every** registry entry with no branch filter, so a free agent's `''` does reach `world.merge('')`. The plan's central factual claim holds under measurement.

### Executing the change: the design argument collapses

I cut a detached worktree, applied the plan's one-line type change and nothing else:

```ts
export type MergeReading = 'merged' | 'not-merged' | 'unreachable' | 'not-asked';
```

```
$ cd packages/domain && npx tsc --noEmit
TSC_EXIT=0        # ZERO errors
```

```
$ pnpm --filter @plot-pm/domain test
 Test Files  3 failed | 113 passed (116)
      Tests  4 failed | 2728 passed | 35 skipped (2767)
```

All 4 failures are in `test/ports-real-state.test.ts` and `test/host-shell.test.ts`, and they fail identically on unmodified `main`:

```
$ # on main, no change applied
$ pnpm --filter @plot-pm/domain exec vitest run test/ports-real-state.test.ts test/host-shell.test.ts
 Test Files  1 failed | 1 passed (2)
      Tests  2 failed | 87 passed (89)
```
They hit the live host and time out at 5003ms / 6584ms / 5041ms. **Pre-existing, load-dependent, unrelated.**

### The free agent's actual supervision output, executed

I ran `prGate`, `supervise` and `reapProblems` against a free agent's readings directly:

```
PRGATE unreachable: "The git host could not be asked whether a PR for `` merged. …"
PRGATE not-merged : "No merged PR for ``. … Push the branch and open a PR …"

SUPERVISE merge=unreachable verdict=defer cause=no-progress nFailures=4
   FAILURE: The git host could not be asked whether a PR for `` merged. …
   FAILURE: No changeset was added for ``. Add one file under `.changeset/` …
   FAILURE: No plan names `` in its `## Branches` section. …
   FAILURE: No declaration was written for ``. …
   CORRECTION: ""

SUPERVISE merge=not-merged verdict=defer cause=no-progress nFailures=4
   (same four, merge failure reworded)

REAP merge=merged      refusals=[]
REAP merge=unreachable refusals=["no-merged-pr"]
REAP merge=not-merged  refusals=["no-merged-pr"]
```

### The shell twin

```
$ . skills/plot/scripts/plot-pr-merged.sh; pr_merged ""; echo $?
pr_merged_empty_exit=0
```

Exit 0 in `pr_merged` means **merged**.

## What a measurement contradicts

1. **"Exhaustiveness names the work. The compiler will name every site that must decide, which is why this is a contained change rather than a search." — FALSE, and it is the plan's load-bearing design argument.** I applied the type change and ran `tsc --noEmit`: **exit 0, zero errors**. There is no exhaustiveness machinery anywhere over `MergeReading` — `grep` for `switch`, `assertNever` and `satisfies never` across `gates.ts`, `reapable.ts`, `supervisor.ts` and `registryd-main.ts` returns **nothing**. Every consumer is a `===` chain with a fallthrough `return`, which is precisely the shape the plan's own Motivation section identifies as the defect. **The compiler names nothing. A builder following this plan gets a green build, a green suite, and a word that changes no behaviour anywhere.** The plan's "Done when" bullet — *"Every consumer decides the new word deliberately, with the exhaustiveness error resolved rather than defaulted"* — is unsatisfiable as written: there is no exhaustiveness error to resolve.

2. **"Four consumers — `reapable.ts:51`, `gates.ts:20`, `supervisor.ts:56` and `:278`, `registryd-main.ts:20`" — these are not consumers, and one line reference is wrong.** Reading each line:
   - `reapable.ts:51` → `merge: MergeReading;` (a field declaration)
   - `gates.ts:20` → `merge: MergeReading;` (a field declaration)
   - `supervisor.ts:56` → `merge(branch: string): Promise<MergeReading>;` (an interface method signature)
   - `supervisor.ts:278` → `prMerged(branch: string): Promise<MergeReading>;` (an interface method signature)
   - `registryd-main.ts:20` → `import type { PortResult } from '@plot-pm/domain';` — **the wrong line entirely.** `MergeReading` is imported at `:22`, and the only site that *produces* a word is `:342-350`.

   **Not one of the five is a decision site.** Four are type annotations that accept a wider union silently. The actual decision sites the plan does not name are `gates.ts:104-110` (`prGate`), `reapable.ts:113` (`reapProblems`), `reapable.ts:235` (`refDeletionProblems`), `reapable.ts:454` (`finishedWith`), and `registryd-main.ts:342-350` (the producer). **Five real sites, and the plan names one of them.**

3. **"It does not change `reap`'s refusals" — the plan cannot know this, because every one of `reap`'s merge tests is `!== 'merged'`.** Executed:
   ```
   REAP merge=unreachable refusals=["no-merged-pr"]
   REAP merge=not-merged  refusals=["no-merged-pr"]
   ```
   `reapable.ts:113`, `:235` and `:454` all read `readings.merge !== 'merged'`. **A fourth word reaches all three refusal paths and silently produces `no-merged-pr`** — a refusal saying *no merged PR* about a branch nobody asked about, which is the exact category of lie the plan exists to remove, reproduced one layer down. The claim is technically true only in the sense that the *behaviour* is unchanged; it is false as a statement that these paths are untouched. `finishedWith`'s own docstring at `:446-450` even argues the two-valued collapse explicitly — *"it stays two-valued because the caller's answer is the same either way"* — and that argument is exactly what a fourth word invalidates. **The plan says these are untouched. Their comments say they deliberately collapse, and the plan gives them a case their reasoning never considered.**

4. **"It does not touch the payload or the board" — TRUE, and this is the one claim that holds.** `grep` over `packages/board/src/contract/schema.ts` and `packages/board/src/server/fleet.ts` for `MergeReading`, `'unreachable'` and `not-merged` returns **zero hits**. No Zod schema carries it and no `/api/*` response serializes it. Confirmed.

5. **"It does not add a state to the eight worker/agent states" — TRUE.** `AgentStateSchema` (`entities/agent.ts:15-24`) is a separate `z.enum` of eight and shares no code path with `MergeReading`. Confirmed.

6. **"It does not stop the call" — TRUE.** `readTick` has no branch filter; `world.merge('')` is still reached. Confirmed.

7. **"`supervise` (`rules/supervision.ts`) has no branch-empty arm today; that is where the word is returned." — FALSE on the second half, and it misdescribes the function.** `grep -n "merge" packages/domain/src/rules/supervision.ts` returns **nothing**. `supervise` never sees a `MergeReading`; it receives `desk: DeskReadings` and hands it to `gateFailures`. It returns a `Supervision`, not a `MergeReading` — **it cannot return the word.** The word is produced at `registryd-main.ts:342-350`, in the board package, which the plan's "does NOT touch the board" bullet implicitly disclaims. The one place that must change is the one place the plan says it is not going.

8. **An undeclared shell/TS drift, in the dangerous direction.** `plot-pr-merged.sh` is a declared duplicate of this rule area (`CLAUDE.md`, *A Shell Script Asks The Domain*). Measured: `pr_merged ""` **exits 0, which means merged**. So today, for a free agent, TS says `unreachable` (refuse) and the shell twin says `merged` (permit) — **the two halves of a declared duplicate already disagree, in the direction that permits**. Adding `not-asked` to one side widens that gap. `grep` over `packages/domain/corpus/` for `prMerged`, `pr_merged` and `MergeReading` returns **zero** — no corpus test covers this pair at all, so nothing would catch the drift. The plan's cost section says the cost is "no quota"; the undeclared cost is a duplicate pair with no comparison and an existing disagreement.

9. **The test count the plan does not give.** 57 occurrences of `merge: 'merged'|'not-merged'|'unreachable'` across 7 files (`workflows-supervise.test.ts`, `supervision.test.ts`, `transitions-worktree.test.ts`, `gates.test.ts`, `resume.test.ts`, `reapable.test.ts`, `desk-reset.corpus.test.ts`), and 70 `toBe('merged'|'not-merged'|'unreachable')` assertions. Executing the change broke **none** of them — which is the finding, not a reassurance: it confirms nothing in the suite discriminates on the word's arity. The plan names no tests because none would fail, and it does not say so.

10. **The free agent produces FOUR bogus failures per tick, not one.** Executed above. Besides the merge one, a free agent gets: *"No changeset was added for ``"*, *"No plan names `` in its `## Branches` section"*, and *"No declaration was written for ``"*. The plan's Motivation says the cost is "a spurious `'unreachable'` fed into the supervision rule every tick, and a gate message that would name an empty branch if it ever reached a person." **Three other gate messages already name an empty branch, every tick, on the same reading pass.** Fixing one of four leaves the free-agent supervision output 75% as wrong as it is today, and the plan does not mention the other three exist.

## What it must say before someone builds it

1. **Delete the "Exhaustiveness names the work" section and replace it with the truth: nothing in this codebase is exhaustive over `MergeReading`.** State that `tsc --noEmit` exits 0 with the word added and no consumer touched — measured 2026-09-29 — so the type change alone is inert. Name the five real decision sites explicitly, with correct lines: `gates.ts:104-110`, `reapable.ts:113`, `reapable.ts:235`, `reapable.ts:454`, `registryd-main.ts:342-350`. Fix `registryd-main.ts:20` → `:22` (import) and `:342` (producer).

2. **Rewrite the "Done when" bullet that says *"with the exhaustiveness error resolved rather than defaulted"*.** There is no exhaustiveness error. If the plan wants the compiler to name the sites, it must say so as WORK — add an `assertNever` / `satisfies never` discriminant to each of the five decision sites as part of this change — and own that as the actual scope. Otherwise the bullet is a gate nobody can pass or fail.

3. **Replace "It does not change `reap`'s refusals" with what was measured.** State that `reapable.ts:113`, `:235` and `:454` each test `!== 'merged'`, so `not-asked` falls into `no-merged-pr` at all three, and DECIDE whether that is correct. If it is correct, say why a free agent's desk should carry a refusal that reads *no merged PR*. If it is not, name the fix. Either way, `finishedWith`'s docstring at `:446-450` argues the two-valued collapse on grounds the fourth word breaks, and that comment must be amended in the same change or it becomes a false comment.

4. **Say that the word is produced in `packages/board`, and reconcile that with "It does not touch the payload or the board".** The producer is `registryd-main.ts:342-350`. Split the bullet: *does not touch the board's PAYLOAD or its schema* (true, measured — zero hits in `schema.ts` and `fleet.ts`) versus *does change `packages/board/src/server/entry/registryd-main.ts`* (required, and currently disclaimed).

5. **Correct the sentence "`supervise` … has no branch-empty arm today; that is where the word is returned."** `supervision.ts` contains no `merge` at all and `supervise` returns a `Supervision`. Name the real return site.

6. **Declare the shell twin and the drift it already has.** `pr_merged ""` exits 0 = merged, against TS's `unreachable`. State this measurement, state that `packages/domain/corpus/` has no test comparing this pair, and decide: either add the corpus test as part of this change, or state explicitly that the pair stays undeclared and why the disagreement is safe. Per `CLAUDE.md`, *"Duplication is allowed and undeclared duplication is not."*

7. **Name the other three free-agent gate failures, and scope them in or out with a reason.** Paste the four-failure output. If the plan fixes only the merge one, say that a free agent still produces three false gate messages per tick and that this plan deliberately leaves them — otherwise the next reader will believe the free-agent supervision output is correct after this ships.

8. **State the baselines a builder must take before blaming their branch:** domain 116 files / 2767 tests / ~10s green; corpus 10/11 with **one pre-existing failure**; `test/ports-real-state.test.ts` and `test/host-shell.test.ts` fail against the live host under load on `main`. And say that root `pnpm test` is `skills add . --list` and gates nothing here.

## What executing revealed that reading would not

Reading the plan, the design section is its most convincing part: *"The compiler will name every site that must decide, which is why this is a contained change rather than a search."* That sentence is what makes the change feel safe and bounded, and it is the reason a reviewer would not go looking further.

**It survives reading and dies on one command.** Applying the one-line type change and running `tsc --noEmit` gives exit 0 — no errors, nothing named, nothing to resolve. You cannot get there by reading `reapable.ts:13`, because the absence of an `assertNever` anywhere in four files is not a thing a reader notices; it is a thing a compiler reports by staying silent. This is the estate's named failure mode reproduced exactly: a measured symptom (the `'unreachable'` fallthrough, which I confirmed is real) paired with an inferred mechanism (compiler-driven containment, which does not exist).

The second thing only execution gives is the **shape** of the defect. The plan describes one spurious reading. Running `supervise` against a free agent's readings prints four failures, and three of them — changeset, plan annotation, declaration — name the same empty branch on the same tick through the same pass. A reader sees a one-word bug; an executor sees that the merge word is one quarter of a free agent being fed through gates written for a desk that did work.

Third: the shell twin. `pr_merged ""` exiting 0 means the declared duplicate answers **merged** where TypeScript answers **unreachable** — a disagreement that already exists, in the permitting direction, with no corpus test over the pair. Reading `plot-pr-merged.sh` gives you 80 lines of careful prose about why `mergedAt` is read and `state` is not; it does not tell you what the function does when handed `""`. One `bash -c` does.

None of this makes the underlying bug unreal. `plot-host.sh pr-merged ""` exits 1, the fallthrough is genuine, and the two messages the plan quotes are both false about the estate. **Amend, not reject** — the problem is worth fixing and the word is the right fix. What must not ship is a plan that tells its builder the compiler will guide them, because the compiler will say nothing at all, and the suite will stay green around a word that does nothing.
