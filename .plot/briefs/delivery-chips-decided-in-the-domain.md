## Implementation brief — delivery-chips-and-waiting-on-you (wave: Chips)

- **Plan (canonical):** docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md on main
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2490 merged
- **Branch:** `bug/delivery-chips-decided-in-the-domain` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plot-review gate on main)

This branch is wave "Chips" of a three-wave plan. It does not touch
`waiting-tickets.ts` or the `Waiting on you` counts — that is wave "Waiting on
you" (`bug/waiting-on-you-counts-visible-rows`), a separate branch with no file
overlap with this one. Nothing here blocks it or waits on it.

### What to build

Three defects in the chip row, all in `packages/domain/src/rules/chip-row.ts`,
`packages/domain/src/rules/sprint-selection.ts`, and the board component that
renders them (`packages/board/src/app/components/DeliveryFilters.tsx` /
`AgentList.tsx`):

1. **The per-sprint chips hardcode `hiddenCount: 0`.** `DeliveryFilters.tsx:135`
   builds each per-sprint chip's `Chip` object inline — `{ label: sprint.title,
   on, hiddenCount: 0, disabledReason: null }` — instead of asking `chipRow()`.
   `chipRow`/`ChipRowReadings` (`chip-row.ts`) has no notion of "one chip per
   sprint" today; it returns exactly three chips (`thisSprint`, `mine`,
   `waitingOnMe`). This needs a fourth shape in the domain — one chip per
   Active sprint, each with its own hidden count — computed from readings, not
   left for the component to default to zero.

2. **The `This sprint` chip counts against every Active sprint, not the
   current selection.** `AgentList.tsx:716-733`: `chipRowReadings.sprint.
   visibleRows` maps `fleet.rows` through `rowInSprintSelection(r,
   allSprintSlugs, membership)` — `allSprintSlugs` is every Active sprint's
   slug, never `selectedSprints`. The comment at `AgentList.tsx:714-721`
   argues this is deliberate: the `This sprint` chip's own click stays
   all-or-nothing, so its count answers "what would an all-or-nothing toggle
   hide", not "what does the current narrower selection hide". The plan
   (`DeliveryFilters.tsx:135` row, Motivation bullet 1) calls this a defect:
   "the filter uses the current selection". Resolve the tension before
   coding — the two readings are not reconcilable by a cleverer formula, one
   of them has to be what `This sprint`'s hidden count means now. The Design
   section's intent (`chipRow` decides every chip's hidden count "computed
   from the current selection") says the second reading is the target; if
   that changes the chip's observable behaviour when a narrower selection is
   active, say so in the PR body rather than leaving it implicit in a diff.

3. **`rowInSprintSelection` contradicts its own TSDoc.** `sprint-selection.
   ts:87-107`: the doc says "True when the selection is empty (every Active
   sprint counts) and the row is in any Active sprint" but the code only
   checks `slugPassesSprintFilter`, which returns `true` unconditionally on an
   empty selection (`sprint-selection.ts:46`) — it never checks "is in any
   Active sprint" at all. A row whose plan is in NO Active sprint currently
   passes on an empty selection; the TSDoc (and the plan, Motivation bullet 2)
   says it should not. Fix `rowInSprintSelection` so an empty selection hides
   a row that belongs to no Active sprint, keeping `rowIsSprintExempt` rows
   (`release`, plan-less `pr`) passing unconditionally as today.

4. **The `Mine` chip is enabled with an identity ownership never matches.**
   Issue #2476's finding on `chip-row.ts:72` (`identityOf`): the chip enables
   on `gitEmail` as a fallback identity, but the ownership rule (`isMine`,
   `ownership.ts`) the chip's own `hiddenCount` is computed against may never
   match a `gitEmail`-shaped identity. Read `isMine`'s matching rule before
   deciding the fix — either `identityOf` narrows to identities `isMine` can
   actually match, or `isMine` grows to match `gitEmail`, not both; filed as
   this plan's first Open Question: does `Mine` fall back to the display name,
   or disable when no match is possible?

### Decisions already settled — do not re-derive them

- **A view state computed inline in a `.tsx` file is a domain gap, not a
  styling choice.** Root `CLAUDE.md`, "Every rendered state is a domain
  property": `DeliveryFilters.tsx:135`'s hardcoded `hiddenCount: 0` is exactly
  the shape that rule rules out — a badge's number decided in the component
  because the domain was never asked. The fix is a `chipRow`/readings change,
  not a smarter inline computation.
- **`chipRow` already decides `thisSprint` and `mine`; only the per-sprint
  chips and `waitingOnMe` are unfinished.** Don't rebuild the whole chip row —
  `chip-row.ts:139-143` already routes two of three chips through the domain
  correctly, with passing tests (`chip-row.test.ts`). The gap is scoped to
  what's named above.
- **`waitingOnMe` stays disabled in this slice.** `chip-row.ts:111-129`'s
  `waitingOnMeChip` is deliberately a stub — "No existing rule names what this
  chip filters... the brief for this wave requires the rule to return it
  disabled with a reason rather than guess one." That brief was for an earlier
  wave; this plan does not reopen it. Leave it disabled unless this plan's
  Open Questions say otherwise.
- **`chip-row.test.ts` has no row with an unmatched owner.** Issue #2476's
  test-coverage finding: every existing `mine.visibleRows` fixture names an
  author the directory or `hostUser` resolves. A fix to `identityOf`/`isMine`
  needs a fixture where the owner cannot be determined, proving the chip's
  `hiddenCount` treats "unowned" and "owner unknown" the same way `AgentList.
  tsx:705-706`'s comment already documents for `rowsForReader` ("An unowned
  row, and a row whose owner cannot be determined, both stay").
- **`NO_SPRINT` and `FilterOption` are declared in two places today** (an
  issue-#2476 LOW finding) — this slice does not need to merge them; that's
  wave "Tests and text" (`bug/chip-and-inbox-tests-can-fail`). Leave both
  declarations as they are unless a change here forces touching one.

### Done when

The plan's `## Done when` is implicit in its Motivation/Design — there is no
literal `## Done when` heading in this plan; treat the four numbered items
under "What to build" above as the specification for this branch's slice
only (item 1 of the plan's five-item Design list).

Lift these assertions, each because a naive fix would pass without it:

- A fixture with **more than one Active sprint and a narrower selection**
  (e.g., 3 Active sprints, 1 selected) where the per-sprint chip's own hidden
  count and the `This sprint` chip's hidden count are asserted independently —
  proving they answer different questions rather than one feeding the other.
- A fixture where `rowInSprintSelection` is asked about a row belonging to
  **no Active sprint**, selection empty — asserting it now returns `false`,
  not `true`. The existing passing tests for an empty selection all use rows
  that ARE in some Active sprint, so this exact case needs a new fixture or it
  silently keeps passing either way.
- A `chip-row.test.ts` fixture with an **unresolvable owner** in
  `mine.visibleRows`, proving the `Mine` chip's hidden count and
  `disabledReason` treat it consistently with `rowsForReader`'s contract.
- A per-sprint chip rendered through `chipRow()` (or its domain extension),
  not through an inline `{ ..., hiddenCount: 0 }` object — grep
  `DeliveryFilters.tsx` for a literal `hiddenCount: 0` after the change; one
  surviving there means the fix didn't land where the plan says it must.

Plus: the repo's gates — no bundle diff (`packages/board` generated output is
never part of this PR's diff), a changeset naming `plot` or `@plot-pm/board`
per `## Versioning` if this PR ships independently of the sibling slices, and
the domain package's arrow-function style for anything written in
`packages/domain/src/`. For tests, run `node skills/plot/scripts/board/
plot-local-checks.mjs` before each push and run what it prints; the suites in
`CI suites` run in CI only — list none of them as a local gate.

**Shell gate:** `scripts/check-shell-lines.sh` refuses a PR whose shell under
`skills/` grew past its merge base. This slice touches no `.sh` file under
normal scope — if a fix ends up touching one, growth must be paid for in the
same change.

### Bookkeeping

Open the PR through the controller once the first commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create`. When the PR is created, append `→ #<number>` to
this branch's line in the plan's `## Slices` section
(`docs/plans/2026-10-24-delivery-chips-and-waiting-on-you.md`, under
`### Chips`). Push the first real commit as soon as it exists — an empty
branch with no PR is invisible to `/plot-pulse`.

### Scope guard

**This branch owns:**
- `packages/domain/src/rules/chip-row.ts` and its test
- `packages/domain/src/rules/sprint-selection.ts` and its test
- `packages/board/src/app/components/DeliveryFilters.tsx`
- `packages/board/src/app/components/AgentList.tsx` — only the
  `chipRowReadings` block (~lines 710-739) and whatever new readings a
  per-sprint chip shape needs; do not touch unrelated sections of this large
  file.

**Sibling branches in this plan, not yet dispatched as of this brief:**
- `bug/waiting-on-you-counts-visible-rows` — owns `waiting-tickets.ts`,
  `plan-status-counts.ts`, `fleet.ts:1575`'s unknown-phase handling. No file
  overlap with this branch.
- `bug/chip-and-inbox-tests-can-fail` — owns three named browser test files,
  `unplanned-issues.test.ts:465`'s `PLOT_REPO_ROOT` pinning, the
  `chip-row.test.ts` unknown-owner gap (listed above as this branch's own
  Done-when item — if this branch adds that fixture first, leave a note on
  the plan so the third slice doesn't duplicate it), and the `NO_SPRINT`/
  `FilterOption` merge. Coordinate rather than racing on `chip-row.test.ts`.

If you find something the plan did not anticipate — in particular, if
resolving item 2 above (`This sprint`'s hidden-count reading) turns out to
change what a user currently sees when a narrower sprint selection is active
— report it rather than silently picking the less visible behaviour change.
