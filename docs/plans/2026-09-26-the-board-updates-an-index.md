# The board updates an index

> The client replaces its whole fleet with every payload, so a row absent from one arrival is erased from the screen. The scan takes 18 s and the poll is 4 s, so a partial arrival is the ordinary case — and the server already says `complete: false` when it sends one. Measured 2026-09-26: two live agents' slices were missing from the board while WORKING showed both agents.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Issue:** #1008
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 0

## Changelog

- The board accumulates what it receives into an index and renders the index. A row the latest answer did not mention keeps what was last known about it, instead of disappearing until a later pass happens to include it.

Board impact: **entirely board, and entirely client-side.** No scan change, no domain rule, no new server field — the payload already carries everything this needs.

## Motivation

**Received data should land in an index, and the board should render the index.** It does neither. `App.tsx:283` is the only `setFleet` call site and it replaces the whole fleet with whatever arrived, so the rendered set is exactly the last payload's `rows` array. There is nowhere that *what is known* is distinct from *what just arrived*.

### The server already answers partially, on purpose

`fleet.ts:898`:

> A scan takes 18 s on 84 branches, so for most of that window the answer is genuinely partial — which is a fact about the answer, not a defect in it.

And it says so, in a field added for exactly this:

> `claimed: 0` and "no pulse yet" must not render identically, and neither must **"no plans left" and "the rest have not arrived"**.

**Scan 18 s against a 4 s poll**, so a poll landing mid-scan is the ordinary case rather than an edge. The field reaches the client as `complete` on every payload, beside `ageSeconds`, `generatedAt` and `readRef`.

**It has zero readers in `packages/board/src/app/`.** The server states the answer is incomplete; the client renders it as whole.

### What it produced, measured 2026-09-26

Two agents were working. The board showed **both agents in WORKING** and **neither of their slices** — WAITING ON A MACHINE held one row, NOT STARTED read `none`. Both rows returned on a later poll.

```
free-ebbb37c6  bug/a-wave-says-which-question-it-answered   pid 99861  live
free-83d3325b  feature/the-board-filters-to-my-work         pid 34787  live
```

### The outage was not the cause, and the first reading of this said it was

A *"Not reaching the board server"* banner was on screen, so the connection looked responsible. It was not: nothing on the failure path removes a row. `App.tsx:290`:

> The fetch did not reach the server. **Keep the last good fleet on screen** — it is still the best information available, and blanking it would destroy what the reader came for.

`setFleet` is never called on failure. **A partial payload landed, then the fetches began failing, and the failure path faithfully preserved the partial view.** The banner froze a screen that was already missing rows, which is why the outage appeared to cause what it had only kept.

**This matters beyond the diagnosis**: the failure path is already correct. It keeps what it has. The defect is that what it has was destroyed one poll earlier, by a successful response.

### It is a third route to a wrong section

Section selection is a domain property and holds at any time. Three independent routes broke it, and this is the one no rule fix reaches:

| route | where | state |
|---|---|---|
| `branch-state.ts:264` classifies wrongly | domain | plan written (#1002) |
| a stale scan re-derives sections | server | shipped (#999) |
| **classified correctly, never rendered** | **client** | **this plan** |

## Design

### The rule

**The board updates an index from each heartbeat; the client renders the index.**

A payload is an *update*, not a *replacement*. Each arriving row is merged into the index by branch; a row the payload does not mention keeps what the index already held.

`branch` is the key — present on every row, stable across passes, and how the estate identifies a slice everywhere else.

### When absence means removal

**A row's absence is evidence only when the answer claims to be whole.** `complete: true` means the scan reached its terminal line, so a branch the index holds and the payload omits is genuinely gone — reap it from the index. `complete: false` means the rest has not arrived, and absence says nothing at all.

That is the same distinction `pulseComplete` was added to preserve on the server, carried one layer further instead of being dropped at the boundary.

### A held row says what it is

A row carried from an earlier pass is not the same claim as a row just measured, and the board must not present them identically — the failure this repo has measured repeatedly. The payload already carries `generatedAt` and `ageSeconds`; an index entry keeps the one it was last updated by, so a held row can show its own age rather than the fleet's.

**It keeps its section.** It was classified correctly when it was measured, and nothing since has said otherwise — re-deriving would be the mistake `a-stale-pulse-keeps-the-sections-it-had` already settled.

### What this does NOT do

- **It adds no server field and changes no scan.** `complete`, `generatedAt`, `ageSeconds` and `readRef` are all already on the wire. A plan that needed a new field would be evidence the diagnosis was wrong.
- **It does not change the failure path.** Keeping the last good fleet on an unreachable server is correct and stays exactly as it is.
- **It does not re-derive a section client-side.** The index stores what the server decided; it never recomputes it. A component deciding a row's section is what CLAUDE.md forbids.
- **It does not touch `/api/board`.** That endpoint polls at 30 s and carries artifacts, which move in days. The partial-answer problem is the fleet's.
- **It does not make the index survive a reload.** Nothing is persisted; the index is in memory and a reload starts cold, which is honest — a cold board already renders nothing rather than guessing.

## Done when

- A payload with `complete: false` that omits a known row leaves that row on screen, in its section.
- A payload with `complete: true` that omits a known row removes it.
- A held row is distinguishable from a freshly measured one, by its own age.
- The failure path still keeps the last good fleet, unchanged.
- A test drives two successive payloads — a complete one, then a partial one omitting half its rows — and asserts nothing vanished.

## Slices

### The board updates an index (Branch: `bug/the-board-updates-an-index`)

The index, the merge keyed by branch, the `complete`-gated removal, and the two-payload test above.

## Notes

The first reading of this blamed the client-side outage and was published on #1008 before being refuted by `App.tsx:290`. The correction is on the issue. What made the difference was checking the poll interval — 4 s against a banner reading *"last heard 6s ago"* — which ruled out the rows never having been received and forced the question of what a successful response had done.
