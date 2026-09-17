## Implementation brief — a-withdrawn-plan-is-not-open (wave: A withdrawn plan is not open)

- **Plan (canonical):** `docs/plans/2026-09-16-a-withdrawn-plan-is-not-open.md` on `main`
- **Approved:** 2026-09-17, jwloka, in-session
- **Branch:** `bug/a-withdrawn-plan-is-not-open` (base: `main`)
- **Ends as:** one PR to `main`

Single-slice plan. Nothing waits on this branch and it waits on nothing.

### What to build

`rules/phase.ts:140`'s `default:` arm answers `draft`/`open` for a plan somebody
rejected or superseded, so the estate counter reports withdrawn plans as
outstanding work. Add a case for both phases, add `withdrawn` to
`PlanStatusSchema`, and count it in `estateTotals`.

### The arithmetic is DECIDED — do not re-open it

**A fourth bucket, and `total` keeps counting every plan.** Dropping withdrawn
from `total` was weighed and refused: the estate total would stop being the plan
count.

The field reaches `SprintCountsSchema`, `formatCounts` (`SprintFilter.tsx:65`,
four hardcoded terms), the THREE-BUCKETS docstring, and the **sprint** rows that
share the renderer — `fleet.ts:6804` builds the same four keys.

**What is NOT decided, and is yours**: the fourth term's LABEL on screen. The
panel's four lenses all read the server and none asked what the word should be.

### Two enum declarations, not one

`rules/phase.ts:25` and `contract/schema.ts:352` both declare
`PlanStatusSchema`, deliberately. **Both need the member**, and nothing will
fail to compile if you miss one: measured, there is no `Record<PlanStatus, …>`
anywhere.

### The gate is a FIXTURE, not the live census

Assert over a fixture estate of known composition — three withdrawn plans, two
live. **Do not key a gate to this repository's numbers**: measured 2026-09-16
they read `open: 11`, and one day later `open: 12, wip: 4`.

A withdrawn plan renders **no card at all** (`toBoardPhase` answers `null`,
`board.ts:1956` skips it), so nothing on the board moves — only the counter.

### Repo gates

`pnpm run test:contracts`, `pnpm run test:board`, `pnpm run typecheck`.
