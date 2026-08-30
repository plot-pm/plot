# Implementation brief — the-exclusion-names-what-it-hides (Measuring)

- **Plan (canonical):** `docs/plans/2026-08-30-the-exclusion-names-what-it-hides.md` on main
- **Branch:** `infra/the-adapters-are-measured` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** The Covering slice needs a number to shrink against.

### What to build

`src/adapters/**` leaves the blanket exclusion in
`packages/domain/vitest.config.ts`. Each remaining entry names **one path and
its reason**. Thresholds are set to what the suite actually reaches.

### The numbers, already measured

Taken 2026-08-30 by lifting the exclusion in place, setting thresholds to zero,
and running the existing suites — **no new tests**:

```
All files                94.00 lines  82.80 branches

src/adapters/run-script  100.00       85.00
src/adapters/machine      93.33       85.71
src/adapters/plan-store   90.90       50.00
src/adapters/trees        87.50       72.22
src/adapters/processes    70.00       58.33
src/adapters/refs         65.51       40.00
src/adapters/host         57.50       12.24
src/adapters/clock        50.00        0.00
```

**Reproduce them before you change anything.** They are the baseline the PR has
to state, and a number you did not take yourself is a number you cannot defend
in review.

### The existing comment is right and must survive

`vitest.config.ts:32-43` argues the exclusion, and the argument is not laziness:

> *100% is defensible for the pure side precisely because the purity boundary
> makes every line reachable from a plain function call — an adapter has no such
> guarantee. Its uncovered branches are the ones that need a host to fail, a disk
> to be full, or a process to die at the wrong moment, and **a threshold that
> forces those to be faked teaches people to fake them**.*

**That warning is the thing to preserve.** The sprint goal does not ask for
100% on adapters; it asks that what stays excluded be *"named rather than
assumed"*. A threshold set above what honest tests reach produces exactly the
faked coverage the comment predicts.

It also names two protections that are **not** coverage numbers and stay
unchanged: the purity-except-adapters grep, and the corpus tests that compare
adapter readings against production's. **Do not weaken either**, and do not
present coverage as replacing them.

### Done when

- no blanket `src/adapters/**` exclusion
- **every remaining entry names one path AND its reason** — an entry without a
  reason is a defect, because that is the assumption in a longer form
- `pnpm --filter @plot-pm/domain test` green with thresholds that **hold on a
  clean run**, not on a lucky one
- the PR states the numbers before and after, so the ratchet has a start

**No new tests in this slice.** It reports what exists. Mixing measurement with
new coverage means a reviewer cannot tell which number came from which — and the
interesting fact here is precisely that four test files were already exercising
adapters into a report nobody could see.

**The threshold trap:** setting it to today's exact number makes the next honest
refactor red. Leave a small margin and say what it is; a threshold that fails on
unrelated work gets deleted, not met.

Plus: `pnpm test`, `pnpm run typecheck`, changeset (`'@plot-pm/board': patch`
does **not** apply here — this is the domain package; use the form its own
changesets use).

### Scope guard

The config and its comment. Not the tests, not the adapters, not the two
outliers — `host-shell.ts` and `clock-system.ts` belong to the Covering slice
and are the reason it exists.
