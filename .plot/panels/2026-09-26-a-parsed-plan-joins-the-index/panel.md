# Panel — a parsed plan joins the index

**Reject.** One lens of two reported.

**The evidence juror wrote no verdict.** It was briefed to re-measure every number and to test whether the parse is a pure function of the file's bytes; it is absent from the agent list and left no file. Its questions are unanswered, and the panel is recorded as one lens rather than two.

**That does not weaken the reject.** The architecture juror executed against a read-only brief and produced a measurement the moderator reproduced independently — 481 ms for all 350 plans in one invocation. A second juror could not un-measure it.

**It does leave one question open**: whether `plot-plan-meta.sh`'s output depends on anything but the file's bytes. That mattered only to the rejected design, so it dies with it — but any future plan keyed on content must ask it.

## The premise is false: the scan already batches

`plot-fleet-scan.sh:2916` passes `"$@"` — every plan file in ONE invocation.

```
ALL 350 plans, one invocation:  481 ms      (verified by the moderator)
30 plans, one invocation each:  2762 ms     (92 ms each — matches the plan)
```

**The plan's measurement was honest and its inference was wrong.** 93 ms per plan is real for a call pattern the scan does not use. That cost is almost entirely per-process startup, and a batch pays it once.

So the optimisation is already built — and the plan cites `plot-fleet-scan.sh:3118` while the batching sits at `:2916` in the same file.

## What survives

Nothing of the design. The blob-SHA key is sound in the abstract and solves a problem that does not exist here.

**#1017 stays open and now has one fewer explanation.** Ruled out tonight, in order: machine load (52 → 12, timeout persisted), the board's deleted marketplace path (real, separately fixed, `exit 127`), host latency (`backend` 1 s, `pr-list` 3–4 s), and now the plan parse (481 ms).

**Where the 90 s goes is still unmeasured.** A replacement plan profiles the scan before proposing anything.

## The pattern this makes three of

`the-board-updates-an-index`, `a-decision-reads-the-index` and now this one all proposed building something that already existed — `publishPartial`, `PrIndexStore`, and the batched parse. Each time: a real cost measured, a mechanism assumed, the file not opened.

The measurements were accurate every time. The inferences were not.
