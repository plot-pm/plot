# Measurement lens — the ledger prunes what it read

Position: amend

Every number in the plan was re-run on this machine (2026-09-21, load 8.36, macOS, bash). The **defect is real and the direction is right**. Three of the plan's load-bearing numbers do not survive re-measurement: one is a misread field, one is an unfair comparison, and one is an A/B over a confounded switch. None of the three overturns the conclusion, but all three overstate it, and one of them is repeated verbatim from the note as a fact about the window.

## 1 · Does the stated problem exist?

**Yes, verified in code and re-measured.**

- `~/.plot/state/budget.tsv` — **17,680,141 bytes, 313,975 lines** at first read (the plan said 17.6 MB / 312,589; it has grown ~1,400 lines during this review, which is itself consistent with the append rate below).
- `grep` for `truncationOwed`, `pruneOwed`, `.truncate(` across `packages/domain/src` and `packages/board/src`, excluding tests: **zero production callers.** Every hit is inside `rules/budget-record.ts` itself or a docstring cross-reference in `ports/slots.ts:54`. The rule, the port (`ports/budget.ts:93`) and the adapter (`adapters/budget/budget-file.ts:132`) all exist and nothing invokes them. The dead-rule claim is exactly true.
- `budget_rate` over the real file, 15 runs in bash: **503, 507, 517, 520, 524, 527, 536, 553, 563, 563, 565, 568, 569, 591, 600 ms**. Median 553. The plan's 516 ms sits inside the distribution.

## 2 · Is it the smallest change? — and the three numbers that do not hold

### 2a · `lines: 119937` is not the in-window count. It is the whole-file match count.

The plan and the note both present this as *"lines for the account under test, **inside the 1 h window**"*. It is not. The awk `n++` counter increments on every **key-matched** line before any window filter is applied; the filter runs in `END` over `c_at[i] < from`. I measured both:

| | |
|---|---|
| `budget_rate bitbucket quatico api` reports `lines:` | **120,588** |
| lines matching `bitbucket/quatico` in the file, no window | **120,588** — identical |
| lines matching that budget **actually inside the 1 h window** | **2,287** |

The true live/dead split across the whole ledger right now is **2,619 live against 311,377 dead**. So the plan's window figure is wrong by a factor of **52**. This matters beyond pedantry: 119,937 live lines in an hour would be 33 appends/second, which would make the append path itself the problem and truncation nearly useless — it would leave a file almost as big as it found. The real figure, 2,287, is what makes truncation worth doing. **The plan's own headline number argues against its remedy; it is only the corrected number that supports it.** Fix the number, keep the conclusion.

### 2b · The 5 ms comparison measures a file truncation never produces.

`5 ms over 50 lines` is compared against `516 ms` to imply "factor 100". But truncation keeps **every budget's live window**, not 50 lines — `survivors()` in `budget-record.ts` is explicit about this. I built the exact post-prune file (2,617 lines) and timed it:

| ledger | lines | `budget_rate` |
|---|---|---|
| full | 313,996 | 518–555 ms |
| **pruned (what truncation actually leaves)** | **2,617** | **12 ms, five runs, zero spread** |
| 50 lines (the plan's comparison) | 50 | 4–5 ms |
| empty (fork/process floor) | 0 | 3–4 ms |

The honest claim is **~520 ms → 12 ms, a factor of 43**, against a process floor of ~4 ms that no amount of pruning removes. The changelog's "516 ms → ~5 ms" should read 12 ms. Still a large, real win — just not the one written.

### 2c · The 80% A/B is confounded: `PLOT_BUDGET_OFF` gates three things, not one.

This is the finding I would hold the plan on. `grep -n PLOT_BUDGET_OFF skills/plot/scripts/plot-host.sh` returns **three** gates:

- `:2241` and `:2615` — the appends
- **`:2822` — `host_slot_take`, the concurrency slot, which returns immediately**

`host_slot_take` polls `budget_slot_acquire` in a loop with `sleep "$PLOT_SLOT_POLL_S"` (1 s), up to `PLOT_SLOT_WAIT_MAX_S=30`. So `PLOT_BUDGET_OFF=1` removes **up to 30 seconds of sleep** alongside the ledger scan. The note's "one environment switch removes about 80% of the runtime" therefore cannot attribute that 80% to the ledger. The switch turns off the ledger *and* the queue.

The note's own reasoning makes this worse for the plan, not better. It argues: *"Stable raw time with unstable total time means the overhead is not computation — computation is reproducible."* I measured `budget_rate` at **spread 97 ms across 15 runs at load 8.36** — it is computation, and it is stable. The 4,674 ms spread on `pr-list` is therefore **not** the ledger by the note's own test. It is a 1-second-granularity sleep loop, which is precisely the shape that produces multi-second, load-dependent, irreproducible spread. The note dismissed the concurrency slot as a cause ("finding 1 is FALSE — the bound IS computed") but dismissed the wrong thing: that the bound is correctly computed as 1 is exactly what makes the queue *serialise* and *sleep*.

So the plan's arithmetic mis-splits a real cost. Truncation removes a **stable ~500 ms** per read. It does **not** remove the spread, and the plan's headline "2567–7241 ms → 507–1183 ms" will not be reproduced by truncation alone. A reader who ships this and re-measures will find `pr-list` still spiky and reasonably conclude the fix failed.

### 2d · The threshold's stated basis is stale, and pruning fires far more often than written.

`PRUNE_THRESHOLD = 100`'s docstring justifies itself as *"under a tenth of the ~1,160 an hour measured 2026-09-01"*. Re-measured per hour over the last six hours: **2,616 / 2,508 / 2,571 / 2,556 / 2,602 / 2,606**. The rate has **more than doubled** since the threshold was set. Lifetime average is 726/hour over 431 hours, so the rate is rising, not stationary.

At 38 appends/min for the hottest budget, 100 dead lines accumulate every **~2.6 minutes**. The plan says the threshold exists "so that pruning happens on some reads rather than every read" — at the measured rate that is a full-file rewrite every 2.6 minutes per hot budget, 4 live budgets. The rewrite itself I measured at **5 ms** (write 2,617 lines + rename), so the cost is fine; but the plan asserts a contention property it never measures, and the number it leans on is two-fold stale. Either re-derive 100 from the current rate or say plainly that the threshold is now ~4% of an hour's lines rather than under a tenth.

## 3 · What I could not verify

- **The `pr-list` timings (2567–7241 ms / 507–1183 ms).** Measured on `quatico/quaweb-website`, a Bitbucket repo. This checkout is GitHub (`plot-host.sh backend` → `github`). I could not reproduce them, and given 2c I do not believe they isolate the ledger. Re-running them here would measure a different host, a different account and a different queue depth.
- **Whether a concurrent appender actually loses a line during the `mv`.** The window is ~5 ms and the append rate is 0.714 lines/sec, so the expected loss is ~0.004 lines per truncation — negligible, and the plan's tolerance argument is sound in direction. But I did not run the race; the plan promises a test for it and that test is the right place.
- **Load attribution.** Every number here was taken at load 6–8 with sibling agents running. `budget_rate`'s tight spread suggests it is CPU-bound on a warm page cache and largely load-insensitive, but I could not drop the page cache (no sudo), so the cold-read cost is unmeasured. A cold 18 MB read is the case a fresh boot would hit.

## 4 · What breaks if this ships as written

**The shell header forbids exactly this, by name.** `plot-budget.sh:11-15`:

> *"IT APPENDS AND READS, AND IT NEVER PRUNES. Truncation is the one write that is not an append, and it belongs to the `BudgetRecord` port's `truncate()` — **a second pruning path in shell would rewrite the file while the port's reader believed it held the lines it had just proven dead.** The shell writes the record; the domain is what cleans it."*

The plan argues the shell should prune because the shell is the hot reader. That is a reasonable position and the cost argument (`node` on the hot path) is real. But the plan never quotes, cites or rebuts the sentence in the file it is editing — it presents the shell as the obvious home. The header names a specific failure: the TS reader holding lines it proved dead while the shell rewrites underneath it. With the board as a live TS spender, that interleaving is reachable. **Amend the plan to rebut this header explicitly and amend the header in the same slice**, or the next reader finds a file whose own documentation contradicts its behaviour.

**A reader who re-measures will think the fix failed** (2c): the spread survives, because the sleep loop survives.

**Unbounded growth is the strongest claim and it holds.** No `MAX_LINES`, no rotation, no bound anywhere in `plot-budget.sh`. Projected at the current 2,570/hour, unpruned:

| horizon | lines | size | `budget_rate` |
|---|---|---|---|
| +7 d | 432 k | 24 MB | ~714 ms |
| +30 d | 1.85 M | 103 MB | ~3.1 s |
| +90 d | 5.55 M | 310 MB | ~9.2 s |
| +365 d | 22.5 M | 1.26 GB | ~37 s |

At 90 days a single `budget_rate` exceeds the board's 5 s cadence. **This, not the 80% A/B, is the defensible case for shipping**, and the plan should lead with it — it needs no contested attribution and no host-specific timing.

## 5 · Existing mechanism, or a nearer one ignored

**`truncate()` already exists, fully implemented, in `adapters/budget/budget-file.ts:132`** — scratch file, `writeFile`, atomic `rename`, with a docstring that already accepts the lost-append trade in the plan's own words. The plan proposes reimplementing this in shell and pinning it with a corpus test. That is the declared-duplication route `docs/shell-and-domain.md` licenses, and the plan cites it correctly. But it should say plainly that it is duplicating a **working implementation**, not filling a gap — the slice text reads as though pruning must be written from scratch.

**The nearer mechanism the plan ignores: the sleep loop.** `PLOT_SLOT_POLL_S=1` on a bound that floors to 1 is the only component whose cost is load-dependent and multi-second. The note explicitly parked "measure again before designing a cache" — good discipline — but it retired the concurrency slot as a suspect on a finding about *whether the bound is computed*, which is a different question from *what the queue costs*. Sub-second polling, or a bound above 1, is plausibly a larger and cheaper win on the spread than truncation is on the mean, and it is unmeasured.

## What would make this proceed

1. Correct `119937` → **2,287** live lines, in both plan and note. It is a misread field, and it is stated as a window fact in two documents.
2. Correct `516 ms → ~5 ms` → **~520 ms → 12 ms**, comparing against the file truncation actually leaves.
3. Stop attributing the 80% / the 4,674 ms spread to the ledger. State the ledger's win as the stable ~508 ms it is, and name `host_slot_take`'s sleep loop as the untested other half.
4. Lead the case on unbounded growth, which re-measures clean.
5. Rebut `plot-budget.sh:11-15` in the plan and amend that header in the same slice.
6. Re-derive `PRUNE_THRESHOLD`'s justification against the measured ~2,570/hour, or restate the ratio honestly.

The defect is real, the remedy is right, and the file genuinely needs this. The arithmetic around it needs correcting first, because three of the numbers a future reader would re-derive from do not reproduce.
