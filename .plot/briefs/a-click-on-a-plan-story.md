## Implementation brief — a-click-on-a-plan-story

- **Plan (canonical):** [docs/plans/2026-10-19-a-click-on-a-plan-story.md](../../docs/plans/2026-10-19-a-click-on-a-plan-story.md) on `main`
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2091 merged
- **Branch:** `bug/a-click-on-a-plan-story` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per plan (`Review: pr`)

Single-slice plan — no wave ordering to track.

### What to build

On 2026-10-19 a click on the plan name `only-my-work-says-no-identity` in WAITING ON YOU did not open the plan. The plan was in Design on `idea/only-my-work-says-no-identity`, PR #2081 open, no file on `main`. `GET /plan/2026-10-19-only-my-work-says-no-identity.md` returned `200` and `/api/board` listed the card with its `path`. So the data was there and the click still produced no modal, or an empty one. The failure is **not yet reproduced in a browser**; a fix written before the reproduction is a guess.

The mechanism: every artefact link on the board is a real anchor whose plain click calls `preventDefault` and sets modal state in `packages/board/src/app/App.tsx`. `lib/agent-rows/rows.tsx:341-346` (`handle`) calls `onOpenPlan(planFile)` and prevents navigation when it returns true. `onOpenPlanFile` (`App.tsx:813`) returns true in two cases: a card resolves (`setOpenPlan(card)`), or the board is not loaded (`setPendingPlan`, opened later by the effect at `App.tsx:832`). The second case is where a click is swallowed.

### Settled decisions — do not re-derive them

- **Reproduce first.** The plan's Approach is a browser test that clicks a plan-level row in WAITING ON YOU for a Design plan that exists only on its `idea/` branch, before any fix. Two candidate causes are named; the reproduction decides which (or neither):
  - `onOpenPlanFile` returns true with no board loaded and only remembers the click. While every poll aborts (#2083) `board` stays null, so the click is swallowed and nothing opens until a poll succeeds. A true "remembered" answer is indistinguishable, to the anchor, from "opened".
  - `UnreachableOverlay` (`App.tsx:1392`, rendered when `dimmed`) sits above the content when polls fail. Check whether it covers an open modal.
- **Do not "fix" by returning false when the board is unloaded.** `App.tsx:802-808` records why the click is remembered: navigating away from a live view for a plan the board is about to have is the wrong answer in the first seconds of a tab. Keep that behaviour for a board that is loading; the plan's rule is that a click that **cannot resolve a card falls back to the anchor's own navigation, never swallows the click**. A pending click that never resolves (polls keep failing, or the card is absent once the board lands) must end in navigation to `/plan/<file>`, not in silence. The effect at `App.tsx:832` drops an unresolved request today — that is a swallow.
- **Absent is not false.** `cardForPlanFile` matches by basename against `board.columns[*].cards`. A card missing from the payload and a board not yet loaded are different answers; the domain object must keep them apart.
- **The decision belongs on a domain object** (CLAUDE.md, The Layering Rule: every rendered state is a domain property). Whether a link opens a modal, waits, or navigates is computed in `packages/domain` as a pure function over `(board loaded?, card found?)` and unit-tested without a browser. The `.tsx` calls it. New code is an arrow function (`export const f = (…) => …`); TSDoc states what the export does, not the history.
- **Scope of the fix is every modal-opening link, not the one reported.** The same pattern is used in each; the plan lists them:
  - plan-level rows and fleet rows (`lib/agent-rows/rows.tsx:345`)
  - plan cards' Open control and story badge (`components/PlanCard.tsx:351`, `:405`)
  - tuple-row links: plan, spec and other docs (`components/TupleRow.tsx:415`)
  - swimlane story headers (`components/Swimlanes.tsx:198`)
  - the sprint link

  Each gets a browser click test. Browser tests prove the badge/modal is *seen*; the branching is asserted in the unit test.

### Done when

The plan's `## Design` section is the specification (it has no `Done when` list). Make that concrete:

- A browser test clicks a plan-level row in WAITING ON YOU for a Design plan that lives only on its `idea/` branch and asserts the modal opens with that plan's content. It must **fail on `main` before the fix** if the defect reproduces; if it passes there, the cause is in one of the other links or the poll-failure path — keep looking, do not commit a green test as proof of a fix.
- A browser test per link in the list above (plain click opens the modal or lands on `/plan/<file>`; never nothing). Each catches a link that resolves, prevents navigation and opens nothing.
- A test with the board unreachable (polls aborting, #2083): a click ends in navigation, not silence. A naive fix that only handles the loaded-board path passes without this.
- Modified-click (meta/ctrl/shift/alt, non-primary button) still follows the browser default — the existing `handle` guard.
- A domain unit test for the open/wait/navigate decision, covering: board loaded + card found, board loaded + no card, board not loaded.

Plus: add a changeset (`@plot-pm/board`, description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). Rebuild the board artifact with `pnpm build:board` only to test locally; do not commit it (`scripts/check-no-bundle-diff.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not run board tests while the operator's board is open.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The issue is #2084.

### Scope guard

Owned: `packages/board/src/app/**` (App.tsx, `lib/agent-rows/`, `components/PlanCard.tsx`, `TupleRow.tsx`, `Swimlanes.tsx`, `UnreachableOverlay.tsx`), the new decision in `packages/domain/src/`, and tests for them under `packages/board/test/` and `packages/domain/`. Related but out of scope: #2083 (polls abort) — do not fix the abort here; this slice only guarantees a click survives it. Other open work touching the board: `chip-row-states-are-domain-properties` (PR #2089) and `the-board-shows-no-rows-when` — expect conflicts in `rows.tsx`/`App.tsx`, rebase rather than merge, and restore generated board paths from the merge base rather than committing a rebuild.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
