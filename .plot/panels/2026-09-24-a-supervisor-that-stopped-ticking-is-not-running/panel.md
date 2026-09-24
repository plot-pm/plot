# Panel moderation — a supervisor that stopped ticking is not running

**Reconciliation: `unanimous amend` — estate, evidence, operator, manifesto.**

Four jurors, four commitments, no hedges. The plan's *mechanism* is verified word for word. Its *motivation* is refuted.

## What is verified, and strongly

**Estate confirms the central claim literally.** `:356` is the running arm, three lines, no tick reading. `:374-382` is the adjacent arm, carrying the tick-age block and the "evidence and never the verdict" comment the plan quotes. The two are branches of one `if`, and a supervisor with a live pid provably cannot reach the second. *"One branch over"* is exact.

**And nothing else on the estate reads it.** `git grep registryd.log` over the skills, scripts and both packages returns five hits and **exactly one reader** — the arm above. The gap the plan names is the only gap.

## The refutation: the harm claim is false, and the plan's own numbers say so

The evidence lens did not merely doubt the causal story; it showed the plan's two measurements are **mutually inconsistent**.

- The three agents' pid files are written **Sep 23 14:10**.
- The supervisor's log, on the plan's own reading, went silent at **Sep 23 11:01** — three hours *earlier*.

**A daemon that stopped before the agents existed cannot be what stopped handing those agents work.** They were never in a world where it was ticking for them.

The positive explanation is in the same log: **547 ticks read `agents=3 … idle=3` and handed nothing**, with `no-free-agent=0` on 986 of 987 ticks. Every held slice is held `not-claimable`, plus one `no-brief`.

**Verified by the moderator**: 547 such ticks, **zero** with `handed>0`; pid files at 14:10:23–14:10:24.

So the agents starved because the estate had **no claimable work**, which is the supervisor working correctly. The plan took two adjacent facts and wrote a cause between them. That is this repo's named recurring error — a small sample written as a property — committed by the plan that quotes the rule.

**What survives**: the tick timeline itself. The log still holds `cost=2478705ms` and the seven prior ticks in order, so *the tick completed and nothing followed* is established from the surviving file rather than the lost mtime. The plan's disclosure about the moved mtime is honest and stays.

## The operator amendment: the fix lands where nobody was looking

`--status` is not the surface an operator visits. The **board** is, and it already:

- spawns `plot-fleetctl.sh --status` every refresh (`supervisor-reading.ts`)
- renders a four-state supervisor banner at `alert` prominence (`FleetControls.tsx:354`, from `AgentList.tsx:1178`)

A shell line alone puts the fix on the one surface nobody visited the night this happened. The operator lens asks for a **second slice carrying the tick age to the board** — the first slice ships as written, but must not ship alone and be called done.

## The disagreement the moderator does not average

**Evidence and operator pull in opposite directions on the threshold.**

- The plan refuses a threshold: a healthy busy tick can be 49 s.
- Operator asks whether *"last tick: 90061s ago (evidence, not the verdict)"* reads as alarming at 2am, or as one more number.

Both are right about their own question. The resolution is not a compromise threshold: it is that **a number on a page a person must visit is a weak signal whatever its wording**, which is the operator's point, and **a shell script is the wrong place to judge staleness**, which is the plan's. Carrying the reading to the board — where a domain rule already decides prominence — satisfies both without inventing a cutoff in shell.

## The disposition

**Amend before building.** The slice is correct and small; the plan around it is not. Specifically: strike the causal claim and replace it with what the log shows, keep the tick timeline, and add the board slice the operator lens asks for.
