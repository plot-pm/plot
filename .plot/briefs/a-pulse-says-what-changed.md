## Implementation brief — a-pulse-says-what-changed (slice: The delta is a domain rule)

- **Plan (canonical):** `docs/plans/2026-09-05-a-pulse-says-what-changed.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `feature/a-pulse-says-what-changed` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of three. Slice 1 merged as **#730** — the pulse now writes its own record, so history accumulates without a board.

## HALF OF THIS EXISTS. EXTEND IT, DO NOT WRITE BESIDE IT

**`rules/pulse.ts` already exports `readingLoss(previous, incoming, previousAt)`**, called from `fleet.ts:1126`. It answers three of this plan's design questions **identically**:

| the plan says | `readingLoss` already does |
|---|---|
| readings as values, no I/O | `(previous, incoming, previousAt)`, no port |
| a first run is not a failure | *"A FIRST READING LOSES NOTHING … reporting that as a shrink announces a loss on every start"* |
| name what changed, do not count it | *"NAMED rather than counted … 3 plans became 2 makes the reader open a terminal to find out which"* |

**What it does not do is the whole remaining plan.** It reports **losses** — plans and branches the previous reading held and this one does not.

## The three the story names, and nothing else

**A PR merged, a worker died, a plan became deliverable.** Those are **gains and transitions**, none of which a shrink can express — a plan that merged and a plan that became unreadable both leave the reading, and only one is news.

**Chosen by the story, not by the data.** The bridge carries every slice verdict, every branch state, `ages`, `approvedAt`, `ideaPlans`. Diffing all of it produces a report where three branches each advancing one step print three lines nobody reads. **A fourth gets added when someone names the one they wanted and could not see.**

## FOUR OUTCOMES, NOT TWO

`changed`, `unchanged`, `first run`, `history unusable`.

**A first run is a normal state** — nobody has pulsed here yet, which is where every new adopter starts.

**An expired or version-mismatched pulse is a different fact:** there WAS history and it cannot be used. `BRIDGE_MAX_AGE_MS` is 15 minutes (`pulse-bridge.ts:70`); `:193` returns null on a version mismatch.

**Neither may render as *nothing changed*.** A quiet estate and an unreadable history look identical to a reader and mean opposite things.

## Shape

**Readings as values.** No port, nothing awaited. The caller reads `last-pulse.json` — which the scan now writes — and the rule compares.

**Arrow functions**, purity gate holds, TSDoc says what an export does rather than why it was decided.

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **and the domain's own `tsc`** — the board typecheck does not cover `packages/domain`, and CI's separate `Domain typecheck` step has caught that gap twice today.

Four outcomes, four tests. `readingLoss`'s existing tests must keep passing — a rewrite that needs them edited is a rewrite, not an extension.

## Done when

- the delta reports the story's three transitions
- `first run` and `history unusable` are distinguishable, and neither reads as `unchanged`
- `readingLoss` keeps its behaviour and its tests
- the rule performs no I/O
- the gates above pass

## Do not

- **Do not open a second file beside `rules/pulse.ts`.** Two functions over two readings disagreeing about a first read is the drift this repo keeps measuring.
- **Do not diff every field.** Three transitions, named by the story.
- **Do not collapse the four outcomes.** A first run is not a broken history.
- **Do not make the rule read the bridge.** The caller reads; the rule compares.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
