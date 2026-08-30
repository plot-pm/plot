# Implementation brief — a-ui-test-needs-data-not-a-board (the mock board)

- **Plan (canonical):** `docs/plans/2026-08-28-a-ui-test-needs-data-not-a-board.md` on main
- **Branch:** `infra/the-mock-board-serves-named-states` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** The catalogue has to exist before tests can read from it.

### What to build

A catalogue the mock owns, and a test asks for a state **by name**. It serves
the page too, so routing stays real.

### The census, re-measured 2026-08-30

```
browser tests                     43
asserting rendered UI             43
stubbing /api/* with page.route   39
importing a shared fixture         0
starting a server                 42
```

**Every test builds its own state inline**, and 42 of 43 spawn a full board to
do it.

### Start from the precedent that already exists

**`tuple-row.browser.test.ts` starts no server.** It bundles the component with
`esbuild` and renders it in isolation — the only test in the suite already doing
what this plan proposes.

**The plan files it in the wrong list**, among eleven "end to end" tests it
keeps as smoke tests, and mentions `esbuild` zero times. That was a
miscategorisation, corrected in the plan on 2026-08-30.

**So read it first**, and say in the PR why the mock-server design departs from
it — the departure may well be right (routing stays real, which a bundle cannot
give you), but it should be argued rather than assumed.

### Done when

- a test names a state and gets it, with **no board server**
- the mock serves the page, so routing is real
- **an existing browser test can be pointed at the catalogue without changing
  what it asserts** — demonstrate on one, do not migrate the suite

**That last one is the proof the shape works.** A catalogue nothing consumes is
a fixture module, and the census says there are already zero of those.

Plus: `pnpm run test:board`, `pnpm run typecheck`, artifact rebuilt, changeset
(`'@plot-pm/board': patch`).

### Scope guard

The catalogue and the mock. **Not the migration** — that is the second slice,
and doing both at once means a reviewer cannot tell a broken catalogue from a
badly-moved test.

**Do not touch the six real smoke tests.** The plan's list of eleven was wrong
by five (four stub the API, one starts no server); the honest set is six, and
they stay end to end.
