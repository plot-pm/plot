# Implementation brief — production-calls (Eligible)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on main
- **Branch:** `feature/one-eligibility-rule-decides` (base: `main`)
- **Ends as:** one PR to main
- **Gated with the plan** — see the Delivering brief.

### What to build

Slice eligibility decides in one place. `plot-fleet-scan.sh` and the board stop
each having their own answer.

### Why this rule in particular

**Eligibility drives dispatch.** `--next` uses it to hand a worker its branch,
and the board uses it to render what is startable. **Two implementations of
*"may this slice start?"* is the shape that dispatches work twice or not at
all.**

### Done when

- one rule, in `packages/domain/src/rules/`, at the package threshold
- **`--next` and the board agree on every slice in `docs/plans/`**, asserted
  against the real estate
- the old implementation is deleted **in the same commit**

**The assertion needs the estate, not a fixture.** This repo holds ~100 plans
with waves, deferred branches, cross-repo PR annotations and plans with no
`Phase:` at all. **A fixture covers what someone thought of.**

**And it must count what it compared.** *N slices compared, N equal* — a
comparison that silently skips unparseable plans passes vacuously, which is the
defect this repo has now found four times.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:reconcile`,
`pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`), changeset with a
`bumps: skills:` block.

### Scope guard

Eligibility. Not deliverability, not the refusals, not the spawning.

**`--next` is a claim mechanism, not just a query.** A worker acts on its answer
immediately by pushing a ref. **A wrong answer here starts real work on the
wrong branch** — which is why the estate-wide agreement assertion is the gate
and not a nicety.
