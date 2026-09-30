# A question nobody asked has its own word

> `MergeReading` says *merged*, *not-merged* and *unreachable*. A free agent holds no slice, so *did a PR for this branch merge* has no answer — and `prGate`'s fallthrough prints ``No merged PR for `` ``, telling an operator to push a branch that does not exist.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1073
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 4

## Changelog

- A free agent's merge reading says *not asked* instead of borrowing a word that blames a branch or a connector.

Board impact: none. The word reaches a gate message and the supervision rule, not the payload.

## Motivation

**Raised by the agent implementing #1059, which stopped rather than guessing.** Its brief said *"if no word expresses 'not asked', report that and stop. Do not invent a value."* It wrote a `PLOT-BLOCKED` marker naming three options, and the memo it had shipped was accepted without the guard (option 1, PR #1070, merged `ab37f5ef`). **This is the follow-up that decision created.**

`packages/domain/src/rules/reapable.ts:13`:

```ts
export type MergeReading = 'merged' | 'not-merged' | 'unreachable';
```

### The fallthrough is why a word must be added rather than borrowed

`rules/gates.ts:104-110` has three arms and the last is a `return`, not a branch:

```ts
if (readings.merge === 'merged') return null;
if (readings.merge === 'unreachable') return `The git host could not be asked …`;
return `No merged PR for \`${readings.branch}\`. … Push the branch and open a PR …`;
```

So for `branch === ''`:

- **`'not-merged'`** prints ``No merged PR for `` `` and tells a person to push a branch that does not exist.
- **`'unreachable'`** says the host *"could not be asked"* and sends them to check authentication, blaming a connector for a question nobody posed.

**Both state something false about the estate.** A fallthrough cannot be narrowed by picking a better existing word.

### The concept is already in the domain

`rules/acting.ts:117` and `rules/free.ts:66` both test `branch === ''`. **What is missing is not the idea — it is a word in this type**, so `prGate` and `supervise` cannot express what those two already know.

### What it costs today, corrected

**No quota.** A free agent's `supervisor.merge('')` reaches `plot-host.sh`, which refuses it locally, and #1070's per-tick memo makes that one local refusal per tick however many free agents run.

**`prGate`'s message is NOT reached for this population, and the plan first claimed it was.** `isAgentFree` (`free.ts:65-67`) requires `state === 'running'` — *alive* is half the definition — and `supervision.ts:274` returns `leave/worker-alive` **before** `gateFailures` runs. Measured: three live free agents, all alive, none reaching the gate. So no operator sees that message today.

**What it actually costs is a wrong value fed to a rule that discards it, plus one needless failed subprocess per free agent per tick.** That is smaller and truer than the message this plan was first written around, and it is still worth fixing — a reading that says *unreachable* about a question nobody asked is a lie the next consumer may not discard.

**Three sibling messages already name an empty branch every tick**, on the same pass: no changeset for ``, no plan naming `` in its Branches, no declaration written for ``. **This plan fixes the merge one only, and does not pretend to fix the others.** They are the same shape and belong in their own finding.

## Design

### The rule

**A reading that was never taken says so.**

```ts
// packages/domain/src/rules/gates.ts
export type DeskMergeReading = MergeReading | 'not-asked';
```

`DeskReadings.merge` (`gates.ts:20`) takes `DeskMergeReading`, and `prGate` gets an arm above its fallthrough, saying there is no branch to ask about and that this is **not** a report that no PR merged. `MergeReading` at `reapable.ts:13` keeps its three words.

### The wider type lives beside its only reader

The fourth word belongs to the desk reading, not to the reap rules. `supervisor.ts:18` and `registryd-main.ts:22` import `MergeReading` from `@plot-pm/domain/rules/reapable` today, and both switch to `DeskMergeReading` from `@plot-pm/domain/rules/gates`: `supervisor.ts:56` (`merge`), `supervisor.ts:278` (`prMerged`) and `registryd-main.ts:398` (`prMerged`'s return type) then carry the wider type. **The compiler then refuses `not-asked` into the reap rules**: assigning a `DeskMergeReading` to a `MergeReading` fails with `TS2322: Type '"not-asked"' is not assignable to type 'MergeReading'`. So a later producer that feeds the word to `reapProblems`, `refDeletionProblems` or `finishedWith` fails to build rather than being answered silently.

### The precedent is the type's own docstring

`reapable.ts:10-12` already argues the distinction this extends:

> permission — and keeping them apart is what lets an unaskable host be triggered against a fixture rather than only inferred.

`unreachable` exists because *the question failed* and *the answer is no* are different facts. **`not-asked` is the third member of that family**: there was no question.

### The compiler names no reading site

Widening a union read only by `===` and `!==` chains leaves `tsc --noEmit` at exit 0 in both the domain and the board. No `switch`, `assertNever` or `satisfies never` reads the merge reading, so `prGate` does not fail to build when its arm is missing. **A green build is not evidence that this slice is done.** The sites below are found by tracing the producer forward, not the type outward. The compiler guards one boundary only: the one between `DeskMergeReading` and `MergeReading`, described above.

### Where a reading is minted

| site | what it mints | receives `not-asked` after this slice |
|---|---|---|
| `registryd-main.ts:398-407` (`worldForRepo`'s `prMerged`) | the supervisor's reading, from `merges.ask(branch)` | **yes, it mints it** |
| `entities/worktree.ts:136` | `evidence.hasMergedPr ? 'merged' : 'not-merged'` | no — two-valued by construction |
| `plot-reap.sh:636-659` | a shell string, passed into `reapProblems` | no — see *The reaper's detached desk* |
| `plot-release-refs.sh:212-213` | `merge=not-merged; pr_merged "$br" && merge=merged`, passed into `finishedWith` | no — the loop skips `""` at `:202` |

### Where a reading is read

The producer's word reaches one consumer: `supervisor.ts:332` passes it into `DeskReadings.merge`, `supervision.ts:284` hands the desk to `gateFailures`, and `gates.ts:104-110` (`prGate`) reads it. That is the only site this slice changes.

`reapable.ts` reads the word at three more sites, and **none of them can receive `not-asked` from any producer on the estate:**

- `reapProblems` (`:113`) — its callers are `entities/worktree.ts:126`, which is two-valued; `plot-reap.sh`, which mints its own word; and `transitions/worktree.ts:294`, inside `observeWorktreeState`, which has no production caller outside the `index.ts` re-export.
- `refDeletionProblems` (`:235`) — no production caller. Its only caller is `firstRefRefusal` (`:269`), which also has no production caller.
- `finishedWith` (`:454`) — its one production caller is `plot-release-refs.sh:281`, which passes two values.

### The reap half is out of scope

**This slice leaves `reapable.ts` unchanged, including the `MergeReading` union.** No path delivers `not-asked` to it, so a change there is code no test can reach through a producer. A change built the obvious way is also dangerous: on a clean, dead, branch-less desk, `no-merged-pr` is the only refusal `reapProblems` returns, so removing it for `not-asked` without a replacement returns `[]` and makes the desk reapable. A replacement refusal word widens `ReapRefusalSchema` (`entities/worktree.ts:30`, a `z.enum`), which is a schema change this slice does not make. A later producer that feeds `not-asked` to `reapable.ts` fails with `TS2322` (see *The wider type lives beside its only reader*). The plan that widens `MergeReading` owns the refusal, and it must refuse on `not-asked` rather than return `[]`.

### The reaper's detached desk

`plot-reap.sh:641-659` (commit `6455c0e5`, *"the reaper reaches a detached desk"*) answers `merged` for a desk with no branch whose `HEAD` equals `origin/<main>`. `plot-dispatch.sh --start` cuts a free agent's desk that way. A detached desk that carries commits falls through to `not-merged` and is kept.

**The reaper keeps `merged` there.** That answer rests on a measurement — the desk holds no commit the default branch lacks, so nothing is left to land. `not-asked` says only that no branch exists, and it says nothing about the tree. If the reaper passed `not-asked` and `reapProblems` refused on it, every free desk would be kept forever, which is the regression `6455c0e5` fixed. The rule *a reading that was never taken says so* applies to the supervisor's producer, where no measurement stands behind the word.

### The producer tests the branch before the call

`prMerged` returns `not-asked` for `branch === ''` **before** `tally.calls += 1` and before `merges.ask`. So a free agent reaches no subprocess, and a tick with only free agents adds zero to `tally.calls`, the figure the supervisor's tick line prices. The precedent is in the same package: `queue-reading.ts:226` reads `sliceHasMerged: entry.branch === '' ? false : await world.sliceHasMerged(entry.branch)`, and `supervision-report-reading.ts:109` skips a row with `branch === ''`. Testing after the call would spend a subprocess on a question with a known answer and then re-test the branch to tell the refusal from an outage.

### The shell twin is #1082

`pr_merged ""` and `pr_open ""` both exit 0. The cause is the lookup, not the rule: `_plot_merged_lookup` (`plot-pr-merged.sh:123`) and `_plot_open_lookup` (`:132`) run `gh pr list --head "$br"`, and `--head ""` applies no filter, so any PR in the repository answers `found`. The rule itself is already one implementation, `board/plot-landed.mjs`, so a corpus test is the wrong tier. The defect is latent: `plot-reap.sh:639`, `plot-reap.sh:921`, `plot-release-refs.sh:202` and `plot-quiet-stretch.sh:157` guard `""`, and `plot-dispatch.sh:3562` takes its branch from a plan's slice. **This slice does not fix it.** The fix is an empty-branch guard in both lookups plus a stubbed-`gh` contract test in `test/reconcile/host.test.mjs`, and it belongs to #1082.

### What this does NOT do

- **It does not change `reapable.ts`**: not the `MergeReading` union, not its refusals, and not `ReapRefusalSchema`.
- **It does not change `plot-reap.sh`**, which keeps `merged` for a detached desk at `origin/<main>`.
- **It does not change `plot-pr-merged.sh`.** That fix is #1082.
- **It does not add a state to the eight worker/agent states.** This is a reading's vocabulary, not an agent's.
- **It does not fix the three sibling messages** that name an empty branch (changeset, plan, declaration).
- **It does not touch the payload or a schema.** It touches `packages/domain` at `gates.ts` (the type and the arm) and `packages/board` at `supervisor.ts` (the import) and `registryd-main.ts` (the import and the guard).

## Done when

Each bullet is a test unless it says otherwise.

- **The producer answers `not-asked` for `''` and spends nothing.** In `registryd-main.test.ts`, beside *"adds one per host call, answered or not"* (`:1035`): the world's `merge('')` returns `not-asked` (the test calls `world.merge('')`, as the neighbouring test calls `world.merge('feature/a')`), the stubbed `plot-host.sh` receives no call, and `tally.calls` does not move.
- **The producer's other answers are unchanged.** In the same file: a stubbed host answering `merged`, `not-merged` and a failure still yields `merged`, `not-merged` and `unreachable`, and each adds one to `tally.calls`.
- **`prGate` names the absence of a branch.** In `gates.test.ts`: `prGate({ branch: '', merge: 'not-asked' })` returns a message that says no branch was asked about and that this is not a report that no PR merged, and it contains neither `No merged PR for` nor `could not be asked`.
- **A dead branch-less agent sees that message, with and without progress.** In `supervision.test.ts`, for a free agent that is not alive, with `merge: 'not-asked'` and clear headroom:
  - with `madeProgress: false`, the verdict is `defer` with reason `no-progress`, and the failures contain the new `prGate` message. This is the common case: a free desk cut at `origin/<main>` has no commits in `<main>..HEAD`, so `registryd-main.ts:432-434` reads no progress.
  - with `madeProgress: true`, the verdict is `correct`, and the correction prompt contains the new `prGate` message. That message states that no branch was asked about, so a prompt addressed to an empty branch is acceptable here. The other lines of that prompt that name an empty branch (the declaration, changeset and plan messages) are the three sibling messages and stay out of scope.
  - A live free agent returns `leave/worker-alive` at `supervision.ts:274` before any gate runs; the test asserts that too.
- **`prGate` is unchanged for the three existing words**, asserted per word.
- **The reap rules refuse the word at compile time.** Review criterion, not a test: a probe that assigns a `DeskMergeReading` to a `MergeReading` fails with `TS2322`, and is not committed.
- **`reapable.ts` is unchanged.** Review criterion, not a test: `git diff --quiet main -- packages/domain/src/rules/reapable.ts` exits 0.

## Slices

### A question nobody asked has its own word (Branch: bug/a-question-nobody-asked-has-its-own-word)

Declare `DeskMergeReading = MergeReading | 'not-asked'` in `gates.ts`, type `DeskReadings.merge` with it, and give `prGate` an arm above its fallthrough. Switch the `MergeReading` imports at `supervisor.ts:18` and `registryd-main.ts:22` to `DeskMergeReading`. In `registryd-main.ts:398`, return `not-asked` for `branch === ''` before `tally.calls += 1` and the host call. `reapable.ts`, `plot-reap.sh` and `plot-pr-merged.sh` stay unchanged.

## Notes

**The agent that found this did the right thing and it is worth recording why.** It had a brief with a scope guard excluding `packages/domain/**`, a question with no honest answer inside that scope, and three options. It shipped the part that was in scope, wrote down the question, and stopped — rather than picking a word that would have made a gate lie quietly.

**Its sibling is #1059**, whose memo shipped in PR #1070. This plan is the half that was deferred, not a defect in what merged.

### Round 1, 2026-09-29

Two jurors, both **amend**, both **executed**. Verdicts: `.plot/panels/2026-09-29-a-question-nobody-asked-has-its-own-word/`.

**Both independently refuted the same central claim**, by applying the type change and running the compiler: *"exhaustiveness names the work"* is false — `tsc` reports **zero** errors, so the mechanism the plan relied on to find its own work does not exist. The premise survives and the design argument did not.

Four further findings folded in above: the four cited consumers are type annotations rather than decision sites and the five real ones are now listed; the word is produced in `packages/board`, not in `supervise`; `reap`'s three refusal paths do receive the new word and answer `no-merged-pr` on it; and `prGate`'s message is unreachable for a live free agent, so the cost is smaller and differently shaped than the plan claimed.

**One finding is a defect that exists today and is not this plan's to fix:** `plot-pr-merged.sh`'s `pr_merged ""` exits 0 — *merged* — where the TS side answers `unreachable`. A declared duplicate disagreeing in the permissive direction, with no corpus test over the pair. It is filed rather than folded in.

### Round 2, 2026-09-30

One juror, **amend**, **executed**. Verdict: `round2.md` in the same directory. The compiler, `supervise` and `prGate` reachability findings held. The juror traced the producer forward and found that the three `reapable.ts` sites cannot receive `not-asked` from any producer, that the reap bullet built literally makes a branch-less desk reapable, that `plot-reap.sh` already answers `merged` for a detached desk on purpose (`6455c0e5`), that the producer citation was stale (`:342` is the #1070 memo; the producer is `:398`), and that three more sites mint a reading. The reap half is now out of scope, the producer tests the branch before the call, the shell twin is left to #1082 as a lookup defect rather than a corpus gap, and every Done-when bullet is a test except one named review criterion.

### Round 3, 2026-09-30

One juror, **amend**, **executed**. Verdict: `round3.md` in the same directory. The juror built the slice and all five Done-when tests passed, but the build contradicted the plan: `MergeReading` is declared at `reapable.ts:13`, so widening it there fails the empty-`reapable.ts`-diff criterion. The juror's proven fix is adopted. `DeskMergeReading` is declared in `gates.ts`, the two board imports switch to it, and `tsc` refuses `not-asked` into the reap rules with `TS2322`. The juror also found three more things, all now folded in. The producer test must call the world's `merge`. The `supervise` verdict depends on `madeProgress` (`defer` without progress, `correct` with it), so both cases are asserted. Two citations needed correcting: the `plot-release-refs.sh` skip is at `:202`, and the `reapProblems` caller list now includes `transitions/worktree.ts:294`.

### Round 4, 2026-09-30

One juror, **proceed**, **executed**. Verdict: `.plot/panels/2026-09-29-a-question-nobody-asked-has-its-own-word/round4.md`. The juror built the Slices line literally at `824f778c`: both typechecks exit 0, `git diff --quiet` on `reapable.ts` exits 0, the TS2322 probe fires, all 9 Done-when tests pass and each fails without its change, the domain suite passes 2772/2772 and the affected board unit files 162/162. The changeset is `'@plot-pm/board': patch`.
