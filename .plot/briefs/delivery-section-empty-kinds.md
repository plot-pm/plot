## Implementation brief — every-delivery-section-folds (wave 2: Empty kinds)

- **Plan (canonical):** `docs/plans/2026-11-20-every-delivery-section-folds.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-section-empty-kinds` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

The plan's second slice, in the sprint "Delivery UI Polish". Wave 1, `feature/every-delivery-section-folds`, merged as #3587 (merge commit `6674bc5fd`), so the shared frame, `data-section-toggle`, `isFoldable`/`isFolded`, `anchorOwner` and the single jump are on `main`. `feature/folded-sections-summarise-visually` (plan 3) waits on this slice because its folded summary shows the empty kind's mark. Plan 5's Release unfold, Work items grid and Fleet switch slices wait on this plan.

### What to build

An empty Delivery section looks like a folded one or like a failed reading. The spec's anti-goal is direct: *"Could not read" that looks like "empty", or empty that looks like folded.* This slice adds `sectionEmptyKind(input): SectionEmpty | null` beside `delivery-view.ts`. It returns `null` for a section with rows and otherwise `{ kind: 'clear' | 'unread' | 'stopped', sentence, note | null, hidden | null }`. The open-but-empty section then shows a dashed frame with one sentence: green ✓ for clear, amber ! for unread, grey ■ for stopped. An empty group inside an open section that holds rows renders its label, "— none" and its hint.

Build on the frame wave 1 left in `SectionHead.tsx` and `AgentList.tsx`. Wave 1 provided the summary slot and left the frame to this slice. Line numbers in the plan were read before wave 1 merged: re-grep before you edit (`git grep -n` for `anchorOwner`, `isFolded`, `ticketsSection`, `issueNote`, `agentsForReader`, `ticketsForReader`, `GROUP_LABELS`). The plan is canonical; this brief records what must not be re-derived.

### Settled decisions — do not re-derive them

- **The kind, the sentence and the hidden count are domain/view properties with a unit test each.** `TicketsSection.tsx` decides an empty kind in `.tsx` today (the `section.state !== 'rows'` branch); that decision moves into `sectionEmptyKind`. A browser test proves the frame is seen and decides nothing.
- **The table in the plan is the specification.** One unit test per row, plus the non-empty case:
  - Release delivery (`view.releasePlanCount` = 0): clear, "No approved plan belongs to a release or sprint yet."
  - You (`section.count` = 0): clear, "Nothing waits on you."
  - Work items (`section.count` = 0): clear, "No work item is at a gate, being built or queued."
  - Fleet: `supervisorVerdict` over `fleet.supervisor`: `up` with 0 agents is clear "No agent runs."; `down` is stopped "The fleet is not running."; `died` is stopped with the alert's detail; `unknown` is stopped with the supervisor's `note` wording, **never clear**.
  - Machine: headroom `unmeasured` is stopped with `machineHealth`'s own word "not measured"; Machine adds no second "no reading" vocabulary. Two `machineHealth` exist: `packages/domain/src/rules/machine-health.ts` and a board-side wrapper in `packages/board/src/app/lib/agent-rows/machine-health.ts`. Read both before you pick the input.
  - Tickets: `ticketsSection` state `rows` with 0 rows is clear "No ticket waits for a plan."; `failed` is unread; `unsupported` is stopped with `issueAbsence`; `unasked` is unread with "The tracker has not been read yet." and no failure note.
  - Not placed: never empty, because it renders only with rows.
- **Unread must not read clear (panel round 3).** `placeDelivery` puts unreadable items and agents in `unplaced` with reason `unread` (`view.notPlaced`). You, Work items and Fleet use the unread kind ("N not read") from `notPlaced` by subject, matching plan 4's header. A section that reads clear while its rows sit unread in Not placed is the exact defect the spec forbids.
- **No Retry control.** Operator decision, 2026-11-20. A refetch of the board payload makes the tracker answer nothing new, because while a fleet runs the board reads the `issues.json` that fleetd writes. An unread frame shows the failure through `issueNote` (`host-notes.ts`), which appends the age of the last good rows from `issueAgeSeconds`. Where `issueAgeSeconds` is `null`, show `issueError` alone. Do not add a button that cannot change the answer.
- **The hidden count comes from the rows the section shows, and `sectionEmptyKind` decides no ownership.** Panel round 2 found the first draft defined a Mine rule no slice built; the fix is that the count is an input. Plan 5's `feature/mine-means-mine-or-my-plan` owns the Mine rule; this slice reads its output and waits on nothing.
  - **Items (You, Work items):** the items of `deliveryMapping`'s `wholeReadings` that the whole placement puts in the section, minus the items shown there. `mineHiddenCount` (`mine-mode.ts`) cannot serve: it counts rows by ownership before placement and cannot say which section a hidden row would sit in.
  - **Fleet:** `fleet.agents` minus the agents `agentsForReader` keeps. `workersHiddenByFilter` counts the sprint filter, not Mine, and stays as it is.
  - **Tickets (panel round 3):** `ticketsSection`'s `hidden` input is `fleet.waiting.hidden`, the server's "not assigned to you" count that *show all* reveals. It is the wrong field. Count Mine-hidden tickets as `ticketsForReader`'s input minus its output, and keep `hidden` separate. Required unit cell: Mine off with `waiting.hidden = 3` shows no Mine-hidden count.
- **The hidden counts need a home: `sectionHiddenCounts` in `delivery-view.ts`, one unit test per section.** Do not compute a count in `AgentList.tsx`.
- **"Hidden by the scope" never fires on `wholeReadings` (panel round 3).** `wholeReadings` is built from scope-filtered rows, so it cannot tell a scope-hidden item from a missing one. Either drop that reason from `anchorOwner`'s `hidden: 'filter'` or read an unscoped placement. `hiddenBySelection` (`chip-row.ts`) counts tab-wide, not per section, so it cannot serve. The scope adds its **name** to the sentence and no count of its own, because no function computes a scope-hidden count.
- **The sentence names the scope, and a button calls the setter the Mine chip or scope toggle already calls.** Example: "Nothing waits on you in my sprints · 3 hidden by Mine". The frame adds no second filter state. The You "3 hidden by Mine" example cannot occur today, because `delivery-readings.ts` keeps every You item under Mine; use Work items or Tickets for a Mine fixture that fires.
- **Fleet and Machine take no scope.** The spec shows the whole machine in both scopes, so their sentence never names the scope and Fleet's `my-sprint` cells equal its `release` cells. Mine still applies to Fleet; Machine takes neither.
- **My sprint with several sprints (operator decision, 2026-11-20).** Where `deliveryScope` returns several sprints, the sections combine all of them and the scope sentence names them ("in my sprints · <a>, <b>").
- **Two Mine vocabularies.** The board's `MineMode` is `'all' | 'mine-and-unknown' | 'mine'`; placement reads `DeliveryMine` (`'off' | 'mine' | 'strict'`) through the `MINE` map in `delivery-readings.ts`. Fixture cells name the `DeliveryMine` words, as the spec does.
- **Unit cells for You, Work items and Tickets:** `release` × {off, mine, strict} and `my-sprint` × {off, mine, strict}, each as fixture counts (0 shown and n hidden, and 0 shown and 0 hidden), each asserting the empty kind, the sentence and the hidden count. Release delivery has the two scope cells only. Release delivery reads `deliveryMapping({ ...input, mode: 'all' })`, so only its scope varies.
- **Frame or content, decided by `sectionEmptyKind` alone.** A measured Machine section has `groups: []` in `DELIVERY_LAYOUT` and still shows its meters, so a unit test asserts it answers `null`. A section with content shows **every** group: the `group.count > 0` filter in `AgentList.tsx` goes, and the hints already exist in `GROUP_LABELS` and reach the view as `GroupView.hint`.
- **Tickets keeps `data-tickets-absent`** on the unread and stopped frame, so `tickets-section.browser.test.ts` (the `[data-tickets-absent]` assertions near line 210) keeps its selector. Keep `data-issue-error` and `data-issue-absence` too.
- **Fleet keeps its switches when empty.** They stay in the Fleet section heading, also while the section is open and empty. Plan 5's `feature/fleet-switches-in-fleet-section` owns the switch row at the top of the open section and its place above the stopped frame. Do not move them.
- **Departures from the mockup `header-and-sections-v2.html`, on purpose:** Release delivery's empty mark is the clear ✓, not the faint `○`; Machine's unmeasured state is the stopped ■ "not measured", not a fourth glyph `?`; the stopped Fleet frame carries no "Start fleet" link, because no board controller starts fleetd (`FleetControls.tsx` posts only to `/api/fleet-controls`). The spec is `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md`, mockups beside it; it is outside this repository.

Rules carried over from related work: absent is not false (a missing reading is `unread` or `stopped`, never `clear`, and an absent count is not `0`); read the exit code, not the emptiness; a function you write is an arrow, and a function you only pass through stays as it is (CLAUDE.md, *The Domain Package*).

### Done when

The plan has no separate `## Done when`; the *Slice 2* bullets and the *Board tests* bullet are the specification. Assertions that exist because a naive implementation would pass without them:

- **Fleet `unknown` answers stopped, not clear.** Catches an implementation that treats "no agent rows" as "nothing runs".
- **A section whose items sit in `notPlaced` with reason `unread` answers unread.** Catches the empty-means-clear shortcut.
- **Tickets, Mine off, `waiting.hidden = 3`: no Mine-hidden count.** Catches reading the wrong field.
- **Measured Machine answers `null`.** Catches a frame drawn over meters.
- **`sectionEmptyKind` returns `null` for every section with rows.** Catches a frame beside content.
- **A browser test that the frame and a "— none" group render** in one open section.
- **`tickets-section.browser.test.ts` `[data-tickets-absent]` still passes**, and the other tests the plan names keep their selectors: `mine-filter.browser.test.ts` (near 114), `row-withholds.browser.test.ts` (near 275 and 654) and `agents-tab.browser.test.ts` (near 1915, an empty group has no toggle; stays true). Re-read each; do not delete a test to make it pass.
- **The count gate:** `EXPECTED_FILES` (99) and `EXPECTED_TESTS` (724 on `main` after #3587) in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts`. Record this slice's delta and reason there, as #3575 and #3587 did.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for `@plot-pm/board` with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice should touch no shell; if it does touch a `.sh` file, `scripts/check-shell-lines.sh` refuses growth, so remove shell elsewhere in the same change or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `sectionEmptyKind` and `sectionHiddenCounts` in or beside `packages/board/src/app/lib/agent-rows/delivery-view.ts`, the frame in `SectionHead.tsx` and `AgentList.tsx`, the empty-kind decision now in `TicketsSection.tsx`, the group render filter in `AgentList.tsx`, `anchorOwner`'s `hidden: 'filter'` reason (only to drop or correct the scope reason) and the tests named above.

In flight on the same files, to re-verify before you start:

- `feature/delivery-tuples-in-every-row` (plan 1) rewrites row rendering in `DeliveryRows.tsx`. This slice should not need that file.
- `feature/delivery-tab-has-one-header` (plan 4) removes `FleetCard` and `TodoList` and builds the header; it uses the unread vocabulary from `notPlaced`. Do not remove either component.
- `feature/folded-sections-summarise-visually` (plan 3) builds the summary slot's content and waits on this slice. Provide the empty kind's mark; leave the rest of the summary to plan 3.
- `feature/mine-means-mine-or-my-plan` (plan 5) changes the Mine rule in the filters. Read its output only, and leave the rule to it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
