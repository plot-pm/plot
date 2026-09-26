# A decision reads the index

> **`PrIndexStore` shipped on 2026-09-25 and has no consumer.** Port, file adapter, fold rule, versioned entity, and a live 967-row store on this machine — and all five references to it are its own implementation. Meanwhile the fleet scan, the reconcile sweep and `impl-status` still ask the host directly. A tool call should write the index and nothing else; a decision should read it, or run because it changed.

## Status

- **State:** Approved
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1008
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1
- **Approved:** 2026-09-26, Jan Wloka, in-session after panel (round 1)
- **Started:** 2026-09-26, Claude (plot-implement), `infra/the-index-has-its-first-consumer`

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

### The index exists and nothing reads it

`PrIndexStore` is a port (`ports/pr-index.ts:37`) with a file adapter (`adapters/pr-index/pr-index-file.ts:69`), a fold rule (`rules/pr-index.ts:82`) and a versioned entity. On this machine:

```
.git/.plot/state/index/github.json   351082 bytes
v: 2 | connector: github | rows: 967 | watermark: 2026-09-26T12:50:20Z
```

It was delivered by `a-merged-pr-is-not-asked-for-its-checks` (#1005).

**Measured 2026-09-26 — every reference to it, across both packages:**

```
packages/domain/src/ports/pr-index.ts          the port
packages/domain/src/adapters/pr-index/…        the adapter
packages/domain/src/rules/pr-index.ts          the rule
packages/domain/src/index.ts                   a barrel export
packages/domain/src/adapters/index.ts          a barrel export
```

**Five references, five of them its own implementation. Zero consumers.**

And the scripts that need exactly what it holds still ask the host: `plot-fleet-scan.sh` (28 mentions of `pr-list`/`pr-state`), `plot-reconcile-scan.sh` (6), `plot-impl-status.sh` (6).

**This is the estate's own named defect class.** CLAUDE.md: *"Where a rule exists and nothing calls it, that is a defect to report."* It records `setSprintState` as the precedent — nine refusals, zero callers, an hour lost to a hand-written sprint the rule would have refused.

### An earlier draft got this wrong in both directions

It proposed **building** an index that had shipped the day before, and led with **"35 spawn sites across three deciders."** Measured:

```
dispatch.ts:356   spawnSync(
deliver.ts:529    spawn(
approve.ts:295    spawn(
```

**Three, not thirty-five** — the rest were the import line and prose, the same `grep`-matches-as-call-sites error that had already sunk this plan's predecessor.

Worse, those three are **performances, not retrievals**: `deliver.ts:529` spawns the delivery agent. A spawn that performs an action has no answer to write to an index, so the rule this plan states does not describe them.

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

### Where it lives — settled, because it shipped

An earlier draft left this open with three candidates. **It is answered**: a port with a file adapter, writing plain JSON under the git common dir. `PrIndexStore` made that choice and the store exists.

The plan's job is no longer to choose a shape. It is to find out whether the shape chosen serves the consumers that need it — which is what a first consumer measures.

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

Three, and the first is the one that matters.

### The index has its first consumer (Branch: infra/the-index-has-its-first-consumer)

**One** script moved from asking the host to reading `PrIndexStore` — `plot-impl-status.sh`, chosen because it has the fewest host calls (6) and the narrowest question (*did this plan's PRs merge?*), which the store answers directly.

It proves the store serves a real consumer before anything larger depends on it, and it answers the question the shipped store has never been asked: **can a shell script read it without a running board?** The file is plain JSON under `--git-common-dir`, so the answer is probably yes, and *probably* is what this slice replaces.

### A decision reads rather than asks (Branch: infra/a-decision-reads-rather-than-asks)

The second consumer, chosen after the first has shipped. `plot-reconcile-scan.sh` (6 calls) or `plot-fleet-scan.sh` (28) — the slice names which and why, with the first slice's experience in hand.

### The rule is written down (Branch: docs/the-rule-is-written-down)

**Only after two consumers exist.** The rule — *a tool call writes the index; a decision reads it or is triggered by it* — goes into CLAUDE.md beside the layering rule, with the consumers as its evidence.

**Written last deliberately.** A rule stated before anything follows it is the shape this estate has measured repeatedly: `setSprintState` had nine refusals and zero callers, and the rule in prose did not stop a master agent writing the field by hand.

## Notes

The predecessor `the-board-updates-an-index` is Rejected, and its panel moderation is worth reading before this one is built: four of five jurors read rather than ran, and the one that executed overturned the plan's justification. The cost claims in that plan were wrong in every row; this plan does not repeat them and does not lead with cost.
