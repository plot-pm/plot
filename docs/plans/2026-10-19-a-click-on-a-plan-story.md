# A click on a plan, story or doc link does not open its modal

> A plain click on a plan, story, doc or sprint link on the board must open that artefact, for a plan in any phase, including a Draft or Design plan that exists only on its `idea/` branch.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2084
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**
- **Approved:** 2026-10-19, Jan Wloka, plan-PR #2091 merged

## Changelog

- Fix: a click on a plan, story, doc or sprint link on the board opens its modal (or the `/plan/<file>` page) instead of doing nothing.

Board impact: changes `packages/board` only; rebuild the board artifact (`pnpm build:board`) to test locally and do not commit it.

## Motivation

On 2026-10-19 a click on the plan name `only-my-work-says-no-identity` in WAITING ON YOU did not open the plan. The plan was in Design on `idea/only-my-work-says-no-identity`, with PR #2081 open and no file on `main`. `GET /plan/2026-10-19-only-my-work-says-no-identity.md` returned `200` with the plan's HTML, and `/api/board` listed the card with its `path`. The row's link (`lib/agent-rows/rows.tsx:350`) calls `onOpenPlan`, which prevents the navigation when it returns true. So the link resolved a card, prevented the navigation, and no modal opened, or the modal opened empty. The failure is not yet reproduced in a browser.

Every artefact link on the board uses the same pattern: a real anchor whose plain click calls `preventDefault` and sets modal state in `App.tsx`. The same defect can therefore affect each of them.

## Design

### Approach

Reproduce first, with a browser test that clicks a plan-level row in WAITING ON YOU for a Design plan that exists only on its `idea/` branch. Then fix the cause the reproduction names. Two candidate causes are checked first:

- `onOpenPlanFile` (`App.tsx:813`) returns true with no board loaded and only remembers the click (`pendingPlan`). While every poll aborts (#2083), the click is swallowed and no modal opens until a poll succeeds.
- `UnreachableOverlay` renders above the content when polls fail (`App.tsx:1392`). Check whether it covers an open modal.

The fix covers each link that opens a board modal, and a browser test clicks each one:

- plan-level rows and fleet rows (`lib/agent-rows/rows.tsx:345`);
- plan cards' Open control and their story badge (`components/PlanCard.tsx:351`, `:405`);
- tuple-row links: plan, spec and other docs (`components/TupleRow.tsx:415`);
- swimlane story headers (`components/Swimlanes.tsx:198`);
- the sprint link.

A click that cannot resolve a card must fall back to the anchor's own navigation, never swallow the click. Per the layering rule, the decision whether a link opens a modal or navigates belongs on a domain object, so a unit test can assert it without a browser.

### Open Questions

- [ ] Which of the two candidate causes (or neither) reproduces in a browser?
- [ ] Does a plan that exists only on an `idea/` branch resolve through `planFileForSlugOnBoard` to a card the modal can load?

## Slices

### Fix

- `bug/a-click-on-a-plan-story` — reproduce the failing click in a browser test, fix the cause, and cover every modal-opening link with a click test

## Notes

- Source: tracker issue #2084. Related: #2083 (polls abort).
