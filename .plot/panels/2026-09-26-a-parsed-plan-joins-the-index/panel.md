# Panel — a parsed plan joins the index

**Reject.** Two lenses, both executed: architecture (reject), evidence (amend).

**The evidence juror reported late** — after this moderation was first written, and after a wait loop wrongly counted `panel.md` as a second verdict. Its findings are folded in below and they strengthen the reject rather than soften it.

## The premise is false: the scan already batches

`plot-fleet-scan.sh:2916` passes `"$@"` — every plan file in ONE invocation.

```
ALL 350 plans, one invocation:  481 ms      (verified by the moderator)
30 plans, one invocation each:  2762 ms     (92 ms each — matches the plan)
```

**The plan's measurement was honest and its inference was wrong.** 93 ms per plan is real for a call pattern the scan does not use. That cost is almost entirely per-process startup, and a batch pays it once.

So the optimisation is already built — and the plan cites `plot-fleet-scan.sh:3118` while the batching sits at `:2916` in the same file.

## The evidence lens found where the time actually goes

Every interpreter in one scan, wrapped and counted:

```
parser spawns  1  0.40 s     awk    377  (~1.2 s)
python3        1  0.36 s     grep    63
git           79             sed     10
                             node     1
total spawns 529  ≈ 2 s of startup
```

Three `--offline` runs: **21.01 s, 23.78 s, 28.19 s**. The moderator's own: **37 s**.

**~19 s of ~24 s is interpreted bash in `plot-fleet-scan.sh` itself** — no subprocess accounts for it, and `--offline` makes no host calls at all.

**The plan targeted ~1.7 % of the runtime while promising the 90 s bound.**

And the scan reports **`plans=27`, not 349**: `delivered_in_window` already discards the archive, so the frozen-plan filter recorded at `:3118` is working as designed.

## Two more findings the plan got wrong

**The purity risk is real and understated.** The plan named it as slice 1's question; the juror says it is worse than stated. Recorded for any future content-keyed design.

**`PrIndexStore` is not reusable for this subject.** The plan proposed it as the precedent and asked the slice to decide one mechanism or two. The juror's answer is two — the store is specific to PR rows.

## What survives

Nothing of the design. The blob-SHA key is sound in the abstract and solves a problem that does not exist here.

**What survives is the profiling**, now on #1017: the subject is the scan's own control flow, not its callees.

**#1017 stays open and now has one fewer explanation.** Ruled out tonight, in order: machine load (52 → 12, timeout persisted), the board's deleted marketplace path (real, separately fixed, `exit 127`), host latency (`backend` 1 s, `pr-list` 3–4 s), and now the plan parse (481 ms).

**Where the 90 s goes is still unmeasured.** A replacement plan profiles the scan before proposing anything.

## The pattern this makes three of

`the-board-updates-an-index`, `a-decision-reads-the-index` and now this one all proposed building something that already existed — `publishPartial`, `PrIndexStore`, and the batched parse. Each time: a real cost measured, a mechanism assumed, the file not opened.

The measurements were accurate every time. The inferences were not.
