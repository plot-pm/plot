# Premise lens — a-plan-states-what-its-slices-cost

Subject: `docs/plans/2026-09-15-a-plan-states-what-its-slices-cost.md` (Draft)
Lens: **premise** — does what the plan says exists actually exist, and is what it says is missing actually missing.
Everything below was read on `origin/main` at `e98cba7cd`, fetched at the start of this review.

## 1. Every existence claim verified — the plan's positive premises hold

Unlike the six false-premise plans this week, **this plan's citations reproduce**. I checked each by reading the code rather than the plan's description of it.

| The plan's claim | Verified | Where |
|---|---|---|
| `recordSliceSpend` exists | **TRUE** | `packages/domain/src/workflows/slice-spend.ts:63` |
| `readSliceSpend` exists | **TRUE** | `packages/domain/src/workflows/slice-spend.ts:102` |
| `SpendReadState` is three-way | **TRUE, exact** | `packages/domain/src/rules/slice-spend-record.ts:19` — `export type SpendReadState = 'measured' \| 'absent' \| 'unreadable';` byte-for-byte as quoted |
| `plot-slice-spend.mjs` bundle exists | **TRUE** | `skills/plot/scripts/board/plot-slice-spend.mjs` |
| write site in `plot-worker-loop.sh` | **TRUE** | `record_slice_spend()` defined `:1079`, called `:2148`, immediately after `seal_declaration` |
| four token counters + models | **TRUE** | `spendSummary` renders `in/out/cache-write/cache-read`, `slice-spend-record.ts:100-105` |
| `readSliceSpend` answers for one branch | **TRUE** | signature takes `branch: string`, `:102-108` |
| plan names branches in `## Slices`, meta reports `waves[].branches[]` | **TRUE, executed** | I ran `plot-plan-meta.sh` on this very plan: `branches: ["feature/a-plan-states-what-its-slices-cost"]`, `waves[0].branches[0].branch` populated. `plot-plan-meta.sh:58` documents `## Slices` as a first-class spelling |

**The negative premise also holds.** `git grep -nEi 'planSpend|spendForPlan|spendForSlices|rollupSpend|planCost' origin/main -- packages/ skills/` returns **zero hits**. No per-plan sum exists in `packages/domain/src`, `packages/board/src`, or the skills tree. The plan is right that nothing sums them.

**The `DeclarationReading` quote.** The sentence *"cannot answer is not no"* is real repo vocabulary and the parallel is fair. The nearest verified instance is `slice-spend-record.ts:14-17`, which keeps `absent` and `unreadable` apart *"for the reason `plot-worker-state.sh` keeps them apart: a failed call and an empty result are different answers."* I did not locate the `DeclarationReading` docstring's exact *"twice shipped a collapse"* wording, so **I could not verify that specific quotation** — flagged as unverified, not as false.

**Could not verify — one claim, and it is load-bearing for a `Done when` gate.** The plan says `readSliceSpend` is documented as opening no transcript *"with 'a test pins that this path opens no transcript'"*. The **docstring says exactly that** (`slice-spend.ts:89-92`). But I searched all three test files for the test it promises and **found no such test**. `slice-spend-refusals.test.ts:94-115` exercises `readSliceSpend` through a stub whose `sessions` is never asserted un-called; `slice-spend-file.test.ts` reads back after a write. **The docstring asserts a gate that does not exist.** The plan then inherits that non-existent gate — see §4.

## 2. What the spend slice actually shipped (PR #918, merged `a4b5a71e9`)

A rollup can build on this, and the shape is better than the panel feared:

- **On-disk shape**: one JSONL line per run, appended. `{branch, at, tokens:{inputTokens,outputTokens,cacheCreationTokens,cacheReadTokens}, turns, models[]}`.
- **Where it lives**: `<git-common-dir>/.plot/state/slice-spend.jsonl` — **one file per repository, all branches together**. `slice-spend-file.ts:27` (`const FILE`), path resolved at `:98-104`.
- **The locality path bug was FIXED before merge.** `slice-spend-file.ts:64-77` uses `git rev-parse --git-common-dir`, not `--show-toplevel`, and its docstring cites the exact measurement `locality` made. `slice-spend-file.test.ts:121-142` (*"survives the desk being removed"*) does `git worktree remove --force` and still reads `measured`. **Credit where due: the panel's reap finding was acted on.**
- **What `readSliceSpend` returns**: `SpendRead { state, latest, history[], unreadable }` — newest record, full history, and a count of torn lines.

## 3. The three-way state does NOT answer the objection — it renames it

**This is my central finding, and it is a premise error of exactly this week's class: a claim read off a neighbouring definition.**

`SpendReadState` is per-branch and it distinguishes *this machine's record has a line for branch X* from *it does not*. The panel's objection is about **what the absence means**, and the record cannot express that. `r2-locality.md:123-127` names three absence causes:

- ran on another machine
- desk was reaped
- worker SIGKILLed

**All three land in the same bucket: `absent`.** `readSpend` (`slice-spend-record.ts:74-79`) sets `state: history.length === 0 ? 'absent' : 'measured'` — a pure length test over lines matching the branch. There is no cause field, and none could be derived from a file that by construction holds nothing about the run.

So the plan's core sentence — *"a reader who sees '3 of 5 slices measured' can act"* — **overstates what the reader is given**. The reader is told two of five are absent and is told nothing about whether that means *cheap*, *elsewhere*, or *the most expensive run on the estate*. Reporting a count alongside a partial sum makes the sum **legible**, not **sound**. Those differ, and the plan treats them as the same thing at `:40` (*"That objection stands, and the shipped vocabulary answers it"*).

**The strongest evidence is a fact the plan never mentions.** The delivered docstring the plan cites approvingly for other purposes states the bias directly (`slice-spend.ts:50-57`):

> *"THE BOUND PATH RECORDS NOTHING… a worker that burned the full bound is the most expensive run there is. **A rollup over these records is therefore biased LOW in a direction nobody can see from the records alone**, and a reader must be told so."*

**That paragraph is addressed to this plan.** It is the shipped code instructing its rollup to disclose a systematic low bias. `grep -in 'bound\|SIGKILL\|other machine\|biased'` over the plan returns **one hit** — line 37, quoting the panel — and nothing in `## Design`, nothing in `Done when`, nothing in the changelog. **The plan read the file it cites and did not carry forward the one instruction that file gives its successor.** The absences are not merely uncounted; they are correlated with cost, and the correlation runs in the direction that flatters the number.

**The second unaddressed round-1 item.** `STORY-plot-plan-economics.md:30` quotes the estate rule *"cost is derived, never stored"* — invoked there to exclude currency, for the reason that a stored number can be silently wrong. `locality` asked round 1 and round 2 for the plan to overturn it in its own voice. This plan is the one that **stores a per-plan derivation over stored records** and mentions the rule zero times. It inherits the omission rather than closing it.

## 4. What `Done when` fails to pin

The gates are unusually well-drafted — key-set assertions rather than prose, a named fixture per property. Four gaps, the first decisive:

1. **Nothing pins disclosure of the bound-path bias.** An implementation reporting `measured: 3, absent: 2, unreadable: 0` with four summed counters passes **every stated gate** while presenting a number the shipped docstring says is biased low by an unknowable amount. This is the *"honesty gate passing while reporting the opposite of the truth"* shape `panel-r2.md` identified — the same failure, one level up.

2. **"No transcript is opened" is pinned to a test that does not exist.** The gate says *"pinned by the same kind of test `readSliceSpend` already carries"*. `readSliceSpend` carries no such test (§1). An implementer following this gate literally copies nothing, and the gate self-certifies.

3. **Absent is not decomposed and no gate asks it to be.** The mixed-state fixture holds "one of each" of `absent`/`unreadable` — which pins the `DeclarationReading` distinction the plan cares about and **not** the distinction the objection is about.

4. **A re-dispatched branch's `history[]` is unhandled.** `SpendRead` deliberately returns `latest` *and* `history` because a corrected branch writes several records (`slice-spend-record.ts:31-36`). A plan's sum must choose. No gate names `latest`, so summing `history` — double-counting every re-dispatched slice — passes every listed gate.

**A concrete wrong-but-green implementation:** sum `history` across all matching lines, report the three counts, open no transcript, ignore unlisted branches, answer *no total* at zero measured. Every gate green. It double-counts corrections and silently omits every bound-killed run.

## 5. The strongest argument against doing this at all

**Zero records exist on this estate, so nothing here has ever been measured end to end.** Verified directly:

```
git rev-parse --git-common-dir      → .git
ls .git/.plot/state/slice-spend.jsonl → No such file or directory
find … -name 'slice-spend.jsonl'      → (nothing)
```

The write site landed today (`5320215e4`, 2026-09-15) and no worker has since reached `seal_declaration` on this machine. **The rollup's entire input population is currently empty**, and the only reachable state for every plan on the estate is *no total, every slice absent*.

That makes this plan's real risk sharp: it builds the consumer before a single producer output has been observed. Every fixture it proposes is hand-written; nothing forces contact with a real line. `panel-r2.md`'s own diagnosis of its predecessor — *"a conforming fixture never exercises what occurs"* — applies unchanged, and the estate offers no line to check the fixture against. **Waiting for the first real records costs a day and converts every fixture into a verifiable claim.**

## Verdict rationale

The plan's positive premises are sound — a genuine and welcome contrast with this week's rejected six. What fails is the inference at `:40`: the three-way state is real, and it does not do the work the plan assigns it. That is fixable in the plan's own idiom: carry forward the bound-path disclosure the shipped docstring demands, pin it in `Done when`, choose `latest` over `history`, and replace the phantom no-transcript test with a real one. The work is worth doing and the design is close; it should not proceed on the claim that the objection is already answered.

Verdict: amend
