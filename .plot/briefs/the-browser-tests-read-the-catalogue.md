# Implementation brief — a-ui-test-needs-data-not-a-board (Moved)

- **Plan (canonical):** `docs/plans/2026-08-28-a-ui-test-needs-data-not-a-board.md` on main
- **Branch:** `infra/the-browser-tests-read-the-catalogue` (base: `main`)
- **Ends as:** one PR to main
- **Depends on `infra/the-mock-board-serves-named-states`.** There is nothing to
  read from until the catalogue exists.

### What to build

The fully-stubbed browser tests take their state from the mock instead of
spawning a board.

### The population, measured 2026-08-30

**The plan says 35; it is 39.** Counted in `packages/board/test/integration/`:

```
stub /api/* with page.route        39
start a server                     42
BOTH — this slice's population     39
```

**Derive it yourself rather than trusting either number.** It has moved once
already and the migration should be aimed at what is there when you run it.

### The decisions the plan settles — do not re-derive them

**Their assertions do not change.** These tests are the UI suite and their
subject is correct: whether the board renders a given state. What changes is
where the state comes from — a named catalogue entry instead of an inline stub
plus a spawned server.

**The six real smoke tests stay end to end.** The plan listed eleven; a check on
2026-08-30 found four of them stub the API and one (`tuple-row`) starts no
server at all. **The honest set is six**, and they are the check that a real
scan produces a payload the real client can render.

### Done when

The plan's list, and the first is a gate rather than a claim:

- **no fully-stubbed browser test spawns `ARTIFACT`** — asserted **by grep**, so
  it cannot regress silently
- **the suite's assertions are unchanged** — asserted by a green run, not by
  reading the diff

**The second is where this slice can go quietly wrong.** A migration that
"fixes" an assertion while moving it has changed what the suite proves, and the
diff will look like mechanical work. If an assertion genuinely cannot survive
the move, that is a finding for the PR — not an edit to absorb.

**A vacuous pass to avoid:** the grep gate passes trivially if you also delete
tests. Assert the **count** of browser tests is unchanged beside it.

**Expect the suite to be flaky under load.** Board integration tests fail in
batches on main too — nine failures on main against six on a branch was measured
2026-08-30 under the same 82-file parallel run. **Baseline main before believing
a failure is yours**, and run a failing file alone.

Plus: `pnpm run test:board`, `pnpm run typecheck`, artifact rebuilt
(`pnpm build:board` — browser tests load the built artifact, and a stale one
fails reassuringly), changeset (`'@plot-pm/board': patch`).

### Scope guard

The 39 fully-stubbed tests. Not the six smoke tests, not the catalogue (the
first slice owns its shape — you consume it), not `tuple-row`, which needs no
board and is the precedent this plan was built from.

If the catalogue cannot express a state one of the 39 needs, **report it** —
that is a gap in the first slice, not a licence to leave a server behind.
