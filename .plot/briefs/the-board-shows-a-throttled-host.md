# Implementation brief — a-throttled-host-says-so (Rendering)

- **Plan (canonical):** `docs/plans/2026-08-29-a-throttled-host-says-so.md` on main
- **Branch:** `bug/the-board-shows-a-throttled-host` (base: `main`)
- **Ends as:** one PR to main
- **Depends on the Reporting slice.** The payload field it renders does not
  exist until that lands.

### What to build

The board renders the degraded state, beside the existing `prError` treatment.

### The decisions the plan settles — do not re-derive them

**There is already a treatment for this shape.** `prError` is how the board says
*the host could not be asked about PRs*, and a throttled scan is the same
category of fact. Put the new notice beside it rather than inventing a second
visual language for "we do not know".

**Keep `prError`'s raw text.** A browser test enforces that the age suffix is
**appended** rather than replacing `${fleet.prError}` — if you touch that path,
do not lose the original message.

### Done when

- a pulse carrying `host=throttled` renders the notice
- **a pulse without it renders exactly as today** — byte-identical where you can
  assert it, visually unchanged where you cannot

**The second is the one that catches an accident.** Most pulses do not carry the
field, so a renderer that quietly changes their layout would pass a test written
only for the new case.

**A vacuous pass to avoid:** asserting the notice exists in the DOM without
asserting it is *visible* and carries the reason. A hidden element satisfies
`toContain` and tells an operator nothing.

Plus: `pnpm run test:board`, `pnpm run typecheck`, the artifact rebuilt
(`pnpm build:board`), changeset (`'@plot-pm/board': patch`).

### Scope guard

The render. Not the scan, not the host adapter, not what `throttled` means — the
Reporting slice settles all three.

**Board browser tests load the built artifact**, so rebuild before running them;
a stale artifact fails reassuringly.
