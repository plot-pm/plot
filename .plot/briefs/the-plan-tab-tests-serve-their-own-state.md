## Implementation brief — a-browser-test-serves-its-own-state (slice 4: Moving the plans)

- **Plan (canonical):** `docs/plans/2026-08-31-a-browser-test-serves-its-own-state.md` on `main`
- **Branch:** `infra/the-plan-tab-tests-serve-their-own-state` (base: `main`)
- **Ends as:** one PR to `main`

**Fourth, and the first slice that moves a test.** Needs the catalogue from Naming.

### What to build

Migrate the board/Plans-tab files onto named scenarios. The smaller half, and
the one whose payload (`/api/board`) is simplest.

### Candidates — confirm against the Survey's table first

By `/api/board` use, measured 2026-08-31: `tiny-garden` (13 tests),
`plan-source` (9), `branch-served` (2), `stuck-rows` (15, board+fleet), plus the
`/api/board`-side files the Survey classifies as catalogue candidates —
`story-overlay` (12), `not-started-plans` (14), `unplanned-issues` (11),
`one-grid` (8), `folded-plan-pr-fold` (7), `split-plan-counts-elsewhere` (4).

**The table outranks this list.** `tiny-garden.browser.test.ts` in particular is
a judgement the Survey makes — it reads a fixture repo on purpose, and whether
that is a real-server test or a catalogue scenario is exactly what the plan
refuses to decide by grep.

**Do not migrate a file the Survey marked "must stay real".** Six carry write
routes (`approve`, `button-claims`, `double-click`, `fleet-settings`, `spinner`,
`start-work-refusal`); a mock that accepted a write would assert nothing.

### A migration is not a deletion

**The counts are asserted, not reviewed.** `EXPECTED_FILES` and
`EXPECTED_TESTS` in `stubbed-tests-start-no-board.test.ts` must be updated in
**this commit**, against the main this branch sits on — not by arithmetic on the
figure the branch was cut from. That mistake has already happened once: a branch
carried 473 while main had moved to 479, and the tripwire fired for a reason
that had nothing to do with the migration.

If a test's assertion has to change to work against a named state, the changeset
says which test and why. Silent rewording is how a migration loses coverage
while every gate stays green.

### Use the builders, never a literal

`row()`, `wave()`, `card()`, `fleet()`, `board()` `.parse()` through Zod. A raw
literal cast to `Fleet` is structurally valid to `tsc`, never validated, and is
how `unreachable-overlay` shipped a fixture with no `waves` array that rendered
no action menu.

**Expect to find fixtures that were always incomplete.** The real server was
supplying what they omitted. Each find is a result for the changeset.

### Record the override ratio

The plan's scenario-count gate is measured after the NEXT slice, and it needs
this slice's data: for each migrated test, how much of the payload it overrides.
State the average in the changeset.

### Done when

- Every file this slice migrates serves its own state and starts no board.
- The gate passes without a `@needs-real-board` declaration for any of them.
- Counts updated in this commit; assertion count unchanged except where the
  changeset names an addition.
- The override ratio is stated.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`,
  `pnpm test`, changeset. Node 24 (`nvm use`).

### Scope guard

Plans-tab files only. `agents-tab.browser.test.ts` is two slices away and
`/api/fleet`-heavy files belong to the next one.
