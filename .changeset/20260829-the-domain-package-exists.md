---
'@plot-pm/board': patch
'@plot-pm/domain': patch
---

Plot's entity graph moves out of the board into `@plot-pm/domain`.

`FleetBranch`, `FleetWave`, `FleetPlan` and `FleetPulse` — with the four enums
they are built from (`BranchState`, `WaveVerdict`, `WorkerState`,
`WorkerActivity`) — leave `contract/schema.ts` for a new workspace package.
**547 lines, byte-for-byte**: the diff is the move and nothing else.

**They were never the board's.** A `FleetPulse` is `plans[] → waves[] →
branches[]` — Plan, Wave and Branch, already assembled, and assembled since the
pulse first had a schema. They were invisible as entities because they carry
transport names in a file called `contract/`. The work was not to build a
domain but to move the one that already existed somewhere it can be depended
on.

**A move, not a copy.** An earlier draft proposed building fresh entities
*beside* the pulse types and proving agreement with a corpus test. That creates
a third implementation of shapes that already exist twice, and then needs a
later plan to remove it. A move creates no duplication, so there is no window in
which two answers exist — and a corpus test would compare a thing to itself.

**A package rather than a directory, and the boundary is the whole reason.**
`contract/schema.ts` was already a pure domain layer — measured: one import
(`zod`), no disk, no process, no network — so `src/domain/` inside the board
would satisfy the same grep today. What it would not do is make the dependency
direction *enforceable*: a directory can import `../server/fleet.js`, and
eventually something will. A package cannot — the module resolver refuses, with
no grep to run and no reviewer to notice. A gate rather than a rule, which is
this repo's own doctrine.

**The board re-exports what it moved**, so all 53 importers keep their import
paths unchanged and the review reads as the move it is. Collapsing those
re-exports would touch 53 files for no behaviour change; it is a later,
separable decision.

**Nothing ships differently.** `@plot-pm/domain` is `private: true`. The board
declares zero runtime dependencies and bundles zod into its 1 MB artifact, so a
workspace package bundles identically — the published board is byte-for-byte
unaffected by where the domain lives. Publishing would only create a public API
Plot then owes compatibility to.

**What proves it: the board's existing tests, passing unedited.** No test was
edited. Both builds were exercised, because a workspace package that resolves
for one can still fail the other — the server bundles through esbuild, the
client inlines to a single file through vite, and a green server build is not
evidence about the artifact the browser loads.

**Coverage arrives as a gate, not a report.** `@vitest/coverage-v8` is wired
for the domain package alone at a 100% threshold that **fails the build** when
unmet — verified by making it fail, not assumed. 100% is defensible here and
nowhere else in this repo: the board spawns processes, binds ports and drives a
browser, and a threshold it structurally cannot meet is one that gets lowered
until it means nothing. The purity boundary leaves the domain no such excuse, so
an uncovered line is a line nobody specified.
