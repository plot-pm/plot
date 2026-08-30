# Implementation brief — the-sprint-proves-its-own-goal (Reporting)

- **Plan (canonical):** `docs/plans/2026-08-30-the-sprint-proves-its-own-goal.md` on main
- **Branch:** `infra/the-board-says-how-far-adoption-got` (base: `main`)
- **Ends as:** one PR to main
- **Independent of the other two slices.** Smallest of the three.

### What to build

A CI step printing how many board files reach the domain. **It fails on
nothing.**

Measured 2026-08-30: **2 of 36** files in `packages/board/src/server/` import
`@plot-pm/domain`.

### Why it cannot be a gate, and the step must say so

A threshold here fails on work that is not a regression:

- a refactor that **merges two files** lowers the count and improves the code
- a file that **imports without calling** raises it and proves nothing

**It measures file layout, not adoption.** So it is a number a human reads for
trend, and the step's own comment has to say that — otherwise the next person to
see it fall will assume something broke.

### Keep it separate from the gates

The other two slices ratchet and fail. **This one must not sit in the same step**
as either: a report and a gate together teach a reader that the number is
enforced.

### Done when

- the number appears in every run's output
- **no threshold, no failure path** — the step exits 0 whatever it reads
- the step's comment states why it is a report and not a gate
- it is its own step, not appended to a gate

**The trap:** making it *slightly* a gate — failing if it drops to zero, or
warning below some number. Any failure path turns it into the thing the plan
argues it must not be.

Plus: `pnpm test`, and the step runs green on `main` unchanged.

### Scope guard

One printed number. Not a badge, not a trend file, not a board view — those are
features, and this is a line in a CI log.
