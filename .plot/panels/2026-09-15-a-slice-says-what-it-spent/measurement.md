# Measurement lens — a-slice-says-what-it-spent

Read at `a868ec7e8`. Every number below was re-derived on this machine; nothing is carried over from the plan.

## 1. Is every factual claim TRUE on main right now?

I re-derived every number, path and quotation. **All of them hold.** This plan's measurements are unusually honest — including one place where it under-claims.

### The quotations are verbatim

| Claim | Verified |
|---|---|
| `rules/spend.ts:79` defines `CONTEXT_USAGE_FIELDS` as three input fields | TRUE — `packages/domain/src/rules/spend.ts:79-83` |
| The `output_tokens IS DELIBERATELY ABSENT ... charge the agent twice` comment | TRUE — verbatim at `spend.ts:74-77` |
| `contextTokens` = *"Tokens the last turn read back as context"*, `cache_read_input_tokens` alone | TRUE — `transcript.ts:27` docstring, `transcript.ts:216` reads that field alone |
| `contextSpend` = *"Every input token the last turn carried"* / *"the number a context ceiling is a fraction of"* | TRUE — `transcript.ts:35,40-41`, computed at `:220-221` |
| `contextTokens` rendered by the panel since 2026-08-19 | TRUE — `AgentPanelFacts.tsx:411`, and `transcript.ts:38` states the date |
| 256 KiB tail bound + *"a transcript grows without bound ... megabytes of JSONL"* | TRUE — `TRANSCRIPT_TAIL_BYTES = 256 * 1024` at `transcript.ts:138`, quote at `:128-130` |
| Walks backwards at `transcript.ts:184` | TRUE — the reverse loop begins at `:184` |
| `transcriptDir` resolves `~/.claude/projects/<slug>` | TRUE — `transcript.ts:79-81` |
| `registry.ts:137` documents `session` as *"the transcript join key"* | TRUE — verbatim at `:137` |
| `trap _cleanup_on_exit EXIT` at `plot-worker-loop.sh:1591` | TRUE — exactly that line number |
| `Worker bound` 28800 | TRUE — `CLAUDE.md:18` |
| `.plot/state/` is git-ignored | TRUE — `git check-ignore` exits 0 via `.gitignore:35` |

### `contextSpend` has no render site — TRUE, and the plan states it precisely

`grep -rn contextSpend packages/board/src/app` → **0**. Confirmed.

One refinement, not a correction: the field is *not* inert everywhere. It reaches `schema.ts:3381` and `registry.ts:222`, i.e. it is on the wire and in the server payload. The plan's wording — *"zero references in `packages/board/src/app`"* and *"computed and not yet shown"* — is exactly right on both counts. An implementer should know the wire field already exists, because that is a place a fifth summed field could be added silently.

### The token measurements reproduce

Largest transcript, three consecutive full scans:

```
input_tokens                     87,072   (plan:      86,922)
output_tokens                22,063,947   (plan:  22,016,579)
cache_creation_input_tokens 117,494,041   (plan: 117,015,335)
cache_read_input_tokens  21,529,982,803   (plan: 21,479,234,105)
cache read share                 99.356%  (plan:      99.36%)
```

The deltas are all **+0.2%, all in the same direction**. The reason is verifiable: this file is `1520fd86-…`, the transcript of *this very session*, still being appended to as I measure. That is a self-consistent explanation and not a discrepancy. **The headline ratio — 99.36% — is identical to three decimal places.**

The other two: **98.61%** and **99.28%**, against the plan's *"98.6%, 99.3%"*. Exact.

I also re-derived a third plot-project transcript independently: **99.37%**. The plan's claim that cache reads dominate a naive total is not a fluke of one file.

### The timing reproduces, and the plan was right to give a range

Three runs over 394 MB / 43,563 turns: **1108 ms, 1064 ms, 1071 ms** (a fourth: 1116 ms). The plan says **885–1087 ms**. My readings sit at and just above the top of that band — same order, same conclusion, and my machine is under panel load. The plan's decision to state a range rather than one figure is vindicated by my own spread.

File size: I measure **394,328,845 bytes**; the plan says 393,738,847. Same growing-file explanation, 0.15% apart. "387 MiB" is right (394,328,845 / 1024² = 376 MiB… **note: 394,328,845 bytes is 376 MiB, not 387 MiB**). The plan's "387 MiB (394 MB, 393,738,847 bytes)" mixes units slightly — 393,738,847 bytes is 375.5 MiB and 393.7 MB. The **byte count is the authoritative figure and it is right**; the MiB gloss is off by ~3%. Cosmetic, but it is the one arithmetic slip I found.

### Turn count

Plan: 43,488 turns. I measure **43,563** assistant turns carrying usage. Same growing file, +0.17%. Consistent.

## 2. Is the problem real, and is the shape right?

**Yes to both, and the central argument is measurement-backed rather than asserted.**

The load-bearing claim is that a naive four-counter sum is meaningless. I confirm it emphatically: at 99.36% cache read, a "total tokens" figure *is* a cache-read count with a different label. Two slices could differ 50× in generated output and rank identically. The plan's refusal to offer a fifth summed field is the single best decision in it, and it is justified by a number I reproduced rather than by taste.

The `output_tokens` handling is also right. The plan identified a real rule that would otherwise appear contradicted (`spend.ts:74-77`), read its reasoning correctly, and explained why it does not transfer — context occupancy double-counts, billing does not. It does this **openly**, which is the behaviour this repo's CLAUDE.md asks for when a new derivation sits beside an old one.

The once-at-exit placement is correct given my timing: ~1.1 s is trivial once per slice and catastrophic on a 5 s board poll.

## 3. What does `Done when` fail to pin?

Three gaps. The first is the one I would hold the slice on.

### (a) WHICH SESSION — the measurement that decides the number's meaning is unpinned

`Done when` says *"the sum is over **every** turn of the run rather than the last"*. It never says **whose** turns.

I measured this project's transcript directory: **604 session files**, of which **421 are `agent-*.jsonl`** and **370 contain subagent assistant turns with zero main-session turns**. These are subagent transcripts — separate files, not sidechain lines inside the main file. (I checked: the largest files contain *zero* `isSidechain:true` assistant turns; subagent work lives in its own files.)

Share of spend across all 604 files:

```
agent-* files : out=378,461    cache_creation=3,052,037
uuid   files : out=34,973,360  cache_creation=193,095,890
agent-* share of output tokens:    1.07%
agent-* share of cache_creation:   1.56%
```

So a per-session sum keyed on the agent's own `session` **under-reports by ~1%** on this estate today. That is small — but the number is unbounded in principle (a slice that delegates heavily inverts it), and **the plan's own Notes section says a wrong number here is "wrong in the direction nobody checks."**

Critically, **the code already knows about this hazard and the plan does not mention it.** `transcript.ts:85-90` documents subagent files explicitly (*"measured: eleven of them in this worktree alone"*), and `spend.ts:42-50` carries a stronger warning: *"one project directory measured 2026-09-03 held 45 session files, 30 of them subagents, and a sum across them belongs to no one."* My count — 604 files, 421 subagent — is the same phenomenon an order of magnitude larger.

**An implementation could satisfy every stated gate and still be wrong**: sum all four counters over every turn of `<session>.jsonl`, write four fields plus the model, skip subagents entirely, and pass. Or the opposite — sum every file in the directory, capturing other slices' agents, which `spend.ts` says "belongs to no one." Both pass `Done when` as written. The plan must state which, and say so against `spend.ts:42-50`'s rule the way it already does against `spend.ts:74-77`'s.

### (b) "No summed fifth field" is pinned in prose, not by a gate

*"no summed fifth field is written, and the plan's reason is carried into the code"* — a comment is a rule, and this repo's own **Gates Over Rules** section says a prose MUST will eventually be violated. My measurement is exactly why it matters: the wire schema (`schema.ts:3381`) already carries `contextSpend`, so adding `totalTokens` beside it is a two-line change nobody would flag in review. The gate is cheap: a test asserting the written record's key set is exactly the five expected names.

### (c) The multi-model case is unpinned

I measured **two models in one transcript**: `claude-opus-5` (43,550 turns) and `<synthetic>` (13 turns). `Done when` says "the model" — singular. A record with one model field over a run that used two is a wrong attribution, and `<synthetic>` is not a billable model at all. The plan's own reasoning ("the same count on two models is two different costs") argues for per-model grouping, but the gate asks for one field. Either pin it to the dominant model with the rule stated, or group by model.

## 4. Are the two Open Questions blocking, and is either answerable now?

**Q1 — where does the record live? Genuinely blocking. Correctly marked.**

I verified `.plot/state/` is git-ignored (`.gitignore:35`, `git check-ignore` exit 0). The plan is right that writing there reproduces the very problem it names: a colleague reads nothing. This is a real fork with real consequences (per-run numbers in git history vs. an openly machine-local number), and it is not answerable from the repo — it is a policy call. Holding the slice is correct.

I will add one measurement that bears on it: **the transcripts themselves are not reproducible across machines**, and the record derived from them is the only durable artifact. So "machine-local and labelled" has a real failure mode the plan should weigh — reap the desk on machine A, and the number exists nowhere a machine-B reader can find it, forever. The committed option is the only one where the number survives.

**Q2 — which exits? Blocking in practice, and PARTLY answerable from the repo now.**

The repo answers more than the plan credits. I found **two** traps, not one:

- `plot-worker-loop.sh:1546` — `trap _on_alarm ALRM`
- `plot-worker-loop.sh:1591` — `trap _cleanup_on_exit EXIT`

These are not alternatives. `_on_alarm` is a *signal* handler; the `EXIT` trap still runs when the script subsequently exits. So a scan hung on the EXIT path runs on **every** termination including the bound — which is precisely the case the plan worries about. The question is therefore sharper than the plan states: it is not *"which exits do we hook"* but *"the EXIT trap already covers all of them, so the scan needs its own bound."*

Given my timing (1.1 s worst case observed on the largest transcript on this estate), the honest answer is that a bounded scan is affordable on every path. The remaining risk is not time but a pathological file, and that argues for a wall-clock cap on the scan itself with the "record nothing and say so" fallback the plan already specifies. **This question is close to answerable and should not block alone.**

## 5. Strongest argument AGAINST doing this at all

**The number this plan produces cannot be acted on, and the plan proves it itself.**

It records four counters and forbids a total. It explicitly refuses a price table. So a reader gets four figures, one of which (cache read) is 99.36% of the naive sum and the cheapest token class there is, and no sanctioned way to combine them. The plan says *"a reader wanting one number should be given none"* — which is intellectually honest and also concedes that **no decision is enabled at the end of this slice.**

Everything actionable is deferred: the per-plan rollup is the sprint's Should, and the price weighting is excluded by measurement. So this slice ships a record whose only consumer is a future slice that does not exist yet. If that future slice needs a price table to be useful — and the plan's own cache-read measurement is an argument that it does — then the useful unit of work is "cost with weights," and this is scaffolding that may get re-derived when the weights arrive.

**The counter-argument, which I find stronger:** the four raw counters are the *inputs* to any weighting, they are cheap to capture, and they are **destroyed when a desk is reaped on a machine nobody returns to**. Capture-now/weight-later is the right order when the raw data is perishable and the weights are not. The transcript outliving the desk (which the plan correctly notes) reduces but does not eliminate this — it is machine-local and unbacked. So the argument against is real but loses.

## Summary

The measurements in this plan are **sound**. I re-derived every number and the headline ratios match to three decimals; the small deltas are explained by a live, growing file and all point the same way. The one arithmetic slip is a MiB/MB gloss (387 MiB should be ~376 MiB); the authoritative byte count is right and nothing depends on the gloss.

The design reasoning is better than the gates. The plan correctly identifies that a naive total is meaningless, correctly declines to offer one, and correctly argues against an existing rule in the open. But `Done when` does not pin the one question that decides what the number *means* — **which session's turns are summed** — and the repo already carries a measured warning about exactly that (`spend.ts:42-50`; my own count: 604 files, 421 of them subagent transcripts). An implementation can pass every stated gate and produce a number that is silently ~1% low, or one that "belongs to no one."

That is an amendment, not a rejection: add the session-scope rule to `Done when`, gate the no-fifth-field rule with a test rather than a comment, pin the multi-model case, and note that the EXIT trap already covers the ALRM path so the scan needs its own bound rather than a choice of exits.

Verdict: amend
