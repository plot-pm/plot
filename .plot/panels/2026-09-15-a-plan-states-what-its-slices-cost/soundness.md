# Juror — soundness lens

Subject: `docs/plans/2026-09-15-a-plan-states-what-its-slices-cost.md` (Draft)
Lens: **soundness** — a number honest about its gaps can still mislead if the gaps are *systematic* rather than random. The question is whether the absences correlate with cost.

## 1. Every factual claim, checked on main

Verified at `origin/main` = `e98cba7cd`.

| claim | status |
|---|---|
| `workflows/slice-spend.ts` exports `recordSliceSpend` and `readSliceSpend` | **TRUE** — `slice-spend.ts:64` and `:102`, shipped in `c414c3ce8` |
| `SpendReadState` is three-way `measured \| absent \| unreadable` | **TRUE** — `rules/slice-spend-record.ts:19`, exactly as quoted |
| the line number `rules/slice-spend-record.ts:19` | **TRUE** — the `export type` is on line 19 |
| no `planSpend` / `spendForPlan` / per-plan sum anywhere | **TRUE** — `git grep -nE 'planSpend\|spendForPlan\|sumSpend\|spendTotal'` over `packages/` and `skills/` returns **zero** hits |
| `readSliceSpend` answers for one branch | **TRUE** — signature takes `branch: string`, `slice-spend.ts:102-108` |
| the `DeclarationReading` quote *"cannot answer is not no. This repo has twice shipped a collapse of those two."* | **TRUE** — `entities/declaration.ts`, verbatim in the `DeclarationReading` docstring |
| `plot-slice-spend.mjs` bundle shipped | **TRUE** — `git ls-tree origin/main skills/plot/scripts/board/` lists it |
| write site in `plot-worker-loop.sh` | **TRUE** — `record_slice_spend()`, called at `:2142` beside `seal_declaration` |
| `plot-plan-meta.sh` reports branches as `waves[].branches[]` | **TRUE** — ran it on this very plan; returns one wave, one branch |
| four counters kept apart, no summed fifth | **TRUE** — `spendSummary` renders four and no total |
| `readSliceSpend` opens no transcript | **TRUE** — it calls only `record.lines()`; `test/slice-spend-file.test.ts:259-264` pins the read path with the transcript home pointed at an empty directory |

**Could not verify:** the "99.36% cache-read" figure is cited from the prior panel rather than re-derived here; I did re-derive it independently and it holds on this estate (see §3). The `.gitignore` reference is now correct — `:30` is the root `.plot/state/` pattern, and the plan does not repeat the prior round's `:35` error.

**One correction to the plan's framing, in the plan's favour:** the plan says the objection "stands, and the shipped vocabulary answers it." The shipped code goes further than the plan credits. `slice-spend.ts:53-61` and `plot-worker-loop.sh:1074-1079` **both already state the bias in their own docstrings**, in the plan's own words:

> *"a rollup over these records is therefore biased LOW in a direction nobody can see from the records alone, and a reader must be told so."*

The plan is the thing that docstring anticipated. That is a point for the plan, not against it — but it also means the slice author already judged that counts alone are **not** the whole remedy, and said so.

## 2. What the spend slice shipped, and what a rollup can build on

Shipped and usable:

- `recordSliceSpend` / `readSliceSpend` (`workflows/slice-spend.ts`), `readSpend` / `spendSummary` (`rules/slice-spend-record.ts`), `SpendRead` carrying `state`, `latest`, `history`, `unreadable`.
- `sliceSpendFile` adapter resolving the record from **`--git-common-dir`** — the prior panel's decisive finding was applied. The docstring at `adapters/slice-spend/slice-spend-file.ts` reproduces the measurement and the record therefore **survives a desk reap**. Round 2's item 1 is genuinely closed.
- One record file per repository, `.plot/state/slice-spend.jsonl`, holding every branch the machine measured. Append-only; a re-dispatch writes a second line and `latest` wins.
- The write site, `record_slice_spend()`, exiting 0 on every refusal so it can never change how a worker ends.

**A rollup can build on all of this with no new I/O**: `readSliceSpend` per branch, over the branches `plot-plan-meta.sh` names. The mechanism the plan proposes is genuinely small and the inputs are genuinely there. My objection is not to the mechanism.

## 3. THE KEY QUESTION — are the absences biased? **Yes, severely, and in one direction.**

The plan's argument is that a partial sum plus `absent`/`unreadable` counts is sound because the reader can act on *"3 of 5 slices measured"*. That argument holds **only if a missing slice is no more expensive than a present one.** It is not. Three independent mechanisms all push the same way.

### 3a. The bound path — the most expensive runs record nothing, and this is proven in code

`plot-worker-loop.sh:992-996`, the loop's own comment:

> *"ABSENCE IS LOAD-BEARING, so this runs on exactly one path: `run_bounded` returned 0 … A worker killed by the `Worker bound` or ended by the WorkerMonitor exits above without reaching this line."*

`record_slice_spend` is called at `:2142`, on that same single path. So a slice that burned the full 28800 s bound records **nothing at all**, and appears as `absent` — the identical state as a slice that ran on a colleague's laptop, and the identical state as a slice nobody ever started.

Measured on this machine right now: **every `.plot-worker.exit` file that exists reads `124`.**

```
find .worktrees -name '.plot-worker.exit' → 3 files, all "124"
```

Three of three. A tiny sample, and I will not over-read it — but it is three of three on the *timeout* code, in the population that by construction records nothing. There is no counter-sample of a `0` exit on this machine to set against it.

### 3b. The reap — 92% of measured cost belongs to desks that no longer exist

This is the measurement I consider decisive. I summed every token counter across all 67 desk transcript directories under `~/.claude/projects/*-worktrees-*`, and partitioned by whether the desk still exists on disk:

```
desk transcript dirs : 67
  desk still on disk :  3
  desk REAPED        : 64

ALL     turns=23,293  out=7,852,284  in=1,022,292  cacheRead=2,485,990,882
ALIVE   turns= 2,005  out=  639,442  in=   48,240  cacheRead=  215,156,370
REAPED  turns=21,288  out=7,212,842  in=  974,052  cacheRead=2,270,834,512

REAPED share of output tokens : 91.86%
REAPED share of cache-read    : 91.35%
```

The `--git-common-dir` fix means a record *written before* a reap survives it. Good. But the record is only ever written by `record_slice_spend`, which shipped in `c414c3ce8` on **2026-09-15 14:58** — today. **Every one of those 64 reaped desks predates the write site.** The historical estate contributes 92% of the tokens ever burned here and **0 records**.

That is not an argument against the rollup forever; it is an argument that *for every plan currently in the estate*, the `absent` count will be near-total and the measured sum near-zero. And critically — nothing on the record side can distinguish "this slice predates the recorder" from "this slice ran elsewhere" from "this slice hit the bound". All three land in one word: `absent`.

### 3c. The record does not yet exist on this machine at all

```
ls $(git rev-parse --git-common-dir)/.plot/state/slice-spend.jsonl
→ No such file or directory
```

So today, a rollup over **any** plan returns `measured=0`, and the plan's own gate fires: *no total*. That is the correct behaviour and I credit the plan for pinning it. It also means the deliverable, on the day it ships, reports nothing for every plan in the repository.

### 3d. Working the three concrete cases the rubric asks for

**Case 1 — a plan whose slices ran on two machines.** Slices A, B measured here; C, D on a colleague's laptop. Report: *"in 40k, out 120k over 2 measured; 2 absent."* A reader concludes: **"this plan cost at least 160k tokens, and about half of it is unaccounted."** Is that conclusion true? *The lower bound is true.* The implied "about half" is not — it silently assumes the absent slices resemble the present ones. Slice-size variance on this estate is large: across the 67 desks, output tokens per desk range over three orders of magnitude. The count says *how many* are missing; it says nothing about *how much*, and cost is what the reader wants. **Conclusion: partly true, and the false part is the part the reader cares about.**

**Case 2 — a plan with a bound-killed slice.** Slices A, B measured; C hit 28800 s and was SIGKILLed. Report: *"2 measured, 1 absent."* A reader concludes: **"two-thirds of this plan's cost is visible."** That conclusion is **false, and false in a knowable direction.** C is, by the definition of the bound, the most expensive slice in the plan — it ran longer than any slice that finished. The report presents the single largest term as an equal-weighted tally mark. A reader shown "2 of 3" will underestimate; a reader shown "2 of 3, and the missing one is likely the largest" would not. The plan's design does not carry that second sentence, and the *data cannot supply it* — `absent` does not distinguish a bound kill from a never-started slice.

**Case 3 — a plan whose desk was reaped.** With the `--git-common-dir` fix, a record written before the reap **survives**, and this case is genuinely handled going forward. A reader concludes *"measured"* and is **right**. Credit where due: this is the prior panel's decisive finding, correctly closed. The residual is only historical (§3b) — desks reaped before today.

### 3e. The soundness verdict on the key question

**Reporting counts alongside a partial sum makes the number *legible*, not *sound*.** The distinction matters because they diverge exactly when the gaps are systematic, and here they are systematic on the cost axis by construction:

- an `absent` slice is *more likely* to be expensive than a measured one, because the single mechanism that guarantees non-recording (the bound) is the single mechanism that guarantees maximum cost;
- the report weights each absence as **one tally mark**, which is an implicit uniform prior over cost;
- so the reader's natural inference — scale the measured sum by `total/measured` — is **biased low**, and no number in the report corrects it.

This is not the `DeclarationReading` situation the plan invokes as precedent. There, `absent` and `unreadable` are kept apart because collapsing them claims a measurement nobody made — and the fix is genuinely a vocabulary fix, because a declaration is a *boolean-ish* fact: the work completed or it did not, and an absence is fully informative (*"it means the work did not complete whatever the exit code says"*, `entities/declaration.ts`). **A spend is a magnitude.** For a magnitude, knowing *that* a term is missing does not bound it. The plan borrows a vocabulary designed for a predicate and applies it to a sum, and the docstring it cites as precedent is precisely the one explaining why absence is informative *there*.

The shipped code says this in one sentence and the plan does not carry it forward: *"For a declaration that absence is load-bearing; for a spend it inverts"* (`slice-spend.ts:56-58`).

**So: an invitation to a wrong conclusion, and a narrowly avoidable one.** What would make it a measurement is small — the plan does not need to fix the bound path, only to stop pretending the absences are exchangeable. Concretely: partition `absent` by *why*, using evidence the estate already writes. `.plot-worker.ending.json` records `reason` and `actor` on the ending path (`plot-worker-loop.sh`, `write_ending`), and `DeclarationReading`'s fourth outcome plus the prior panel's item 5 already name **`elsewhere`** for a run on another machine. A report reading *"2 measured, 1 absent (bound-killed — the largest run in this plan), 1 absent (not this machine)"* is sound. *"2 measured, 2 absent"* is not.

## 4. What `Done when` fails to pin

The gate list is unusually good — the key-set assertion against a summed fifth, and the explicit zero-measured case, are both real gates rather than prose. Three gaps:

1. **Nothing pins WHY a slice is absent.** Every stated gate is satisfied by an implementation that reports one integer `absent` count. That is the §3 failure, and it passes every gate as written.
2. **Nothing pins the reader's sentence.** The gates constrain the *data structure*; the failure mode is the *rendering*. `spendSummary` is the precedent — the slice plan pinned the sentence a person reads, and this plan pins only the record. An implementation emitting `{input: 40000, …, absent: 2}` satisfies every gate, and the board renders "40,000 tokens" with the absences in a tooltip.
3. **The `unreadable` count is ambiguous between two levels.** `SpendRead.unreadable` is a **per-line** count of torn records (`slice-spend-record.ts`), while `state: 'unreadable'` is a **whole-file** failure. A plan-level "unreadable count" could mean either, and the fixture demanded — "one of each" — does not disambiguate. An implementation summing `SpendRead.unreadable` across branches and an implementation counting branches whose `state === 'unreadable'` both pass.

**The strongest single way to satisfy every gate and still be wrong:** implement it exactly as written, ship it, and let a reader open a plan whose one expensive slice was bound-killed. Report: *"1 of 2 measured."* Every fixture green, the key-set assertion green, the zero-measured case green, `test:contracts` green — and the plan's headline number understates by whatever the 28800-second run cost, with nothing on screen hinting at the direction.

## 5. The single strongest argument against doing this at all

**`STORY-plot-plan-economics.md:270` — *"Cost is derived, never stored — a stored cost is a record that can be wrong."*** All three jurors of round 2 named this as the strongest objection to the *slice* plan, and it was never answered there. This plan is the first consumer of the stored cost, and it **does not mention the line at all.**

That is sharper here than it was one level down. For a single slice, a stored record that can be wrong is at least *checkable* — you can open the transcript and compare. **A sum over stored records is not checkable**, because the terms that would falsify it are the ones that are absent. The rollup is the point at which "a record that can be wrong" becomes "a record nobody can audit," and it is the artefact the story's dated decision most directly forbids.

Secondary, and nearly as strong: **nothing consumes it.** The plan states plainly that it gates nothing — no delivery, release or dispatch reads a cost — and `spendSummary` has no renderer outside its own test today. So the deliverable is a number, of known-biased construction, built for no decision. The honest counter is that visibility precedes use and a first reader has to exist; that is a fair answer to "why now," and it is not an answer to "why a *sum*." A per-slice list — which the estate can already produce — carries every fact the rollup does and invents no aggregate that absences can poison.

## Where this leaves me

The plan is **well-built, honest, and narrowly wrong about one thing.** Its inputs check out to the line. It closed the prior panel's decisive path finding. It correctly refuses a bare total, correctly refuses a summed fifth counter, and correctly reports *no total* rather than zero. The `--git-common-dir` work means case 3 is genuinely sound.

What it gets wrong is the inference from *the vocabulary is three-way* to *therefore the sum is sound*. Three-way vocabulary makes the gap **visible**; it does not make it **exchangeable**, and cost is a magnitude where visibility is not enough. The mechanism that guarantees an absence is the same mechanism that guarantees the maximum cost, so the absences are biased low, measurably and by construction — and the shipped code's own docstring says so in a sentence the plan does not carry into its design.

This is an amendment and not a rejection. The fix is small and uses evidence the estate already writes: partition `absent` by reason (bound / elsewhere / never-recorded), name the bound case as the expensive one in the reader's sentence, and pin that sentence in a gate the way `spendSummary` was pinned. Add the `STORY:270` answer the slice plan still owes. With those, the number is a measurement.

**What I would ask for:**

1. **Partition `absent`.** At minimum bound-killed vs not-this-machine vs no-record, using `.plot-worker.ending.json` and the `elsewhere` vocabulary round 2 item 5 already named. A single integer is the defect.
2. **Pin the reader's SENTENCE, not just the record** — the gate `spendSummary` carries. Include the direction of the bias in it.
3. **State that the sum is a LOWER BOUND** and say so in the output, since the one mechanism guaranteeing non-recording guarantees maximum cost.
4. **Disambiguate `unreadable`** — per-line torn records vs whole-file failure are two counts, and the demanded fixture separates neither.
5. **Answer `STORY-plot-plan-economics.md:270`**, outstanding since round 1 of the dependency's panel and now load-bearing in a way it was not one level down.
6. **Carry `slice-spend.ts:56-58` into the design** — *"for a spend it inverts"* is the sentence that defeats the plan's own central argument, it is already on main, and the plan cites the file without citing the line.

Verdict: amend
