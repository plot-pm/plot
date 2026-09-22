# Panel moderation — an unread status is not a sick fleet

**Subject:** `docs/plans/2026-09-22-an-unread-status-is-not-a-sick-fleet.md`
**Commitment:** `Position: proceed|amend|reject`
**Reconciliation:** `unanimous` — `amend=measurement,design,estate`. **3 of 3 gated. Nobody said proceed or reject.**

## Three lenses, three routes, one conclusion the plan did not consider

| Lens | Evidence | Position |
|---|---|---|
| measurement | **14 timed runs at the plan's own load** | amend |
| design | **Read `--status` line by line and timed its two halves** | amend |
| estate | **Tabulated every budget in the codebase and how each was chosen** | amend |

**Nobody said reject, and that is a finding.** The symptom is real: a healthy fleet reported as `unknown` is a false alarm, and `FLEET_SCAN_BUDGET_MS`'s own header supplies the argument for acting — *"a fixed budget below the loaded cost fails INTERMITTENTLY, which is the worst shape."* Something must change. What must not change is the number.

## The measurement does not reproduce

Fourteen runs at load 8.3–8.6 — the plan's own busy-machine condition — including six forced concurrent:

```
2157  1903   869  1348   838  2579  1801   874   ms
six concurrent: all 2117 ms
max of 14: 2579 ms          budget: 5000 ms
```

**The 5724 ms outlier does not reproduce in fourteen attempts.** The plan's other two readings (1780, 2345) sit inside this range and reproduce fine.

And the estate is now **larger** than the plan measured — 19 agents, not "a dozen desks" — and still under half the budget.

**Three samples is not a distribution.** One of the three was the outlier, so *"the measured worst case here"* is a sample of one. The plan builds its whole fix on it.

## The cost is not inherent, and that is the finding

The plan's central design claim is *"that is inherent to the question."* Measured false:

| lines | work | cost |
|---|---|---|
| 341–401 | platform, supervisor loaded, pid, `install_state` | **75 ms** |
| 440–470 | walk every desk, `plot_worker_state` per desk, `stat` per log | the rest |

**`install_state` — the one field the board's rule consumes beyond the exit code — is fully assigned above the desk loop.** The script's own comment says so: *"THE EXIT CODE COMES FROM THE CAPTURE, NEVER FROM A FRESH PROBE."*

So the board waits for a per-desk walk whose output it discards, and the answer it wants is ready in 75 ms. **A raised number buys back a defect that a flag removes outright.**

## The estate has written doctrine on this, and it points the other way

`FLEET_SCAN_BUDGET_MS`'s header is the precedent:

> *"90 s is HEADROOM over a 34-52 s cost, not cover for a 279 s one. It was refused twice while the scan was 279 s, because a budget raised to fit a 9x overrun hides the next regression instead of reporting it… when it lands this can come back down."*

**The estate's rule is: a budget may be raised to cover honest variance, and must not be raised to cover work that should be removed.** The scan's budget was held at a refusal until the cost was batched down. This plan proposes the opposite order — and unlike the scan's, this cost is removable in one flag.

**And the 5 s was not a guess.** The plan calls it *"a guessed one"*; the docstring at `:42-49` records 1.42 s measured on a 27-worktree fleet, 3.5x headroom, plus a refresh-cadence argument. The plan should contest that reasoning rather than characterise it as unconsidered — and the cadence half is what constrains any new number.

## The plan's factual errors

- **The timeout path is not what the plan says.** `:126` is not where the wrap is; the measurement juror read it.
- **`"walks a dozen desks"`** — it is 19.
- **`"a guessed one"`** — the value carries a recorded derivation.

## What the moderation recommends

**Amend, and change the reading rather than the budget.**

1. **Split the reading.** `--status` already computes the board's answer in 75 ms before the desk walk. A flag that stops there — or a second verb — gives the board what it consumes at 1/30th the cost, and the intermittent-failure shape disappears rather than being accommodated.
2. **If a budget still moves, derive it.** Fourteen runs, a percentile, and the refresh-cadence argument the original engaged. Not one outlier.
3. **Correct the three factual claims** before this is approved. A plan that misstates where a wrap is, how many desks there are, and how a constant was chosen will be read by whoever implements it.
4. **Keep what is right:** the refusal to retry, the refusal to quiet `unknown`, and the three must-not-breaks. All three jurors endorsed those.

**Nothing is approved and nothing is dispatched.** The plan is Draft and stays Draft.
