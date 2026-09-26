# A decision reads the index

> Retrieval and decision are interleaved: every controller calls its own tools and judges in the same breath. **35 spawn sites across three deciders** — `dispatch.ts` 10, `deliver.ts` 15, `approve.ts` 10. A tool call should write the index and nothing else; a decision should read the index, or run because the index changed.

## Status

- **State:** Draft
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1008
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 0

## Changelog

- Data retrieval and decision-making are separated. A tool call updates a shared index and returns nothing a decider reads directly; a decision reads the index, or is triggered by an index update. The same answer serves every consumer instead of being bought once per asker and thrown away.

Board impact: structural. The board becomes an index reader like every other consumer, and stops being the only component that accumulates anything.

## Motivation

**The rule this plan exists to establish:**

```
tool call ──writes──► index ──read by──► decision
                        └────triggers────┘
```

A decision never calls a tool. It reads the index, or it fires because the index changed. Nothing else is permitted to be a decision's data source.

### What happens instead, measured 2026-09-26

| decider | spawn sites |
|---|---|
| `deliver.ts` | 15 |
| `dispatch.ts` | 10 |
| `approve.ts` | 10 |

Each retrieves and judges in one pass. The answers are not shared, not kept, and not reusable: the next decider asks again.

### The estate is already ratcheting toward this and is stuck

`ci.yml:333` counts spawn sites outside adapters — `allowed=28`, target **0**. Its own comment names why it cannot reach zero:

> **A RATCHET AT NINE, NOT A REFUSAL.** Seven of the nine are lifecycle commands no port answers yet, and inventing seven ports to clear a gate is the gate driving the design.

**That is this plan's gap.** The ratchet is not stalled on effort; it is stalled on a missing destination. There is nowhere for a decider to read from, so removing its spawn would leave it unable to decide. An index is the one seam that answers all seven at once.

### This is not the plan the panel rejected

`the-board-updates-an-index` proposed a **client-side accumulator so rendered rows stop vanishing**. A panel refuted it: `publishPartial` (`fleet.ts:3242`, PR #242) already composes a partial scan over the previous answer, so the render was never losing rows for the stated reason.

**That refutation does not touch this plan**, and the reason is measurable: `entry.pulse` is referenced in **exactly one file** (`fleet.ts`, 31 references) and nothing outside it can read it. It is a render buffer for one consumer, held in memory, for display.

An index is the opposite on every axis: **many writers, many readers, and the decisions read it rather than the screen.** The rejected plan proposed a second display buffer; this proposes the seam the deciders lack.

### What the coupling costs

Four consumers ask the host the same questions and share nothing — the fleet scan, the reconcile sweep, `impl-status`, and the supervisor's queue rule, which needs `landed`, *"the host's `mergedAt`"* (`queue.ts:51`).

**But cost is the smaller argument and this plan does not lead with it.** A panel measured the earlier plan's cost table and found it wrong in every row — `grep -c` counts including comments, against 6, 2 and 4 real call sites, most already bundled. The saving is real and unquantified, and it is a consequence rather than the reason.

**The reason is that a decision made from a freshly-bought answer is untestable and unrepeatable.** It depends on what a host said at that instant, which no test can reproduce and no second reader can check. A decision that reads an index is a function of recorded state.

## Design

### The rule, in three parts

1. **A tool call writes the index and returns nothing a decision consumes.** Its output is the write. A caller wanting the answer reads the index afterwards.
2. **A decision reads the index and spawns nothing.** This is the property the CI ratchet already counts, given somewhere to read.
3. **A decision may be triggered by an index update** rather than polling. The supervisor's tick and the board's poll both become index subscriptions rather than scan invocations.

### What the index holds

**Answers, never verdicts.** The distinction is the estate's own and it is load-bearing: `fleet.ts:2173` refuses a persisted verdict — *"A DERIVATION, NEVER A RECORD … A persisted verdict would be a cache git cannot reach."*

A verdict is re-derivable from git for free and stale the moment a ref moves. An answer is **bought** — a host's `mergedAt`, a PR's checks, an issue's state — and cannot be re-derived at any price. The index holds the second kind only, so every verdict is still computed fresh from indexed answers.

**`PLOT_TERMINAL_CACHE` is the precedent and its three properties are adopted whole** (`plot-fleet-scan.sh:1234`):

> **THE VALIDATION IS THE FEATURE.** Every arm here is a question to git, asked on every pass, and any disagreement discards the entry rather than repairing it.

- an entry records what a tool said, never what a rule concluded;
- every entry carries what it was read against, and is revalidated on read;
- an answer that could not be obtained is **not an entry** — absence stays absence, and an unreachable host never becomes a recorded fact.

### Where it lives

**Open, and deliberately so.** The candidates differ in what they claim:

- **In the domain as readings** — matches `reap(readings, input)`, keeps the core synchronous, and makes the index the caller's to supply. The estate's existing shape.
- **Behind a port** — an adapter writes, the domain reads. Fits the layering rule directly but adds async to a core that has none.
- **A file under `.plot/state/`** — reachable by shell consumers with no running board, which `plot-ask.mjs` exists to preserve. Also the shape most able to go stale unnoticed.

**A slice decides this with the three named and argued**, not by picking one here. The wrong choice is recoverable in code and not in a plan that asserted it.

### What this does NOT do

- **It does not add a client-side accumulator.** That plan was rejected and this does not revive it. `publishPartial` stays as it is.
- **It does not cache verdicts.** Only bought answers, revalidated on read.
- **It does not put the index behind HTTP.** A shell consumer must not depend on a running board — `plot-ask.mjs` exists for that reason, and seven skills would gain a dependency whose failure arrives on a worker's machine and not the operator's.
- **It does not change what any decision decides.** Every rule keeps its logic; only its data source moves.
- **It does not clear the CI ratchet in one slice.** Seven lifecycle commands need the seam before their spawns can go, and doing them together is the change nobody can review.

## Done when

- A named decider reads its inputs from the index and has zero spawn sites.
- The CI spawn ratchet falls, and its comment no longer names that decider's scripts as portless.
- An entry that could not be obtained is absent rather than recorded, proved by a test with an unreachable host.
- A stale entry is discarded on read rather than repaired, proved by moving the ref it was read against.
- Two consumers asking the same question in one pass produce one tool call.

## Slices

Three, and the first decides the shape the other two build on.

### The index has a home (Branch: `infra/the-index-has-a-home`)

Decide among the three candidates above with the argument written down, then build the store and its two properties — revalidate on read, never record an unobtainable answer. No decider changes; the store is proved alone.

### A decider reads the index (Branch: `infra/a-decider-reads-the-index`)

**One** decider, chosen for having the fewest spawn sites, moved to read the index. Its spawns go; the CI ratchet falls by that count. One is the slice, because the second is a repetition and the first is the design.

### The index serves the shell consumers (Branch: `infra/the-index-serves-the-shell`)

**The open slice.** The fleet scan, the reconcile sweep and `impl-status` are shell, and they must reach the index without a running board. `plot-ask.mjs` is the precedent — the controller reached without HTTP — and its answer may not transfer, because that artifact answers questions and an index is state. Not specified here.

## Notes

The predecessor `the-board-updates-an-index` is Rejected, and its panel moderation is worth reading before this one is built: four of five jurors read rather than ran, and the one that executed overturned the plan's justification. The cost claims in that plan were wrong in every row; this plan does not repeat them and does not lead with cost.
