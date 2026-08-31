## Implementation brief — a-browser-test-serves-its-own-state (slice 3: Naming)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/the-catalogue-names-the-states-the-suite-needs` (base: `main`)
- **Ends as:** one PR to `main`

**Third. Needs the Survey's classification and the Deciding slice's gate.**

### What to build

The scenarios the classification calls for, added to
`packages/board/test/catalogue/states.ts`. **No file moves; the deliverable is a
catalogue that can express the suite.**

### Where the catalogue stands

Three scenarios today — `a-done-wave`, `an-eligible-wave`, `an-empty-estate` —
against 365 tests in 33 files that need states. The pieces are
`test/catalogue/{build,index,mock-board,states}.ts`; `mock-board.ts` serves
`/`, `/api/board` and `/api/fleet` and 404s the rest, with no refresh timer, no
estate scan, no git.

### A scenario earns its name from the state it describes

Not from the file that first wanted it. The failure this guards against is 33
subtly different descriptions of one board wearing a new spelling — which is the
fixture sprawl the plan exists to remove.

**Use the builders, never a literal.** `row()`, `wave()`, `card()`, `fleet()`,
`board()` take `Partial<…>` and `.parse()` through Zod, so a stale field name
fails at compile time and a wrong shape fails at serve time. A raw literal cast
to `Fleet` does neither — that is precisely how `unreachable-overlay` came to
render no action menu with a structurally valid, `waves`-less fixture, and it
cost two agents most of an evening because a real server had been quietly
supplying what the fixture omitted.

### Serving the whole state will expose incomplete fixtures — that is the value

Expect each slice to find some. A fixture that renders nothing is a test that
was asserting nothing; only the real dependency was hiding it. Treat each find
as a result to record, not an obstacle.

### The ratio gate — this slice sets up the measurement the next one applies

The plan makes the scenario count a **gate**: after the second migrating slice,
if the average test overrides more than half the payload, the scenarios are
wrong and the third migrating slice **does not start** until they are re-cut.
Leave the catalogue in a shape where that ratio can actually be computed —
overrides should be visible per test, not buried in a helper.

### Done when

- Every state the Survey's table names is expressible by name.
- The states `agents-tab` needs are among them, though that file migrates last.
- Builders throughout; no raw literal cast to a contract type.
- **A named scenario, changed in one place, changes what every test using it
  sees** — the plan's third `Done when`, and it is asserted by changing one and
  watching dependents fail, not by reading the code.
- `EXPECTED_FILES` / `EXPECTED_TESTS` updated in this commit if they moved.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`).

### Scope guard

The catalogue only. **No browser test file changes** — if a scenario cannot be
written without editing the test that will consume it, that is a finding for the
migrating slice, not a licence to start migrating here.
