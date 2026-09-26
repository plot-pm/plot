# Architecture and estate lens — a-parsed-plan-joins-the-index

Position: reject
Evidence: executed

## Summary

The plan's headline number is wrong by a factor of ~30, and the mechanism it proposes
shipped in wave 2 of the monitors work. Both halves were measured, not argued.

## 1. Is the defect real?

**No — not as stated.** The plan's premise is that the scan parses 349 plans at 93 ms
each for ~32 s. I reproduced the plan's own measurement and then measured what the scan
actually does.

**The plan's method (one invocation per plan), reproduced exactly:**

```
30 plans, sequentially, one invocation each → 2762 ms total, 92 ms each
```

That matches the plan's `2808 ms → 93 ms each` to within 2%. The measurement is honest.

**What the scan actually calls** — `plot-fleet-scan.sh:2916`:

```bash
records=$("$script_dir/plot-plan-meta.sh" "$@" --prefixes "$PREFIX_RE" 2>/dev/null | python3 -c '...'
```

`"$@"` is **every plan file in ONE invocation**. Measured on this estate, four runs:

```
350 plans, ONE invocation (the scan's call shape)  →  674 ms / 500 / 350 / 400 ms
350 plans, with --prefixes as the scan passes it   →  1145 ms wall (0.30s user)
ONE plan, one invocation                          →  523 ms
```

**One plan costs 523 ms; all 350 cost 350–1145 ms.** The marginal cost per plan is under
0.5 ms, not 93 ms. The plan's `~32 s` extrapolation multiplies a fixed startup cost by
349 — and the plan itself identifies that cost as fixed startup (`plan:41`, *"each plan
costs roughly two shell startups"*) without noticing that the scan pays it **once**.

The batching is not incidental. `plot-fleet-scan.sh:2880` states it as the design:

> So the estate is parsed ONCE, here, and every later question reads the result. The four
> Released scan-performance plans fixed the HOST API N+1 (one bulk `pr-list` instead of
> one `pr-state` per branch); **this is the local-subprocess N+1, the same shape and a
> different cost.**

The function is named `parse_plan_estate` and its comment reads *"Called ONCE."*
(`plot-fleet-scan.sh:2915`). **The defect this plan targets was fixed before the plan was
written.**

The `plan:41` sub-claim that the parser spawns `plot-config.sh` per plan is also false.
`plot-plan-meta.sh:307` reads the `Tracker` key at **top level**, above the per-file loop
that starts at `:288` — once per invocation, for any number of files.

## 2. Does the design work, or is it already built / already refused?

**Already built, and the plan cites the file that says so without reading it.**

`PlanMonitor` — `packages/board/src/server/monitors.ts:229` — is a per-plan content-OID
cache that already exists and already runs on every board pulse:

```
export class PlanMonitor {
  private oids = new Map<string, string>();
  private stamps = new Map<string, string>();
```

Its docstring (`monitors.ts:211-228`) is the plan's own argument, already settled:

> THE HASH IS NOT REPLACED — it is SKIPPED when provably unnecessary.
> `plot-fleet-scan.sh:3004` states why the identity is content: *"THE PLAN'S IDENTITY FOR
> THE TERMINAL CACHE — its CONTENT, hashed, not its name or its mtime."* Substituting
> mtime for content would weaken an invalidation that was deliberately made
> content-based.

Shipped, per `packages/board/CHANGELOG.md:2187`:

> `BranchMonitor`, `PlanMonitor` and `WorktreeManager` hold the last answer and recompute
> only what a signal invalidates. On a quiet pulse those 88 spawns become **2**.

Verified there against this repository, not a fixture: *"37 plans and 67 branch rows, with
every cached ahead-count and plan oid equal to what git answers directly."*

So the plan's "The key is free and exact" section (`plan:49-53`) re-proposes a
content-hash key that is live in `monitors.ts` and in `PLOT_TERMINAL_CACHE`. The plan
reads `plot-fleet-scan.sh:3124` for the mtime pre-filter's removal and correctly takes
the lesson — but the line 120 lines below it (`:3004`) is the content-hash key already
being used, and `monitors.ts:214` quotes it.

**On whether it re-proposes what the removal rejected:** it does not. The removed
pre-filter keyed on a symlink mtime and the plan is right to reject that. But it argues
its way to a conclusion the estate reached in the same file, so the novelty is zero rather
than negative.

## 3. What does the plan claim that the code contradicts?

| plan claim | the code |
|---|---|
| `plan:3,28` "349 plans... ~32 seconds" parse cost | 350–1145 ms measured; `plot-fleet-scan.sh:2916` batches into one invocation |
| `plan:41` "`plot-plan-meta.sh` spawns `plot-config.sh`... each plan costs roughly two shell startups" | `plot-plan-meta.sh:307` reads config once at top level, above the `:288` loop |
| `plan:43` "So optimising the parser cannot help. The work is to stop invoking it." | It is already invoked once. There is nothing left to stop |
| `plan:47` "Every pass re-derives 337 answers that were already correct" | `PlanMonitor` (`monitors.ts:229`) already reuses unchanged plan oids; `terminal_cached()` (`plot-fleet-scan.sh:1252`) already serves cached terminal states keyed on plan blob hash |
| `plan:51` "`git ls-files -s` returns each plan's blob SHA... there is no hashing to do" | `hash-object --stdin-paths` in one process already does this (`monitors.ts:222`) |
| `plan:104` "A full scan on this estate completes inside the board's 90 s bound" | The parse is <1.2 s of it. The 90 s timeout has another cause, unidentified by this plan |

## 4. What must the plan say before someone builds it?

Nothing that saves it. Three slices are budgeted against a cost that does not exist:

- Slice 1 (`infra/the-parse-is-a-pure-function`) asks a real question — the parser's
  `Tracker` dependency (`plot-plan-meta.sh:307`) genuinely means two identical files can
  parse differently under different config. That is the one salvageable finding, and it is
  a ~10-line observation, not a slice.
- Slice 2 (`infra/a-parsed-plan-joins-the-index`) builds `PlanMonitor` again, on disk.
- Slice 3 (`infra/the-scan-reads-the-plan-index`) closes on a 90 s measurement whose cost
  it has misattributed.

**What the plan must do instead is re-measure the timeout.** The board reports
`Last scan failed: timed out after 90000ms` and a direct run exceeds 150 s — that is real
and worth fixing. But the plan parse is under 1.2 s of it. The estate's own trace
(`monitors.ts:11`) says where the time goes: **121 git processes per scan**, and
`fleet.ts:2165` says the rest:

> the scan reads 24.2 % CPU — 6.61 s of work inside ~24 s of wall clock. **It is no longer
> computing; it is waiting on GitHub.**

A plan targeting the 90 s bound should start from those two measurements. This one never
measured the scan at all — only the parser, in a call shape the scan does not use.

## 5. Through my lens: what already exists that this duplicates or contradicts?

**Duplicates:**

1. `PlanMonitor` — `packages/board/src/server/monitors.ts:229`. Per-plan content OIDs,
   mtime+size gated, batched rehash. The plan's mechanism, in memory, shipped.
2. `PLOT_TERMINAL_CACHE` — `plot-fleet-scan.sh:1223-1270`. Blob-hash-keyed cache with
   per-pass revalidation. `TERMINAL_PLAN_OID` is literally a plan blob hash used as a
   cache key.
3. `parse_plan_estate` — `plot-fleet-scan.sh:2915`. The batching that removed the
   per-plan invocation cost this plan proposes to remove again.

**On the caching rules — the plan cites them correctly and then fails them.**

`fleet.ts:2173` *"A DERIVATION, NEVER A RECORD"* and `monitors.ts:26-31`:

> A cache checked against a cheap fact every pass is a DERIVATION; one that is trusted is
> a RECORD. **IN MEMORY AND NOWHERE ELSE.** Nothing here writes a file... A cache that
> survived a restart would be a second source of truth about a repo whose only source of
> truth is git.

The plan proposes a **file-backed** store (`plan:73`, JSON under the git common dir,
`PrIndexStore`'s shape) and at `plan:69` says *"An entry is never invalidated — it is
superseded."* That is precisely the record the estate refuses. A blob SHA key makes a
stale entry unreachable rather than wrong, which is a genuine mitigation — but it does not
answer *"a cache that survived a restart would be a second source of truth"*, and the plan
does not engage that sentence. `PrIndexStore` is legal persistence because it holds what a
**remote host** said, which git cannot re-derive. A plan parse is derivable from the
checkout in 350 ms. The precedent does not transfer.

**Contradicts / overlaps `a-decision-reads-the-index`:** the sibling is Approved, Started
on `infra/the-index-has-its-first-consumer`, and its whole premise is that `PrIndexStore`
has **no consumer** — port, adapter, fold rule and a 967-row store, with all five
references being its own implementation. This plan at `plan:75` correctly flags the
collision (*"These two plans meet here and the slice must say how"*) and then defers it as
work. That is the right instinct and the wrong resolution: the sibling is already
in-flight giving that store its first consumer, so this plan would be reshaping a port
while another branch is building against it.

**Layering:** were it to be built, the cache would go where `PrIndexStore` sits — a port
in `packages/domain/src/ports/`, a file adapter in `adapters/`, a fold rule in `rules/`.
That placement is legal under the layering rule. It is also unnecessary.

**The plan's own honesty is worth noting.** `plan:122` flags that the 5.8 ms per-plan
figure in `plot-fleet-scan.sh:3118` is below the 26 ms cost of starting bash, calls the
discrepancy unresolved, and files it as #1017. That was the thread to pull. The 5.8 ms
figure is not anomalous hardware — it is the **batched** marginal cost, which I measured
at under 0.5 ms per plan today. The plan treated its own strongest clue as a footnote and
concluded *"This plan does not depend on the answer."* It depended on it entirely.
