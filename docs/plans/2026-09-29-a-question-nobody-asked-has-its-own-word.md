# A question nobody asked has its own word

> `MergeReading` says *merged*, *not-merged* and *unreachable*. A free agent holds no slice, so *did a PR for this branch merge* has no answer — and `prGate`'s fallthrough prints ``No merged PR for `` ``, telling an operator to push a branch that does not exist.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1073
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

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
export type MergeReading = 'merged' | 'not-merged' | 'unreachable' | 'not-asked';
```

with an arm in `prGate` above the fallthrough, saying there is no branch to ask about and that this is **not** a report that no PR merged.

### The precedent is the type's own docstring

`reapable.ts:10-12` already argues the distinction this extends:

> permission — and keeping them apart is what lets an unaskable host be triggered against a fixture rather than only inferred.

`unreachable` exists because *the question failed* and *the answer is no* are different facts. **`not-asked` is the third member of that family**: there was no question.

### The compiler names NOTHING, and that is why this needs a list

**Round 1 measured the plan's original claim and refuted it.** It read *"the compiler will name every site that must decide, which is why this is a contained change rather than a search."* Two jurors applied the type change and ran `tsc --noEmit`: **exit 0, zero errors**, in both the domain and the board.

There is no exhaustiveness machinery over `MergeReading` anywhere — no `switch`, no `assertNever`, no `satisfies never`. Every consumer is an `===` chain ending in a fallthrough `return`, which is the very shape this plan calls the defect. **A builder trusting the compiler gets a green build, a green suite, and a word that changes no behaviour.**

**The four "consumers" the plan first listed were not decision sites.** `reapable.ts:51` and `gates.ts:20` are field declarations; `supervisor.ts:56` and `:278` are interface method signatures. All four accept a wider union silently. The fifth citation, `registryd-main.ts:20`, was an unrelated import line.

**The five REAL sites, each of which must be changed by hand:**

| site | what it does today with a fourth word |
|---|---|
| `registryd-main.ts:342-350` | **the producer** — the only place a `MergeReading` is minted, and where `not-asked` is returned |
| `gates.ts:104-110` (`prGate`) | falls through to ``No merged PR for `` `` |
| `reapable.ts:113` (`reapProblems`) | `merge !== 'merged'` → refuses with `no-merged-pr` |
| `reapable.ts:235` (`refDeletionProblems`) | same test, same refusal |
| `reapable.ts:454` (`finishedWith`) | same test; its docstring at `:446-450` argues the two-valued collapse explicitly, and a fourth word invalidates that argument |

**A `default:` arm at any of them reintroduces the fallthrough this plan exists to remove.**

### The word is produced in the BOARD, not in `supervise`

The plan first said `supervise` is *"where the word is returned"*. Measured: `grep -n merge packages/domain/src/rules/supervision.ts` returns **nothing**. `supervise` receives a `DeskReadings` whose `merge` field is already set, and returns a `Supervision` — it cannot return a `MergeReading`.

The producer is `registryd-main.ts:342-350`, in `packages/board`. **So this plan touches the board package**, and the earlier "does not touch the board" bullet was wrong about where the change lands. It touches no payload and no schema, which is the claim that survives.

### What this does NOT do

- **It does not stop the call.** Whether a free agent should reach `plot-host.sh` at all is a separate question — the memo already made it one local refusal per tick, and cheap.
- **It does not change `reap`'s refusals.** A free agent's desk is not reaped on this reading, and `reapable.ts`'s five conditions are untouched.
- **It does not add a state to the eight worker/agent states.** This is a reading's vocabulary, not an agent's.
- **It does not touch the payload or the board.**

## Done when

- **A free agent's merge reading is `not-asked`**, asserted at the producer (`registryd-main.ts:342-350`) — not `unreachable`, which is what the rule receives today.
- **All five decision sites are changed by hand and each is named in the diff.** The compiler flags none of them: measured `tsc --noEmit` exit 0 with the word added and nothing else. **A green build is not evidence this is done**, and that inverts the usual reading of a green build — so the slice states, per site, what it decided.
- **`reapProblems`, `refDeletionProblems` and `finishedWith` do not answer `no-merged-pr` on `not-asked`.** Measured today: all three reach that refusal for any non-`merged` word, so a fourth word would make them say *no merged PR* about a branch nobody asked about — the same lie one layer down. `finishedWith`'s docstring is updated, because its stated reason for collapsing to two values no longer holds.
- **`prGate` names the absence of a branch** and says it is not a report that no PR merged. **This message is unreachable for a live free agent** (`supervision.ts:274` returns first) and is fixed anyway, because the gate is reachable for a non-alive agent holding no branch and the message would be wrong there.
- **`merged`, `not-merged` and `unreachable` behave unchanged**, asserted. 57 fixtures and 70 assertions use the three words across 7 files; measured, the type change breaks none of them. **That is a finding, not a reassurance** — nothing in the suite discriminates on the word's arity, so each new case needs its own assertion.
- **The shell twin's disagreement is declared or closed.** Measured 2026-09-29: `pr_merged ""` **exits 0, meaning merged**, while the TS side answers `unreachable` and refuses. The two halves of a declared duplicate already disagree, in the permissive direction, and `packages/domain/corpus/` contains no test over this pair. Either add the corpus test or state in the slice why this pair stays uncompared. **Adding the word without doing one of those widens an undeclared gap.**

## Slices

### A question nobody asked has its own word (Branch: bug/a-question-nobody-asked-has-its-own-word)

Add `not-asked` to `MergeReading`, return it for a branch-less agent, and give `prGate` an arm above its fallthrough.

## Notes

**The agent that found this did the right thing and it is worth recording why.** It had a brief with a scope guard excluding `packages/domain/**`, a question with no honest answer inside that scope, and three options. It shipped the part that was in scope, wrote down the question, and stopped — rather than picking a word that would have made a gate lie quietly.

**Its sibling is #1059**, whose memo shipped in PR #1070. This plan is the half that was deferred, not a defect in what merged.

### Round 1, 2026-09-29

Two jurors, both **amend**, both **executed**. Verdicts: `.plot/panels/2026-09-29-a-question-nobody-asked-has-its-own-word/`.

**Both independently refuted the same central claim**, by applying the type change and running the compiler: *"exhaustiveness names the work"* is false — `tsc` reports **zero** errors, so the mechanism the plan relied on to find its own work does not exist. The premise survives and the design argument did not.

Four further findings folded in above: the four cited consumers are type annotations rather than decision sites and the five real ones are now listed; the word is produced in `packages/board`, not in `supervise`; `reap`'s three refusal paths do receive the new word and answer `no-merged-pr` on it; and `prGate`'s message is unreachable for a live free agent, so the cost is smaller and differently shaped than the plan claimed.

**One finding is a defect that exists today and is not this plan's to fix:** `plot-pr-merged.sh`'s `pr_merged ""` exits 0 — *merged* — where the TS side answers `unreachable`. A declared duplicate disagreeing in the permissive direction, with no corpus test over the pair. It is filed rather than folded in.
