# Implementation brief — the-controller-answers-every-asker (slice 3: Mocking)

- **Plan (canonical):** `docs/plans/2026-08-30-the-controller-answers-every-asker.md` on main
- **Branch:** `feature/the-mock-is-an-adapter` (base: `main`)
- **Ends as:** one PR to main
- **Depends on slice 2's controller existing.** A mock adapter written first is
  verified against nothing.

### What to build

Mock adapters for `PlanStore` and `Refs`, on the **driven** side. The mock board
constructs them. `PLOT_BOARD_MOCK` keeps working and is implemented **through**
them rather than beside them.

### The decisions the plan settles — do not re-derive them

**The mock belongs on the driven side.** It is an adapter like any other: the
same port, a different world behind it. That is what lets a mock board serve a
real controller with no controller code knowing a mock exists.

**The env var stays one global per process, and that is a known limit.** An
earlier draft asserted *"two tests hold different estates at once"* and the plan
**withdrew it** — `PLOT_BOARD_MOCK` cannot deliver that, and asserting it would
have shipped a done-when that fails on its own design.

**What the slice actually buys is an escape from the variable**, not its
removal: construct the adapters directly and the env var stops mattering.

### Done when

The plan's list, and read the second one carefully:

1. a mock board serves the first controller with **no controller code mentioning
   the mock**
2. **a test that constructs adapters directly is unaffected by
   `PLOT_BOARD_MOCK` whatever its value**

**Assertion 2 is the one that discriminates.** Write it so it fails if the
adapters secretly consult the variable: set `PLOT_BOARD_MOCK` to a value that
would change a mock-reading code path, construct the adapters by hand, and
assert the answer is the one the adapters were built with.

**A vacuous pass to avoid:** a test that constructs adapters and never sets the
variable proves nothing. Set it, to something that would matter.

Plus: `pnpm test:board`, `pnpm run typecheck`, artifact rebuilt, changeset
(`'@plot-pm/board': patch`).

### Scope guard

Two ports — `PlanStore` and `Refs`. Not the other five. Not the controller
(slice 2 owns its shape; you consume it). Not the entry point (slice 4).

If serving the controller from mocks reveals something wrong with the
controller's shape, **report it rather than adjusting the controller here** —
that shape is a contract two other slices are building against.
