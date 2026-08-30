# Implementation brief — the-board-decides-nothing (Phases)

- **Plan (canonical):** `docs/plans/2026-08-30-the-board-decides-nothing.md` on main
- **Branch:** `feature/a-phase-is-a-domain-rule` (base: `main`)
- **Ends as:** one PR to main
- **Depends on Verdicts** for the shape.

### What to build

`rowPhase` and the plan-status derivations become domain rules.

### The assertion that is specific to this slice

**A phase asked of the domain gives the same answer the board gave, for every
plan in `docs/plans/`** — asserted against the **real estate**, not a fixture.

**Why the real estate:** this repo holds ~100 plans in every phase, with
annotations written by hand over months. A fixture covers the shapes someone
thought of; the estate covers the ones that happened. Two of today's parser
defects — `plot-plan-meta` reading only the `→ #N` form, a plan with no `Phase:`
field at all — were found in real files, not in tests.

**A corpus comparison is the tier for this**, and the domain package already has
one: `packages/domain/corpus/`.

### Done when

- `rowPhase` and the plan-status derivations are domain rules at the package
  threshold
- `fleet.ts` and `board.ts` hold no copy
- **every plan in `docs/plans/` gets the same phase from both**, asserted as a
  corpus test
- the board payload is unchanged byte for byte

**The trap in a corpus test:** it passes vacuously if it silently skips files it
cannot parse. **Assert the count** — *N plans compared, and N is the number of
plan files* — or a parser that drops half the estate looks like agreement.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`, artifact rebuilt,
changeset.

### Scope guard

Phases. Not the verdicts (previous slice), not the pulse derivations (next).

**`Phase` is a plan-format concept and `plot-plan-meta.sh` is its parser.** If
the rule and the script disagree about a plan, **the script is the contract** —
report the difference rather than reconciling it here.
