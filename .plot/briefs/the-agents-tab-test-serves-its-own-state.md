## Implementation brief — a-browser-test-serves-its-own-state (slice 6: The big one)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/the-agents-tab-test-serves-its-own-state` (base: `main`)
- **Ends as:** one PR to `main`

**Sixth. One file, 111 tests — a third of the work.** Deliberately last.

### What to build

Migrate `packages/board/test/integration/agents-tab.browser.test.ts` onto the
catalogue the four slices before it proved.

### Why it is last, and what that buys you

It routes `/api/fleet` **14 times** and reads `/api/board` exactly once, as
`route.abort('connectionrefused')` — a deliberate transport-failure test. Its
own comment says a real `/api/board` *"takes seconds, so this is the ordinary
case"*. That mixture makes it the file most likely to need scenarios the earlier
slices produced.

Migrating it first would have meant inventing every scenario at once under the
pressure of the largest file. By now the catalogue has been proven against the
248 tests the earlier slices moved, and the ratio gate has already passed on
that evidence.

**The Survey enumerated the states this file needs, back in slice 1.** Start
there rather than re-reading 3999 lines cold.

### The count, precisely

**111** `it(` under the gate's comment-stripped count. The plan's prose says
117, counting comments — use **111**, because that is what the gate asserts and
a mismatch here reads as deleted tests.

### The one thing the catalogue cannot serve

That single `/api/board` route is `route.abort()` — a board that **cannot
answer**. The catalogue serves states; it does not serve absence. Keep that as a
`page.route` interception layered over a served baseline, the pattern
`unreachable-overlay` demonstrates. Do not attempt a scenario for it.

The gate's own predicate already understands the distinction: `suppliesPayload`
splits on the route call and reads the handler, so `abort` is told from
`fulfill`. Under an earlier, cruder predicate this file counted as fully stubbed
and the gate demanded a migration that would have replaced a real dependency
with a fixture — 3999 lines and 114 tests, to satisfy a false positive. Do not
re-create that error from the other direction.

### A migration is not a deletion — least of all here

A third of the suite's assertions ride on this file. Update `EXPECTED_FILES` /
`EXPECTED_TESTS` in **this commit** against the main this branch sits on. Every
assertion that had to change is named in the changeset, with why.

**Use the builders, never a literal.** `fleet()` carries rows, waves, agents and
summary; a literal missing `waves` is valid to `tsc` and renders no action menu.
This file has fourteen chances to make that mistake.

### Done when

- `agents-tab.browser.test.ts` serves its own state and starts no board.
- The `abort` case stays an interception over a served baseline.
- 111 tests still present and passing; counts updated in this commit.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`).

### Scope guard

This file only. If it needs a scenario the catalogue lacks, add it here and say
so — but a catalogue needing substantial new shapes at this point means the
ratio gate in slice 5 passed on thin evidence, and that is worth reporting.
