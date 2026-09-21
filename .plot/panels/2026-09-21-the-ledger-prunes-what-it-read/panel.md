# Panel moderation — the ledger prunes what it read

**Subject:** `docs/plans/2026-09-21-the-ledger-prunes-what-it-read.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous amend` — measurement, layering, estate, concurrency. **Four of four, gated.**

## What each juror actually looked at

Three jurors, three kinds of evidence, and the difference matters.

| Lens | Evidence |
|---|---|
| measurement | **Ran the measurements again.** Re-derived every number in the plan and the note |
| estate | **Implemented a correct multi-key prune in awk and timed it**, then searched the estate and git history |
| layering | Read `CLAUDE.md`, `docs/shell-and-domain.md` and the target file against the plan's placement argument |
| concurrency | **Measured the real append rate and the loss window** against the live ledger |

Nobody reached `amend` by reading the plan alone.

## The disagreement that is not one

All three said `amend` and none said `reject`. **The premise survived every lens**: the ledger is 98.1% dead lines (118455 dead against 2273 live, verified in this session), the read cost is real, and the truncation rule has no caller. The plan deserves to exist.

What they refused is the **execution**, and on three independent grounds. A unanimous `amend` here is not a weak `proceed` — it is three readings that each found a different defect, any one of which would have shipped.

## Three findings the author must accept

### 1 · A number in two committed documents is wrong (measurement)

The plan and the note both state **119937 lines in the window**. That is `budget_rate`'s `lines` field, which counts **matched** lines, not **live** ones. Verified here: `lines: 120723` against `spent: 2272` over a 3598430 ms span.

The true figure is **2273 live, 118455 dead — 98.1% dead**.

The correction cuts both ways and the author must say so: it makes the *case* stronger (the file is almost entirely garbage) and the *performance claim* weaker (the post-prune file is ~2300 lines, not 50, so the read lands near 12 ms rather than 5 ms).

**This is the author's error, in text already pushed to main.** It must be fixed in both documents before anything else.

### 2 · The correct prune is slower than the read it amortises (estate)

The plan says it duplicates `truncationOwed`. It does not: **`truncationOwed` reads a single-key `RecordRead`, while `survivors` regroups all lines by `groupByBudget` and recomputes `windowStart` per key from that key's own resets.** One file, many budgets — a truncation driven by one reader's window drops another connector's live lines.

So a shell prune must implement `survivors`, the larger rule. The juror wrote it and measured **685 ms**, against the 516 ms read it is meant to amortise. **On every read where the threshold fires, the call gets slower.**

And the threshold fires on essentially every read: `PRUNE_THRESHOLD = 100` against a backlog of 118455, then again every ~3 minutes at the measured rate. The plan's own stated safety property — *"pruning happens on some reads rather than every read"* — does not hold on the estate it was measured against.

### 3 · The estate already solved this next door (estate)

`plot-commit-record.sh` keeps an append-only forensic record in `.plot/state/commit-records/YYYY-MM-DD.jsonl`, 30 days, pruned by `rm`. CLAUDE.md states the reasoning: *"the day is the unit ... pruning whole days is one `rm` rather than a rewrite."*

Same problem, same directory, already argued and shipped. Day-files give a bounded read, no rewrite, no lost append, no lock question, and no multi-key survivors problem — a whole day is dead for every key at once. **The plan never mentions it.**

### And a released plan already promised this

`docs/plans/2026-09-01-one-account-has-one-budget.md`, **State: Released, 2.13.0**, scoped the pruning into a slice and wrote that it *"cannot be deferred ... at most once per reset."* Verified. It shipped without it.

That is not an argument against doing it now. It is the reason the new plan must state what changed, and must restore the released plan's **time bound** — *at most once per reset* — which is the throttle `PRUNE_THRESHOLD = 100` was supposed to be and is not.

### 4 · The plan tells the next maintainer something untrue (concurrency)

Two items the juror would not drop:

**`budget_append`'s `|| true` does not "already tolerate" a lost line.** It swallows a *failed write*; it does not make a *lost* line detectable or accounted. The plan borrows the clause as cover for a different loss. Measured: one line per concurrent appender per prune — **~51 lines on the first prune** over a 20 MB ledger, under one per prune in steady state. Say that, rather than reusing a sentence that means something else.

**`plot-budget.sh`'s own header says the file never prunes.** A slice that makes it prune must amend the header in the same commit, or the file's documentation is false the moment it merges.

The measured append rate is **2586/hour**, not the 1160/hour `PRUNE_THRESHOLD` was sized against.

## The shared blind spot

**All three jurors, and the author, took `PLOT_BUDGET_OFF=1` as a clean measurement of the read cost.** It is not: it disables the appends and the slot logic as well. The 80% figure in the note attributes to the ledger a saving that includes at least `host_slot_take`'s sleep loop, which nobody has measured in isolation.

The measurement juror named this; the other two inherited the framing. **The plan's headline number is still unattributed**, and that is the one thing a re-measurement must settle before any code is written.

## What the moderation recommends

The plan is **not ready** and is **not dead**. The correction is structural rather than cosmetic:

1. **Fix the 119937 figure in the plan and the note.** It is published and wrong.
2. **Split the slice.** The read cost and the disk growth are two problems. The read side (bounded read, or day-files) is cheap, non-destructive and needs no rule. The disk side belongs in the domain.
3. **Give `survivors` its caller at the `spend-rate` seam.** `fleet.ts:1784` shells `plot-host.sh spend-rate` once per refresh — operator frequency, which `docs/shell-and-domain.md` §1 puts squarely in *call the domain*. That closes *"a rule exists and nothing calls it"* **in the place the rule lives**, and the multi-key correctness comes free.
4. **Re-measure without `PLOT_BUDGET_OFF`.** Separate the ledger's cost from the slot's.
5. **Answer `plot-budget.sh:11-15` by name** — the header that says truncation belongs to the port. Either rebut it in the plan and amend it in the same slice, or accept it and put the prune in the domain.

**Nothing is approved and nothing is dispatched.** The caller decides.
