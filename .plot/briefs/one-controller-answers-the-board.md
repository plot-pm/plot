# Implementation brief — the-controller-answers-every-asker (slice 2: Asking)

- **Plan (canonical):** `docs/plans/2026-08-30-the-controller-answers-every-asker.md` on main
- **Branch:** `feature/one-controller-answers-the-board` (base: `main`)
- **Ends as:** one PR to main
- **Depends on slice 1** having freed the word `controllers/`. The other two
  slices depend on the shape you settle here — write it as the contract it is.

### What to build

The first controller: fleet state, the question `/api/board` and `/api/fleet`
both serve. It lives in `packages/board/src/server/controllers/`, **not** in the
domain package.

Then `/api/board` becomes parse → call → serialise.

### The decisions the plan settles — do not re-derive them

**Why the controller is in the board and not the domain.** *"A controller knows
about requests and callers; the domain must not."* That knowledge of *being
asked* is exactly what the purity gate keeps out of `packages/domain/src`. The
seven driven ports (`PlanStore`, `Refs`, `Host`, `Processes`, `Trees`, `Clock`,
`Machine`) are world → domain and all exist on main as of #530; the controller
is the other direction.

**It is not HTTP.** Typed arguments in, typed result out. HTTP is one caller,
the master agent is another, a test is a third. That is what slice 4 depends on.

**The route still translates and enriches.** Measured 2026-08-30, `/api/board`
is not a thin call: its handler spreads **ten `*Availability(HOST)` flags** onto
the payload — `approve`, `commission`, `continue`, `deliver`, `dispatch`,
`drop`, `idea`, `implement`, `reslice`, `story`.

> The plan says *five*, written when there were five. Ten is the count on main
> today, and the number will keep moving — so **derive it, do not transcribe
> it.** Whether the enrichment belongs in the controller or stays in the route
> is yours to settle, and it is the one design question this slice really owns:
> slice 4 needs an answer that is meaningful without a `server`, so a flag that
> only makes sense to a browser argues for staying in the route.

### Done when

The plan's list: `/api/board` contains no estate access of its own; the
controller is callable from a test with **no server and no `host` argument**;
the origin check exists once rather than four times; the board payload is
**unchanged byte for byte**.

**The payload assertion is what makes the rest safe.** Everything here is a
move, so any difference in what the browser receives is a defect — and the board
is a surface somebody is watching while this lands.

**How to assert it credibly:** capture the payload before your change and after,
and diff. A test asserting individual fields passes while dropping one nobody
listed.

Plus: `pnpm test:board`, `pnpm run typecheck`, artifact rebuilt, changeset
(`'@plot-pm/board': patch`).

### Scope guard

One controller, one route reduced. Not `/api/fleet` (it asks the same question —
pointing it at the controller is fine if free, but it is not the assertion), not
the other 17 routes, not the mock (slice 3), not the entry point (slice 4).

**Do not migrate the 65 server-starting tests.** The plan defers them
explicitly, with the risk stated: a controller layer whose tests still go
through HTTP has paid for the seam without collecting on it. That is a separate
plan.
