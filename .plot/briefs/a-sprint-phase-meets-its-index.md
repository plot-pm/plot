## Implementation brief — a-sprint-phase-meets-its-index (slice: The index and the phase agree)

- **Plan (canonical):** `docs/plans/2026-09-06-a-sprint-knows-when-it-ended.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `bug/a-sprint-phase-meets-its-index` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 2 of four. Slice 1 merged as **#728** — the delivery gate now names what it gates on, so adding a scan section no longer risks the marker.

## The defect

**Two records of *is this sprint running*, disagreeing.** Measured 2026-09-06: `docs/sprints/active/` held exactly one symlink — `the-domain-owns-the-lifecycle` — while that file's `Phase:` read **`Planned`**.

**It has happened twice in four days, in both directions.** `2026-W35-the-board-tells-the-truth-in-every-section` carried `Phase: Active` while not being in the index at all. Neither was caught by anything; both were found by a person reading the directory.

## What to build

**A new section in `plot-reconcile-scan.sh` reporting a sprint whose `Phase:` disagrees with `docs/sprints/active/`.**

**A NEW SECTION, NOT AN EXTENSION OF `sprint_drift`.** That counter counts **plans** whose `Sprint:` disagrees with the sprint file. This is a fact about the **sprint file itself**, which nothing currently reads. Folding them would give a reader one number answering two questions.

**IT GATES NOTHING.** Section 7's precedent: `index_drift` is *"convenience and gates nothing — a missing link is a browsing gap while a dangling link is still a broken pointer."* A sprint's index is the same shape.

**#728 removed the positional constraint.** The gate no longer stops at a literal `== 7.`, so a new section can sit where it belongs rather than after everything.

## The footer

The scan's footer is machine-countable and every section has a key. This one joins it — and **CLAUDE.md's section table gains the row**, since it was already one behind when this plan was written (it said twelve; the scan emitted thirteen).

## Testing

`pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **and the domain's own `tsc`** — the board typecheck does not cover `packages/domain`, and CI's separate step has caught that twice today.

**The estate currently has zero instances** — the `Planned` sprint was corrected by hand when the plan was written. So the test needs a fixture: a sprint in the index with a non-Active phase, and one Active without a symlink.

## Done when

- the scan reports a sprint whose phase and index membership disagree, naming both
- it gates nothing
- the footer carries its key and CLAUDE.md's table carries its row
- a fixture proves both directions
- the gates above pass

## Do not

- **Do not extend `sprint_drift`.** It counts plans; this counts sprints.
- **Do not gate on it.** Section 7 is the precedent.
- **Do not derive the phase.** A sprint is a commitment, and slice 3 explains why a shipped release closes nothing by itself.
- **Do not run `pnpm run test:e2e`** locally. CI is its gate.
