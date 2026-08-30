# Implementation brief — the-board-decides-nothing (The pulse)

- **Plan (canonical):** `docs/plans/2026-08-30-the-board-decides-nothing.md` on main
- **Branch:** `feature/the-pulse-derives-in-the-domain` (base: `main`)
- **Ends as:** one PR to main
- **Depends on Verdicts and Phases** for the shape and the payload assertion.

### What to build

`deriveWaves` and `doubleClaimedBranches` become domain functions.
**`pulseShrink` is argued in the PR and moved only if the argument holds.**

### Why these are judgements

`deriveWaves` groups slices into cohorts — a statement about **Slices**.
`doubleClaimedBranches` finds a conflict between two plans — a statement about
**Plans**. Neither is a rendering concern, and both sit in the view layer.

### `pulseShrink` is the hard case, and it is named so it gets argued

**Dropping fields from an oversized payload is a transport decision.** *Which*
fields may be dropped without lying is a statement about what a Slice means.

**The PR must say which half is which**, and a decision either way is a finished
slice. What is not acceptable is moving it silently because it was in the same
file.

### The clock is not in this slice

**Settled 2026-08-30:** the pulse is the system's master clock and runs on a
machine — `the-pulse-is-an-entity` owns that. **This slice moves derivations
over a pulse; it does not move the beat.**

If you find the derivations need to know *when* a pulse happened, that is a
finding for the PR and a dependency on that plan — not a reason to move a timer.

### Done when

- both derivations are domain functions with the board calling them
- **the pulse contract is unchanged** — same values, different path
- **the PR states, for `pulseShrink`, which half is transport and which is
  meaning**, and what was done about it
- the board payload is unchanged byte for byte

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, artifact rebuilt,
changeset.

### Scope guard

Two derivations and one argued decision. Not the timers, not the caches, not the
rate limiting.

**`deriveWaves` has a live consumer with a known subtlety:** `AgentList.tsx`
decides a wave's section, and `waveGroupsFor` lives there rather than in
`fleet.ts`. **A move that changes grouping order changes the board's sections** —
the payload assertion catches it, which is why it is byte for byte.
