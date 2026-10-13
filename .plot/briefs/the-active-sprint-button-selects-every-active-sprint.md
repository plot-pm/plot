## Implementation brief — the-board-has-three-tabs (wave: The Active sprint button)

- **Plan (canonical):** [docs/plans/2026-10-12-the-board-has-three-tabs.md](../../docs/plans/2026-10-12-the-board-has-three-tabs.md) on `main`
- **Approved:** 2026-10-13, jwloka, plan-PR #1608 merged
- **Branch:** `feature/the-active-sprint-button-selects-every-active-sprint` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This branch is independent of the plan's other slices — it waits on nothing outside the plan, and nothing waits on it.

### What to build

Today the Agents/Delivery tab's sprint filter (`SprintFilter.tsx`, rendered from `AgentList.tsx:890-899`) is a checkbox per Active sprint, toggled one at a time through `toggleSprintFilter` (`AgentList.tsx:528`). With more than one Active sprint there is no one-step way to select all of them — a reader has to click every box. D32 (story Open Point 12) asks for a button that selects every Active sprint in one step.

Add `activeSprintButton(sprints)` beside `sanitizeSelection` in `packages/board/src/app/lib/filters.ts`, and a button beside the existing sprint multiselect in `AgentList.tsx`/`SprintFilter.tsx` that calls it.

### The decisions the plan settles — do not re-derive them

**It is a button over the existing multiselect, not a second filtering rule.** `fleet.sprints` already holds only Active sprints (`packages/board/src/server/fleet.ts:6348`), so "select every Active sprint" is exactly the multiselect with every option checked — the button does not introduce a parallel selection path or a new row-filtering rule. `slugPassesSprintFilter` already passes a row that is in *any* selected sprint, so selecting the union of Active sprints is what the union story (Open Point 12) asks for, with zero new filter logic.

**The signature is `activeSprintButton(sprints)`, not `activeSprintScope(rows, sprints)`.** `DESIGN-phases.md:320` names the older `activeSprintScope(rows, sprints)`, but the plan's §8 table and its panel-round revisions superseded it: the button only needs to answer which slugs to select and whether it's disabled — it does not filter rows itself (that's still `slugPassesSprintFilter` + `membership`, unchanged). Implement `activeSprintButton`, not `activeSprintScope`; the plan text is canonical over the design doc where they disagree (the design doc is frozen at an earlier revision — see the plan's 2026-10-13 and later Notes entries).

**Return shape:** `{ selection: string[]; disabled: boolean; sentence: string }`.
- `selection` — every slug of `sprints` (i.e. `sprints.map(s => s.slug)`).
- `disabled: true` with `sentence: "No sprint is Active."` when `sprints` is empty.
- `disabled: false` otherwise (the plan does not specify a non-empty sentence; follow `sanitizeSelection`'s doc-comment style and state what the button does, e.g. naming the count or just leaving the sentence empty/omitted for the enabled case — check Acceptance test expectations first since only the disabled sentence is asserted there).

**Wiring: the button sets the selection through the existing `setSprintFilter`** (`AgentList.tsx:527`), not through a new state variable. The rows, the exempt mark (`rowIsSprintExempt`) and the hidden count (`sprintReport`, `AgentList.tsx:627`) all come from the existing join (`filteredRows`, `AgentList.tsx:618-621`) — the button only changes what's *selected*, nothing downstream.

**Moving the sprint join into the domain is explicitly out of scope** for this slice — the plan calls this out directly: "Moving that join into the domain changes no behaviour and is outside this plan." Don't refactor `slugPassesSprintFilter`/`sprintMembershipLookup` while you're in the area.

### Done when

The plan's `## Acceptance` → **Active sprint** entry is the specification:

> `packages/board/test/unit/filters.test.ts`: `activeSprintButton` answers every slug of the sprints given and `disabled: false`, and `[]`, `disabled: true` and *No sprint is Active.* for none. Browser: with two Active sprints a click selects both in the multiselect.

Concretely:
- Unit test in `packages/board/test/unit/filters.test.ts` asserting `activeSprintButton([])` → `{ selection: [], disabled: true, sentence: 'No sprint is Active.' }`, and `activeSprintButton([sprintA, sprintB])` → `{ selection: ['a-slug', 'b-slug'], disabled: false, ... }`.
- A browser test case (likely added to `agents-tab.browser.test.ts`, per the plan's Cost section listing 9 new browser cases across 3 files) that stubs a payload with two Active sprints, clicks the new button, and asserts both sprint checkboxes end up checked in `SprintFilter`.
- The button itself renders disabled (with the "No sprint is Active." text available, e.g. as a tooltip/title) when `sprints.length === 0`, matching `SprintFilter`'s existing disabled-state visual pattern (see `SprintFilter.tsx:92-115`).

Plus: the repo's gates — no bundle diff (the board artifact is generated, never hand-committed), a changeset for this skill-adjacent package change (`@plot-pm/board`, patch or minor per `## Versioning`), and no new shell lines (this slice touches no `.sh` file, so `scripts/check-shell-lines.sh` is a no-op here but still runs in CI). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it resolves the related `packages/board/src/**` tests and `pnpm run typecheck` for a change in this area. The suites in `CI suites` (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain vitest with coverage, `test/reconcile/*.test.mjs`) run in CI on every PR — do not run `test:e2e` locally (see CLAUDE.md Testing section: it dispatches real workers into sandbox repos and is CI's gate, not a local one).

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` grew past its merge base — not relevant here since no `.sh` file is touched, but worth knowing if scope creeps.

### Bookkeeping

Open the PR through the controller once the branch has its first real commit:

```bash
../plot/scripts/plot-open-pr.sh          # current branch
../plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` — it has no way to find the plan or wave heading and will take its title from the last commit subject. `plot-open-pr.sh` reads which plan names the branch and opens the PR with the wave heading ("The Active sprint button") as the title, the plan and this brief in the body.

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section (`docs/plans/2026-10-12-the-board-has-three-tabs.md:127`), and set its board status to "Ready" if a project board is configured (none declared in this repo's `## Plot Config`, so skip).

Push the first real commit as soon as it exists.

### Scope guard

This branch owns:
- `packages/board/src/app/lib/filters.ts` — the new `activeSprintButton` function
- `packages/board/src/app/components/SprintFilter.tsx` and/or `AgentList.tsx` — the button's render and wiring to `setSprintFilter`
- `packages/board/test/unit/filters.test.ts` — the new unit test cases
- the relevant browser test file (likely `agents-tab.browser.test.ts`) — the new browser case

Other branches of this plan, verified at dispatch (none claimed yet as of this writing — this brief was written with `--brief-only`, no branch pushed):
- `feature/the-tabs-are-discovery-planning-delivery` — owns `App.tsx`'s tab rename, `boardTabOf`, `PhaseColumn.releasedOnly`, `planningColumns`. Touches `AgentList.tsx` only incidentally if at all (it's mostly `App.tsx`/`Board.tsx`/`workflow-phases.ts`) — low collision risk, but both branches touch files under `packages/board/src/app/`.
- `feature/waiting-on-you-shows-a-failed-verification` — owns `PlanLevelRow`/`PlanLevelRowView` in `lib/agent-rows/plan-level-row.ts` and `AgentList.tsx:1123`/`:1087-1091` (the section rendering and counts). This branch's button sits near but does not touch those line ranges — collision risk is low but real since both touch `AgentList.tsx`.
- `feature/people-names-a-tracker-account`, `feature/an-issue-names-its-assignee`, `feature/the-delivery-tab-filters-by-sprint-and-owner` — these touch `ownership.ts`, `issue.ts`, `waiting-tickets.ts`, `mine-filter.ts` and the issue/fleet read paths, not `filters.ts` or `SprintFilter.tsx`. No expected overlap.

If `AgentList.tsx` edits from this branch and the plan-level-row branch land out of order, expect a straightforward merge conflict in the render body (lines ~890-920) rather than a logical collision — both are additive insertions near the same region.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
