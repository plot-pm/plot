## Implementation brief — a-browser-test-serves-its-own-state (slice 5: Moving the agents)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/the-agents-tab-tests-serve-their-own-state` (base: `main`)
- **Ends as:** one PR to `main`

**Fifth. The fleet-side files, EXCLUDING `agents-tab.browser.test.ts` itself.**

### What to build

Migrate the `/api/fleet` files onto named scenarios. `/api/fleet` carries rows,
waves, agents and summary, so this is where the scenarios are exercised hardest.

### Candidates — confirm against the Survey's table

By `/api/fleet` use, measured 2026-08-31: `activity-mark` (24 tests, 3 routes),
`worker-log` (15, 4), `group-activity` (15, 2), `row-withholds` (16, 1),
`command-copy` (8, 2), `wave-name-in-cell` (3), `wave-in-working` (2),
`wave-head-says-its-verdict` (2), `stuck-row-alignment` (4),
`working-shows-every-agent` (5).

**Three of these bypass `startServer` and spawn `board-server.mjs` by hand** —
`agent-panel-links`, `command-copy`, `worker-log`, named in the gate's own
docblock. They will not be caught by a `startServer` grep alone; the gate checks
three spellings and so must you.

**Not `fleet-settings`** (write routes) or the other five write-route files,
unless the Survey reclassified them.

### THE RATIO GATE FIRES HERE

The plan makes this a **hard stop**, not an observation:

> if the average test overrides more than half the payload, the scenarios are
> wrong — and that measurement is a gate. The third slice does not start until
> the catalogue is re-cut.

So: measure the override ratio across this slice AND the previous one. **If it
exceeds half, stop and re-cut the catalogue before `agents-tab` is touched.**
Migrating 111 more tests onto scenarios that already do not fit is how the
fixture sprawl this plan exists to remove gets rebuilt under a better name.

Re-cutting is not failure — it is the gate doing its job, and it is far cheaper
here than after the largest file in the suite has been moved onto the wrong
shapes.

### A migration is not a deletion

Update `EXPECTED_FILES` / `EXPECTED_TESTS` in **this commit**, against the main
this branch sits on. Any assertion that had to change is named in the changeset.

**Use the builders, never a literal** — `fleet()` especially. The known failure
is a raw literal cast to `Fleet` missing its `waves` array: valid to `tsc`,
never `.parse()`d, renders no action menu.

### Done when

- Every file this slice migrates serves its own state and starts no board,
  including the three that spawned the artifact by hand.
- The override ratio is measured across slices 4 and 5 and stated; if it exceeds
  half, the catalogue is re-cut and that work is named.
- Counts updated in this commit.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`).

### Scope guard

**`agents-tab.browser.test.ts` is NOT in this slice.** It is 111 tests on its
own branch, and it inherits a catalogue this slice proves.
