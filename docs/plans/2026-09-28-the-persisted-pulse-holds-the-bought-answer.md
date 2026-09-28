# The persisted pulse holds the bought answer

> The board persists the **cheap** reading. The git pulse (local, re-derivable in seconds) survives a restart; the PR reading (remote, rate-limited, quota-bearing) lives only in memory and is re-fetched from scratch every start.

## Status

- **State:** Superseded
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1050
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1

## Changelog

- A board restart no longer re-buys every PR answer. The reading that costs quota survives; the one that is free is still derived.

Board impact: the first pulse after a restart carries PR state instead of showing none until the first fetch lands.

## Motivation

Measured 2026-09-28, `.plot/state/last-pulse.json` — 11 KB:

```
pulse keys:  main head read_ref local_head plans summary
a plan:      file phase slices
```

**Git facts, all of them.** No PR number, no state, no `mergedAt`. The persisted half is the half `plot-fleet-scan.sh` re-derives locally in about 3 s; the half that costs a rate-limited round trip per branch is not persisted at all.

### Why that is the wrong way round

The estate already holds the principle, in `a-decision-reads-the-index`:

> The index holds **bought answers** — a host's `mergedAt`, a PR's checks, an issue's state — which cannot be re-derived at any price. A **verdict** is re-derivable from git for free and stale the moment a ref moves.

And `fleet.ts:2173` refuses to persist a verdict: *"A persisted verdict would be a cache git cannot reach."* That is right. The pulse persists the verdict-shaped thing and drops the bought thing — the exact inversion of the rule one file over.

### The cost is a fleet that stops dispatching

A cold board re-fetches every PR. On an account near its limit that is the burst that returns `secondary`, and then every branch falls back to local evidence and **none is offered to `--next`**. So a restart can cost dispatch, not just latency.

## Design

### The rule

**The persisted pulse carries the host's answers; the git reading stays derived.**

`PrIndexStore` already exists, already holds exactly these answers keyed by head, and is already written by `fleet.ts`. **This plan does not add a store.** It makes the restart path read it, so a cold board starts with what the last warm one bought.

### Only a terminal answer is read back

`a-decision-reads-the-index` settles this and it applies unchanged: a `MERGED` row cannot revert on the host. `OPEN`, `CLOSED` and draft rows are stale in either direction and are re-asked. **A missing row means *ask the host*, never *no PR*** — the misreading that refused four fully-merged plans on 2026-08-27.

### What the slice must establish first

**Whether the gap is persistence or wiring.** The store exists and the board writes it; the open question is whether the cold-start path consults it before its first fetch, or fetches unconditionally. Those are different fixes:

- if it never reads the store on start → wire the read
- if it reads but the store was empty → the write path is the defect
- if it reads and the store is stale → `PR_INDEX_VERSION` handling

Measured on this machine earlier today: the live store read `v: 1` against `PR_INDEX_VERSION` 2, so **every read fell through to the host**. That may be the whole defect, and it is not what the issue describes. The slice measures before changing anything.

### What this does NOT do

- **It does not add a second store.** One writer, as today — a second racing writer is what `rename`'s atomicity cannot protect against.
- **It does not persist a verdict.** `fleet.ts:2173` stands.
- **It does not change the scan.** Git stays derived every pass.
- **It does not read a non-terminal row as authoritative.**

## Done when

- **The slice states which of the three causes it found**, with the measurement. This is the first deliverable, not a preamble.
- A board restarted with a populated store serves PR state on its first pulse, asserted against a fixture store.
- A missing or wrong-version store still asks the host, and a missing row is never read as *no PR*.
- Only `MERGED` rows are answered from; `OPEN`, `CLOSED` and drafts are re-asked, asserted per state.
- The host-call count on a cold start with a full store is measurably lower, asserted by counting calls rather than timing.

## Slices

### The persisted pulse holds the bought answer (Branch: bug/the-persisted-pulse-holds-the-bought-answer)

Measure which of the three causes holds, then wire the cold start to the store under the terminal-only rule.

## Notes

**The version mismatch measured today may make this cheaper than it looks.** A store at `v: 1` against a code expecting `v: 2` fails every read silently and correctly — the symptom is *the board re-fetches everything*, which is exactly what #1050 reports. If that is the cause, the fix is a migration or a re-fold, not new persistence.

Either way the rule is the same, and it is already written down: persist what was bought, derive what is free.


## Rejected, 2026-09-28

One juror, **reject**, **executed**. Moderation: `.plot/panels/2026-09-28-the-persisted-pulse-holds-the-bought-answer/panel.md`.

**The feature is on `main` and shipped six days before the issue was filed.** `seedPrsFromStore` (`packages/board/src/server/fleet.ts:2629`) reads the PR store into the entry's maps when the process holds nothing, called at `:2829` **before** the host call; the call that follows is already a delta through `prWindowFor` (`:2841-2848`). Built by `83c4abdc` and `09cf9018`, both 2026-09-22. Issue #1050 was filed 2026-09-28T20:26Z.

Every supporting measurement was false. The `v: 1` hypothesis this plan called *"may be the whole defect"* is dead — the live store reads `v: 2` against `PR_INDEX_VERSION = 2`, 988 rows, `complete: true`. The quoted pulse keys are the nested `pulse` object's rather than the file's. The `Done when` list describes `packages/board/test/unit/pr-store.test.ts`, 29 passing tests, line for line.

**The plan's Design section is persuasive because it describes `main` accurately.** The write path was read at `fleet.ts:2740` and the read path inferred absent — 90 lines away in the same file.

The three-way deferral to the slice was not diligence: all three causes are answerable by reading one file in under ten minutes, and deferring is what let a dead hypothesis reach a Draft.

**#1050 is rephrased rather than closed.** Its measurement of `last-pulse.json` is correct and its conclusion is not — PR answers are persisted in a different store. The narrow question that survives: the seed is a render optimisation and does not make the host call cheaper, which is still `--state all --limit 1000`.


## Superseded, 2026-09-28

By [`a-cold-bitbucket-board-buys-the-whole-list`](2026-09-28-a-cold-bitbucket-board-buys-the-whole-list.md), same issue (#1050).

**The reporter filed from a Bitbucket repository**, which neither this plan nor its panel knew. Every measurement here — and every one in the rejection — was taken against a GitHub checkout, where `--since` works and the window is honoured.

The defect that survives is not persistence. It is that the store's *second* job is unreachable on Bitbucket: `bb pr list` takes no query flag (`plot-host.sh:3741-3746`, verified against `bb 1.9.0`), so `prWindowFor`'s window is discarded and every refresh buys the full listing.

The rejection above stands for what this plan proposed. The successor proposes something else.
