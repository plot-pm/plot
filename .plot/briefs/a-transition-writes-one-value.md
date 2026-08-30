# Implementation brief — production-calls (Transitions)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on main
- **Branch:** `feature/a-transition-writes-one-value` (base: `main`)
- **Ends as:** one PR to main
- **Gated with the plan** — see the Delivering brief.

### What to build

A lifecycle transition writes one value, decided in the domain.

### The domain already describes writes without performing them

`workflows/decision.ts` exports a `Write` union of thirteen members —
`PlanPhaseWrite`, `PlanRecordWrite`, `PlanAnnotationWrite`, `HoldClearWrite`,
`SprintAnnotationWrite`, `IndexMoveWrite`, `PrReadyWrite`, `PrMergeWrite`,
`BranchCreateWrite`, `BriefWrite`, `WorktreeRemoveWrite`, `ManifestClearWrite`
and one more.

**A workflow decides *"these things should be written"* and returns a
`Decision`.** Who performs them is not its business — which is why the domain
touches the disk zero times, in either direction.

**So this slice is about the performing side**, and the shape it must not break:
a transition is one value, and the caller applies it.

### The measured defect this closes

**A phase flip without its record makes a plan invisible.** `plot-fleet-scan.sh`
shows delivered plans for a rolling window and reads that window from
`delivered_raw` — the record itself. Measured 2026-08-20: a plan flipped to
`Phase: Delivered` with no `Delivered:` line was filtered out entirely, and the
scan reported **zero** plans for it.

**Phase and record are one transition**, and writing one without the other is
the defect. That is what *"writes one value"* means.

### Done when

- a transition is decided in the domain and applied by one caller
- **phase and record are written together or not at all** — a test that flips
  one and asserts the other followed
- the old implementation is deleted in the same commit
- **`plot-approve.sh` and `plot-deliver.sh` stay idempotent** — each step tests
  the source it would have written, never a progress file, because step 2 writes
  irreversibly to the host and re-running is the repair

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:reconcile`,
`pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`), changeset with a
`bumps: skills:` block.

### Scope guard

Transitions. Not eligibility, not the refusals, not the spawning.

**Do not make a write atomic across the host boundary.** `PrMergeWrite` sits in
the same union as `PlanPhaseWrite`, but a merged PR cannot be rolled back if the
file write then fails. **Idempotent re-running is the design** — the scripts say
so, and it is why they test the source rather than a progress marker.
