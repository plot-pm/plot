# Board: Planning tab reads a fleet payload only the Delivery tab fetches

> The Planning tab shows the plan source's age and opens a sprint item's plan from `/api/fleet`, which the page fetches only while the Delivery tab is open. Both reads show a value from the last Delivery visit, or nothing when Delivery was never opened.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2836
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- Board: the Planning tab dates "Plans read from `<ref>`" from the board's own read, and the age keeps moving with no visit to the Delivery tab.
- Board: clicking a sprint item that has no card opens the same plan on every visit, whether or not the Delivery tab was opened earlier in the session.

<!-- Board impact: board-only change in packages/board, and possibly packages/domain. `/api/board` may gain one optional field. No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

The page polls `/api/fleet` only while `tab === 'delivery'` (`packages/board/src/app/App.tsx:542-546`; the visibility handler repeats the guard at `:772`). Two reads on the Planning tab take their value from `fleet` anyway. When Delivery was never opened, `fleet` is `null`. When Delivery was opened once, `fleet` holds the last payload and no poll refreshes it.

- **Plan age.** `App.tsx:1524` and `:1537` pass `planAgeSeconds={fleet?.ageSeconds ?? null}` to `Swimlanes` and `Board`, and `PlanSourceLine.tsx:145` prints `· {ageSeconds}s ago`. On a fresh page the age is absent. After a Delivery visit the age is the value of the last Delivery poll and never changes, because no clock on the Planning tab ticks it. `ageSeconds` is also the age of the fleet's git scan (`schema.ts:4285`), and the line names the plans' ref, so the number dates a different read from the one the sentence describes.
- **Sprint modal fallback.** `App.tsx:1597` looks up a plan file with `planFileFromFleet(slug, fleet.rows, fleet.draftPlans)` when a clicked slug has no card. With `fleet === null` the lookup returns `''` and the modal stays open. With a stored fleet payload the same click navigates to `/plan/<file>`. Two visits to one page give two different outcomes for one click.

`#2833` fixes the same pattern on the Discovery tab by moving the issue answer into `/api/board` (plan `2026-10-28-discovery-tab-disables-create-plan-story`, delivered). The line numbers in the issue (`App.tsx:516`, `:1485`, `:1498`, `:1558`) match an older revision; the numbers above are measured at `5392007a1`.

## Design

### Approach

**Each Planning-tab read takes its value from `/api/board`.** The Planning tab already fetches `/api/board` on its own poll (`load`, `App.tsx:772`). The two reads move to that payload, or to a value the page computes from it. No read on the Planning tab consults `fleet`.

**Plan age.** The line "Plans read from `<ref>` · Ns ago" dates the board's read of the plan sources, so the value comes from the board payload (`planSource` already travels in it, `schema.ts:1473`). The page derives the age from a board timestamp and its own ticking clock, so the number moves between polls. Before the first board payload the line is absent, and a payload with no timestamp (an older server) shows no age; the page never prints `0s ago` or the last Delivery value for an age it does not know.

**Sprint modal fallback.** A slug with no card needs a plan file from some Planning-tab source. The board payload names the plan files of its cards already, so the fallback has two candidate sources, listed under Open Questions. A slug that neither source names leaves the modal open, as it does today for a fleet that names nothing.

**A value not known yet reads as not known.** This follows the rule of `#2833`: `null` means "not read yet", and no consumer substitutes a default or the last Delivery answer for it.

### Tests

- **Unit** (`packages/domain` or `packages/board/test/unit`): the plan-age rule gives `null` for an absent timestamp, gives a value that grows with the clock, and never reads a fleet payload. The rule is a domain function so a unit test asserts it without a browser.
- **Browser** (`packages/board/test/integration`): with the Delivery tab never opened, `[data-plan-source="ref"]` shows an age that increases between two clock ticks. A second assertion opens the Delivery tab, returns to Planning, and shows the age still moving. A `fleet` stub that answers a frozen `ageSeconds` proves the fleet is not the source; the assertion fails before the fix.
- **Browser**: a sprint item with no card opens the same destination on a fresh page and after a Delivery visit.

### Open Questions

- [ ] Which event does "Ns ago" date: the board payload's `generatedAt`, or the time the server last read the plan sources? The first needs no server change and ticks forward from each poll; the second needs a new optional field on `/api/board` and answers the question the sentence asks.
- [ ] Where does the fallback for a slug with no card get its plan file: from the board's own cards and `planSource`, or from a new board field that lists draft plans the way `fleet.draftPlans` does? Does a slug with no card on the board exist for any reason other than the plan being absent from the ref?
- [ ] Does any other Planning-tab read take a value from `fleet`? A grep of `App.tsx` shows the two above; the plan's first slice records the full list from `grep -n 'fleet' packages/board/src/app/App.tsx` and the Planning components.

## Slices

### Planning-tab reads from the board payload

- `bug/planning-tab-reads-a-fleet-payload` — plan age comes from the board payload and ticks on the page's clock; the sprint modal fallback reads a Planning-tab source; domain unit tests and browser tests that open Planning without visiting Delivery and after a visit <!-- builds: a plan-age rule on the board payload, a board-carried plan-file fallback for the sprint modal -->

## Notes

- Raised by panel round 1 on the `#2833` plan: `.plot/panels/2026-10-28-discovery-tab-disables-create-plan-story/operator.md` on branch `idea/discovery-tab-disables-create-plan-story`.
- Created from tracker issue `#2836` with `/plot-idea`; the plan stops at Draft until a reader decides to approve it.
