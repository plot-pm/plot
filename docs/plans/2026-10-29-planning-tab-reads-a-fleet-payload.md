# Board: Planning tab reads a fleet payload only the Delivery tab fetches

> The Planning tab shows the plan source's age and opens a sprint item's plan from `/api/fleet`, which the page fetches only while the Delivery tab is open. Both reads show a value from the last Delivery visit, or nothing when Delivery was never opened.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2836
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-29, Jan Wloka, plan-PR #2891 merged
- **Started:** 2026-10-29, Jan Wloka, `bug/planning-tab-reads-a-fleet-payload`

## Changelog

- Board: the Planning tab dates "Plans read from `<ref>` · Ns ago" from the last successful fetch of the ref, and the age counts up every second with no visit to the Delivery tab.
- Board: while the fetch of the ref fails, the Planning age keeps counting from the last fetch that succeeded; when no fetch has succeeded since the board started, the line shows no age.
- Board: the Delivery footer's "scanned Ns ago" also dates the last successful fetch, so it keeps counting up while fetches fail and never shows a different age from the Planning line for the same fetch; with no successful fetch known it shows no age.
- Board: `/api/fleet`'s `readRefAge` and `ageSeconds`, and `/api/attention`'s `ageSeconds`, date the last successful fetch of the ref.
- Board: while the board server is unreachable, the Planning age stops and the line reads "(frozen)"; it resumes from the next answer.
- Board: against an older board server, the Planning tab shows "Plans read from `<ref>`" with no age.
- Board: a sprint item whose plan the board does not know renders as text with its `?` badge instead of a button; a known item opens its plan the same way on every visit, from the Planning and the Discovery tab.

<!-- Board impact: board-only change in packages/board and packages/domain. `/api/board` gains one optional field; `/api/fleet`'s `readRefAge` and `ageSeconds` date the last successful fetch; `FleetReadingSchema` keeps the scan's existing `fetch_failed` field. No change to the plan format, template, helper scripts or docs/plans layout. -->

## Motivation

The page polls `/api/fleet` only while `tab === 'delivery'` (`packages/board/src/app/App.tsx:542-546`; the visibility handler repeats the guard at `:772`). The Planning tab polls `/api/board` on its own 30 s timer (`App.tsx:527-532`, `POLL_MS` at `:48`). Two reads on the Planning tab take their value from `fleet` anyway. When Delivery was never opened, `fleet` is `null`. When Delivery was opened once, `fleet` holds the last payload and no poll refreshes it.

All four panel jurors confirmed the defect and corrected its cause (`.plot/panels/2026-10-29-planning-tab-reads-a-fleet-payload/panel.md`).

### Causes

- **The scan age reaches Planning only through the Delivery poll.** `App.tsx:1524` and `:1537` pass `planAgeSeconds={fleet?.ageSeconds ?? null}` to `Swimlanes` and `Board`, and `PlanSourceLine.tsx:145` prints `· {ageSeconds}s ago`. The scan age is the right event: `/api/board` re-reads the plan sources on every request (`packages/board/src/server/board.ts:2192-2202`), so the plans are as fresh as the last `git fetch` of the ref, and only the fleet scan runs that fetch (`skills/plot/scripts/plot-fleet-scan.sh:382-395`). `PlanSourceLine.tsx:53-58` records this. The defect is the transport: on a fresh page the age is absent, and after a Delivery visit it holds the last Delivery value.
- **Nothing ticks the age.** No clock on the Planning tab advances the number between two answers, so it never moves.
- **A cold server answers `0s ago`.** `buildFleet` returns `ageSeconds: 0` while no scan has finished (`packages/board/src/server/fleet.ts:7506`). A Delivery visit during a cold server's first scan leaves Planning on `0s ago` for the session. `readRefAge` already holds the null rule (`fleet.ts:7658`, `packages/board/src/contract/schema.ts:4317`).
- **A failed fetch still moves the scan time.** The scan keeps running when `git fetch` fails and reports `fetch_failed` in its JSON (`plot-fleet-scan.sh:382-395`, `:5279`). `FleetReadingSchema` (`packages/domain/src/entities/fleet.ts:738`) has no such key, so both readers strip it: the board's own scan (`packages/fleet/src/shared/fleet-scan.ts:623`) and the bridge file (`packages/domain/src/adapters/fleet-state/fleet-state-file.ts:73`). `refresh` then sets `entry.at` on every finished scan (`fleet.ts:2879`), fetch or no fetch. Any age built from `entry.at` reports a fresh read of a ref that was not refreshed.
- **The sprint-modal fallback can never find a plan the board lacks.** `App.tsx:1597` calls `planFileFromFleet(slug, fleet.rows, fleet.draftPlans)` after the card lookup fails (`App.tsx:1586`). The board's cards already include plans from the ref, the working tree and branches (`board.ts:2250-2287`), everything `fleet.draftPlans` reads, and the server marks a sprint member with no card `known: false` (`board.ts:1643-1656`, `:2650-2654`). The panel measured every sprint file on `origin/main`: 16 members name no plan file on the ref or any branch, 0 name a branch-only plan, and the active sprint has none. So the fallback finds nothing on a fresh page and nothing after a Delivery visit, and the `known: false` member stays a button that does nothing (`packages/board/src/app/components/SprintModal.tsx:177-188`).
- **Three doc comments state the fleet source.** `PlanSourceLine.tsx:53-58`, `Board.tsx:151-158` and `App.tsx:1592-1603` describe the fleet pulse as the age's or the fallback's source.

`#2833` fixes the same pattern on the Discovery tab by moving the issue answer into `/api/board` (plan `2026-10-28-discovery-tab-disables-create-plan-story`, delivered). The line numbers in the issue (`App.tsx:516`, `:1485`, `:1498`, `:1558`) match an older revision; the numbers in this plan are measured at `c767fac2f`.

## Design

### Approach

**The scan carries its fetch result.** `FleetReadingSchema` (`packages/domain/src/entities/fleet.ts:738`) gains `fetch_failed: z.boolean().optional()`. The scan script already emits the field, so no shell line changes. Both readers keep it: the board's own scan and fleetd's scan parse through the same schema (`fleet-scan.ts:623`), `writeScan` writes `result.reading` to the bridge (`fleet-scan.ts:709-725`), and the bridge reader parses it back (`fleet-state-file.ts:73`). An absent field (an older script or bridge) means the fetch succeeded, which is today's reading.

**The cache records the last successful fetch.** `CacheEntry` (`fleet.ts:324`) gains `fetchedAt: number | null`, `null` in `freshCacheEntry`. `refresh` sets `fetchedAt` to the new `entry.at` when the finished scan's `fetch_failed` is not `true`, and leaves it unchanged when it is (`fleet.ts:2879`). `ensureCache` seeds `fetchedAt` from the bridge's `at` when the bridged pulse's `fetch_failed` is not `true`, and leaves it `null` when it is (`fleet.ts:3015`). `entry.at` keeps its meaning (the scan time), so the bridge comparison (`fleet.ts:2878`), `pulseShrink` and the scan countdown do not change.

**`/api/fleet` dates the same fetch.** `buildFleet` computes both ages from `fetchedAt` through the server-age rule below, in place of `entry.at` (`fleet.ts:7506`, `:7643`, `:7658`). `readRefAge` is `null` while `fetchedAt` is `null`. `ageSeconds` stays a number for older pages (`schema.ts:4285`) and reads `readRefAge ?? 0`. The Delivery footer (`AgentList.tsx:2734`) prints `readRefAge + tick` and omits the age when `readRefAge` is `null`, so the footer never prints `0s ago` for a scan whose fetch failed. Its tick and its freeze (`AgentList.tsx:595-601`) do not change. Planning and Delivery thus read one rule over one `fetchedAt` and never disagree about the same fetch.

Other consumers, from `grep -rn -E '\.ageSeconds|readRefAge' packages/*/src`:

- `AgentList.tsx:949`, `shrinkNote(fleet.shrink, fleet.ageSeconds + tick)` (`app/lib/agent-rows/actions.ts:31-43`): the note says the rows "disappeared in the last Ns". With `ageSeconds` dating the last successful fetch, the window can only grow, so the sentence stays true; it does not change in this slice.
- `packages/board/src/server/attention.ts:479`, `ageSeconds: fleet.ready ? fleet.ageSeconds : null`: `/api/attention`'s age dates the last successful fetch. It reads `fleet.readRefAge` in place of `fleet.ageSeconds`, which keeps its null-before-data rule and adds null after a fetch-failed seed.
- `packages/board/src/server/mock-fleet.ts:362` (`ageSeconds: 0`): the mock board gains `readRefAge: 0` so the mock footer keeps its age.
- `packages/domain/src/rules/pr-status.ts` and `supervisor-reading.ts` name their own `ageSeconds` (PR data, supervisor tick) and read neither field; no change.

**`/api/board` carries the ref age.** `BoardSchema` gains `planRefAgeSeconds: z.number().nullable().optional()`, beside `planSource` (`schema.ts:1473`). The `/api/board` handler fills it in `packages/board/src/server/index.ts` beside `ticketLaneData` (`index.ts:493`), from the `ensureCache` entry the handler already warms, and not in `buildBoard`. A small exported read in `fleet.ts` returns the entry's `fetchedAt`, so `index.ts` reaches no cache internals. The value is `null` before the first successful fetch (the `readRefAge` rule, never `ageSeconds`' 0).

**One domain rule does the age arithmetic.** `packages/domain/src/rules/plan-ref-age.ts` exports two arrow functions that take `nowMs` as a value:

- the server age: `fetchedAt` and `nowMs` give whole seconds since the fetch, `null` for a `null` `fetchedAt`, never negative;
- the page age: the server's age, the time the page received it and `nowMs` give the server age plus the elapsed page time in whole seconds; `null` or `undefined` in gives `null` out; never negative.

The page never subtracts a server timestamp from `Date.now()`, which breaks on clock skew for a remote viewer. The page uses the Delivery footer's method (`AgentList.tsx:577-601`).

**`PlanSourceLine` owns the tick.** `App.tsx:1524` and `:1537` pass `board.planRefAgeSeconds` and the page time at which that board payload arrived, in place of `fleet?.ageSeconds`. `PlanSourceLine` runs a 1 s interval and calls the page-age rule with the current time. No timer moves into `App`. An absent or `null` age prints no age. The Delivery poll guard (`App.tsx:542-546`) stays.

**A dead server freezes the age.** While `boardUnreachable` is true (`App.tsx:382`), `PlanSourceLine` stops its interval, keeps the last printed age and appends ` (frozen)`, the Delivery footer's word (`AgentList.tsx:2734`). The next board payload resets the receive time, and the line counts from the new answer.

**The sprint item's destination is a domain rule.** `planFileFromFleet` leaves the sprint modal (`App.tsx:1592-1603`); it stays in `AgentList.tsx:564` for plan-level rows. A rule in `packages/domain/src/rules/sprint-item-destination.ts` takes a member's `slug` and `known` and the set of card slugs, and returns the slug of a card to open or no destination: a card with that slug opens; `known: false`, an empty slug or a slug with no card gives no destination. `SprintModal` asks the rule per member and renders a button only where a destination exists; any other member renders as text with its existing `?` badge (`SprintModal.tsx:177-215`). `onOpenPlan` opens the card. The Planning and the Discovery tab open the same modal (`App.tsx:1373`, `:1578` via `onOpenSprint`, `:1581`), so one change covers both entry paths.

**The comments state the board source.** `PlanSourceLine.tsx:53-58` and `Board.tsx:151-158` say the age comes from `/api/board`'s ref age, which dates the last successful fetch. The comment at `App.tsx:1592-1603` leaves with the fallback.

**Older server, newer page.** An older server sends no `planRefAgeSeconds`. The field decodes to `undefined` and the line shows "Plans read from `<ref>`" with no age. A newer server with an older page: `BoardSchema` is a plain `z.object`, so the older page strips the field and keeps reading `fleet.ageSeconds`.

### Decisions

Decided 2026-10-29 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-29-planning-tab-reads-a-fleet-payload/panel.md`):

- [x] Event: "Plans read from `<ref>` · Ns ago" dates the fleet scan's fetch of the ref, not the board's read (`board.ts:2192-2202`, `plot-fleet-scan.sh:382-395`). Neither option of the former Open Question 1 (`generatedAt`, a board read time) is taken.
- [x] Transport: `/api/board` carries one optional field, `planRefAgeSeconds`, computed on the server from the `ensureCache` entry and filled in `index.ts`, not `buildBoard`. It is `null` before the first scan (the `readRefAge` rule, `fleet.ts:7658`), and an absent field (older server) shows no age.
- [x] Tick: the page adds elapsed page time to the server age, as the Delivery footer does (`AgentList.tsx:577-601`), never `Date.now()` minus a server timestamp. The arithmetic is a domain function taking `nowMs`; the 1 s tick lives inside `PlanSourceLine`, not in `App`.
- [x] Unreachable server: the clock stops, as the Delivery footer's does (`AgentList.tsx:578-600`); the age freezes at the last answer and the line reads ` (frozen)`.
- [x] Failed fetch, folded in: the scan's `fetch_failed` (`plot-fleet-scan.sh:5279`) reaches the cache through `FleetReadingSchema`, with no shell change, so `check-shell-lines.sh` sees no growth. The age dates `fetchedAt`, the last successful fetch; with no successful fetch known it reads `null`.
- [x] Sprint modal: `planFileFromFleet` leaves the modal. The destination of a sprint item is a domain rule with unit tests (card → its plan; `known: false` → no destination). A `known: false` member renders as text with its `?` badge. The Planning and Discovery entry paths are both covered (`App.tsx:1373`, `:1578`).
- [x] Same slice: the three doc comments (`PlanSourceLine.tsx:53-58`, `Board.tsx:151-158`, `App.tsx:1592-1603`) change, and the poll citation reads `App.tsx:527-532`.
- [x] Scan owner: when a separate fleetd owns the scan, the age dates fleetd's fetch. Evidence: with the supervisor up and a fresh bridge (`fleetOwnsScan`, `fleet.ts:2775-2779`) the board spawns no scan, reads the bridged pulse (`fleet.ts:2806`) and sets `entry.at` to the bridge's `at` (`fleet.ts:2879`); fleetd runs the same script with its fetch (`fleet-scan.ts:613`) and writes that time with the pulse (`fleet-scan.ts:709-725`). A board restart seeds the same time from the bridge (`fleet.ts:3015`). With `fetch_failed` in the schema, fleetd's fetch result travels in the same pulse.
- [x] Former Open Question 3, answered by the layering juror: no other Planning-tab read uses `fleet`.
- [x] Same slice: `/api/fleet`'s `readRefAge` and `ageSeconds` (`fleet.ts:7506`, `:7658`) and the Delivery footer's "scanned Ns ago" (`AgentList.tsx:2734`) also date `fetchedAt`, so Planning and Delivery read one rule and never disagree about the same fetch. The other consumers are listed under Approach.
- [x] Age only: `/api/board` gets no second field, and the Planning line does not say in words that the fetch failed. An age that keeps counting from the last successful fetch is the signal.

### Tests

- **Domain unit** (`packages/domain/test/plan-ref-age.test.ts`): the server age is `null` for a `null` `fetchedAt`, whole seconds otherwise, and never negative for a `fetchedAt` after `nowMs`; the page age is `null` for `null` and for `undefined`, equals the server age at the receive time, adds elapsed whole seconds (10 at receipt, 15 after 5 s), and is never negative.
- **Domain unit** (`packages/domain/test/sprint-item-destination.test.ts`): a known member with a card opens that card's slug; a `known: false` member has no destination; an empty slug has no destination; a known slug with no card has no destination.
- **Board unit** (`packages/board/test/unit/`): `/api/board`'s `planRefAgeSeconds` is `null` on a cold cache and a number after a scan; a scan whose reading carries `fetch_failed: true` leaves the age dating the previous successful fetch; a bridge seed whose pulse carries `fetch_failed: true` gives `null`; a reading or bridge with no `fetch_failed` dates its own `at`; a board payload with no `planRefAgeSeconds` parses (older server). For `/api/fleet`: after a scan whose reading carries `fetch_failed: true`, `readRefAge` and `ageSeconds` keep counting from the last good fetch time and do not reset; after a fetch-failed bridge seed, `readRefAge` is `null` and `ageSeconds` is 0; `/api/attention`'s `ageSeconds` equals `readRefAge`.
- **Browser** (Delivery footer, cheap with the existing fleet stubs): a `/api/fleet` stub with `readRefAge: 40` and `ageSeconds: 0` shows exactly `scanned 40s ago`; a stub with `readRefAge: null` shows no scanned age. The non-reset on a failed fetch is a server fact, so the board unit test above holds it.
- **Browser** (`packages/board/test/integration/plan-source.browser.test.ts`, which has nine cases and none on the age): `page.clock` installed at a fixed time, as `page-hears-channel.browser.test.ts:35-41` does. The `board` stub carries `planRefAgeSeconds: 10`; `[data-plan-source="ref"]` reads exactly `10s ago`, then `15s ago` after 5 s. The `/api/fleet` stub answers `ageSeconds: 999`, and `999s ago` never shows, on a fresh page and after a Delivery visit and return to Planning; this assertion fails before the fix. With `/api/board` failing, the age stops and the line reads ` (frozen)`. A `board` stub without the field shows the line with no age.
- **Browser** (sprint): a sprint with one `known: false` member whose slug the `/api/fleet` stub names in `draftPlans`; the member renders as text with its `?` badge and no button, from the Planning tab and from the Discovery tab, on a fresh page and after a Delivery visit. A known member opens its plan modal by name. The fleet stub that names the slug makes the test fail before the fix.
- No existing test pins the fleet-sourced age or the fleet fallback, so none has to change.

## Slices

### Board-carried plan age

- `bug/planning-tab-reads-a-fleet-payload` — `FleetReadingSchema` keeps `fetch_failed`; the cache records the last successful fetch; `/api/board` carries `planRefAgeSeconds`; `PlanSourceLine` ticks it from a domain rule and freezes it while the server is unreachable; `/api/fleet`'s `readRefAge` and `ageSeconds`, `/api/attention` and the Delivery footer date the same fetch; the sprint modal drops `planFileFromFleet` for a domain destination rule; three doc comments state the board source; domain, board unit and browser tests <!-- builds: fetch_failed on FleetReadingSchema, fetchedAt on CacheEntry, planRefAgeSeconds on BoardSchema, a plan-ref-age domain rule, a sprint-item-destination domain rule --> → #2895

## Notes

- Raised by panel round 1 on the `#2833` plan: `.plot/panels/2026-10-28-discovery-tab-disables-create-plan-story/operator.md` on branch `idea/discovery-tab-disables-create-plan-story`.
- Created from tracker issue `#2836` with `/plot-idea`; the plan stops at Draft until a reader decides to approve it.
- Amended 2026-10-29 after panel round 1. One slice: the fetch carry, the age, the tick and the sprint rule all change what the Planning tab shows, and the tests of each read the same board stub.
