## Implementation brief — mine-hides-rows-with-no-known (wave: Waiting hidden split)

- **Plan (canonical):** docs/plans/2026-10-28-mine-hides-rows-with-no-known.md on `main`
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2812 merged
- **Branch:** `feature/waiting-hidden-split` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (standard PR review)

This slice is independent of the other three — it does not touch `isMine`, `comparableLogin`, or the effective «Mine» mode. It can merge before, after, or alongside `feature/mine-strict-ownership-rule`.

### What to build

`waitingTickets` in `packages/domain/src/rules/waiting-tickets.ts` currently collapses every ticket it does not select into one number, `hidden` (computed in `render()` at line ~165: `rows.filter((row) => !picked.has(row.number) && !finished(row)).length`). `hiddenSentence` renders that as *"N open tickets are not assigned to you"*. This slice splits `hidden` into two counts — `unassigned` and `assignedToOthers`, summing back to `hidden` — and `hiddenSentence` names both, e.g. *"3 open tickets are not assigned to you — 1 unassigned"*.

The split runs over the same hidden-row set `render()` already computes (the rows failing `picked.has(...)` and not `finished`), partitioned by whether the row carries an assignee at all:

- **Unassigned** — `row.assignees` is empty or absent.
- **Assigned to others** — `row.assignees` is non-empty.

### The decision the plan settles — do not re-derive it

**Partition by `assignees` emptiness, not by `ownership()`'s three-way answer.** `ownership()` (`ownership.ts`) answers `mine` / `theirs` / `unknown`, and for a ticket, `unknown` already covers two different facts conflated on purpose elsewhere: no assignee at all, and an assignee whose spelling `People` does not declare (see this plan's Motivation section — "No configuration fixes [rows with no owner at all]... so the unknown count is not a `People` signal"). Reusing `ownership()`'s answer to drive this split would put an undeclared-spelling row in the same bucket as a truly-unassigned row, which is exactly the conflation the plan's panel decision rejected for the *Mine mode control* slice (`## Decisions`: *"Is the unknown count a `People` signal? No ... A split by cause is not in this plan"*). For *Waiting on you* specifically, the two buckets this slice asks for are coarser and answerable directly from `row.assignees.length`, with no `ownership()` call and no `People`/reader dependency at all — every hidden row already failed `picked.has(...)`, so none of them are the reader's regardless of spelling.

**This is a pure count split; it changes no selection.** `waitingTickets`' `render()` still selects exactly the same `tickets`/`shown` rows it does today. The Contract Change section of the plan is explicit here: *"That line still holds: the hidden-count split changes the sentence, not which tickets the section selects."* Do not let this slice touch which rows are picked.

### Threading the two new fields through

1. **Domain:** `WaitingTickets` interface gains `unassigned: number` and `assignedToOthers: number`, both computed in `render()` alongside the existing `hidden`. `hiddenSentence(hidden, complete)` becomes `hiddenSentence(hidden, complete, unassigned, assignedToOthers)` (or equivalent) — check call sites below before choosing the final signature.
2. **Wire schema:** `FleetWaitingSchema` in `packages/board/src/contract/schema.ts` (~line 3630, the `FleetWaitingSchema` object with `tickets`/`shown`/`hidden`/`complete`/`notice`/`source`) gains `unassigned: z.number().default(0)` and `assignedToOthers: z.number().default(0)`, defaulted the same way the other counts are, so an older client/server pair that sends neither still validates.
3. **Server:** `packages/board/src/server/fleet.ts:1926` calls `waitingTickets(rows, inbox, reader, source, complete, plans)` and assembles the wire payload around it — thread the two new fields from the domain result into the `FleetWaiting` object it returns.
4. **Client render:** `packages/board/src/app/lib/agent-rows/waiting-view.ts:91` calls `hiddenSentence(waiting.hidden, waiting.complete)` to build the `hidden` sentence shown in the *Waiting on you* section. Update this call to pass the two new fields through once `hiddenSentence`'s signature changes.

### Done when

The plan's `## Done when` is implicit in its Changelog line: *"*Waiting on you* names how many hidden tickets are unassigned and how many are assigned to someone else."* Concretely:

- `waitingTickets` returns `unassigned` and `assignedToOthers` that sum to `hidden`, for every existing test fixture in `packages/domain/test/waiting-tickets.test.ts` (the file asserting `hidden` today — none of those assertions change, since this slice doesn't touch selection; add fixtures asserting the new split instead).
- `hiddenSentence` names both counts in its rendered sentence. Add a direct unit test for the sentence text (singular/plural forms, the `at least` prefix when `complete` is `false` — `hiddenSentence`'s existing `complete` branch must still hold for the new signature).
- A row with `assignees: []` or `assignees: undefined` counts toward `unassigned`; a row with any non-empty `assignees` that is still hidden (i.e. not `picked`) counts toward `assignedToOthers` — assert both directly, since this is the one new rule in the slice.
- `packages/board/test/unit` for `waiting-view.ts` and the `FleetWaitingSchema` parse/default behavior: an older-server payload with no `unassigned`/`assignedToOthers` fields still validates and defaults both to `0`.
- No existing test in `ownership.test.ts`, `chip-row.test.ts`, `lanes-for-reader.test.ts`, or `mine-filter.test.ts` changes — those belong to the other three slices.

Plus the repo's gates: no bundle diff committed (`board-server.mjs` is generated; run `pnpm build:board` only to test locally, never commit the rebuild), and a changeset. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base — this slice touches no `.sh` file, so it should not trip, but if a helper script needs editing, pay for the growth in the same change.

### Bookkeeping

Open the PR through the controller, never `gh pr create`:

```bash
../plot/scripts/plot-open-pr.sh          # on the current branch
../plot/scripts/plot-open-pr.sh --draft  # while the work is still moving
```

It reads which plan names this branch and opens the PR with this slice's wave heading (`Waiting hidden split`) as the title, the plan and this brief in the body. Push the first real commit as soon as it exists — a desk with no PR for too long is invisible on the board. Once the PR exists, append `→ #<number>` to this branch's line under `### Waiting hidden split` in the plan's `## Slices` section.

### Scope guard

This branch owns:
- `packages/domain/src/rules/waiting-tickets.ts` and its test file
- `packages/board/src/contract/schema.ts` (`FleetWaitingSchema` only)
- `packages/board/src/server/fleet.ts` (only the `waitingTickets(...)` call site and its result assembly, ~line 1902–1930)
- `packages/board/src/app/lib/agent-rows/waiting-view.ts` (only the `hiddenSentence` call, ~line 91)

Other branches in flight on this plan, verified from the plan's `## Slices` section:
- `feature/mine-strict-ownership-rule` — domain only: strict ownership answer, effective «Mine» mode, local-desk-answers-mine. Touches `ownership.ts` and `chip-row.ts`, not `waiting-tickets.ts`. No file overlap with this slice.
- `feature/mine-mode-control` (depends on slice 1) — board: moves all six `isMine` call sites, adds the hide/show unknown control. Touches `mine-filter.ts`, `chip-row.ts`, `lanes-for-reader.ts`, `App.tsx`, `AgentList.tsx` — not `waiting-tickets.ts` or `waiting-view.ts`'s `hiddenSentence` call. No file overlap with this slice.
- `feature/is-mine-removed` (depends on slice 3) — domain: removes `isMine`. No file overlap.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
