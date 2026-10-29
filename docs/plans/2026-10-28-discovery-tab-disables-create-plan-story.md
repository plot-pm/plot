# Board: Discovery tab disables Create plan/story with "no issue read" until the Delivery tab loads the fleet

> The Discovery tab takes its ticket rows from `/api/board` and the issue answer for those rows from `/api/fleet`, which the page fetches only on the Delivery tab. A fresh Discovery page therefore shows Create plan and Create story as refused on a host whose issue read works.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2833
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2834 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/discovery-tab-disables-create-plan-story`
- **Delivered:** 2026-10-28
- **Released:** 2026-10-29, v2.29.1

## Changelog

- Board: the Discovery tab offers Create plan and Create story whenever the host's issue read answers, including on a page opened or reloaded on `?tab=discovery`, with no visit to the Delivery tab.
- Board: the Discovery tab follows the issue read on its own 30 s poll, so an issue read that starts to fail shows on Discovery too.
- Board: before the first issue read after a board start, Create plan and Create story stay inactive with no refusal sentence; the board no longer claims "this git host has no issue read" for a read that has not happened yet.
- Board: a Discovery page shows the board's own reason why tickets are not listed (for example, no tracker declared) instead of "Tickets have not been read yet."

<!-- Board impact: board-only change in packages/board and packages/domain. `/api/board` gains two optional fields; `/api/fleet`'s `issueAnswer` becomes nullable. No change to the plan format, template, helper scripts, docs/plans layout or `issues.json`. -->

## Motivation

On a GitHub repository whose issue read works, a fresh page on `?tab=discovery` shows every ticket's Create plan and Create story as refused, with the reasons `this git host has no issue read, so an issue cannot become a plan from here` and `this git host has no issue read, so a ticket cannot become a story from here`. The server disagrees: `/api/fleet` answers `issueAnswer: "answered"` (5 of 5 reads, 4 issues). Board 2.29.0 (marketplace `991ceb6`). Workaround: open the Delivery tab once, then return to Discovery.

`/api/board`'s `idea` and `story` fields (`available: true` in the report) are no evidence either way: `ideaAvailability(HOST)` and `storyAvailability(HOST)` (`packages/board/src/server/index.ts:501`, `:507`) answer only the localhost binding, and `packages/board/src/contract/schema.ts:1316-1324` states that the issue read is the other half of the question, carried as `Fleet.issueAnswer`.

All four panel jurors reproduced the defect at function level (`.plot/panels/2026-10-28-discovery-tab-disables-create-plan-story/panel.md`).

### Causes

- **The rows and their answer come from two endpoints.** `/api/board` builds `tickets` through `discoveryLanes` → `ticketLaneData` → `ensureCache` (`packages/board/src/server/index.ts:493`, `:513`; `packages/board/src/server/fleet.ts:1682-1683`). `/api/fleet` serialises `issueAnswer` from the same cache entry (`fleet.ts:7669`). `/api/board` drops the answer that belongs beside its rows.
- **The page fetches the fleet only on Delivery.** `packages/board/src/app/App.tsx:516` returns before `loadFleet()` and its 4 s poll unless `tab === 'delivery'`. `App.tsx:1338` passes `issueAnswer={fleet?.issueAnswer ?? 'unsupported'}` to the Discovery tab. A page that opens or reloads on Discovery has `fleet === null`, so both buttons take the `unsupported` branch of `refusalReason` (`packages/board/src/app/components/CreatePlanButton.tsx:84`, `CreateStoryButton.tsx:94`) and print the Bitbucket sentence. After one Delivery visit, Discovery keeps that fleet reading with no poll, so a later failure does not show on Discovery.
- **The same default hides the absence sentence.** `App.tsx:1328` passes `issueAbsence={fleet?.issueAbsence ?? null}`. With no fleet, `discoveryGroups` (`packages/domain/src/rules/discovery-groups.ts:71`) falls back to "Tickets have not been read yet." For a `nobody` source, the server holds a standing reason (`fleet.ts:2206-2208`) that a fresh Discovery page never shows.
- **The server seeds a host fact before any read.** `freshCacheEntry` starts every cache entry at `issueAnswer: 'unsupported'` (`fleet.ts:2889`). `ensureCache` starts the first issue read asynchronously (`fleet.ts:2970-2971`), so the first answer after a board start reads `unsupported` on any tab, on a host whose read works.
- **The rule sits in two `.tsx` files.** `refusalReason` is duplicated in `CreatePlanButton.tsx:83` and `CreateStoryButton.tsx:93` and re-exported as `storyRefusal` (`packages/board/src/app/lib/agent-rows/menus.tsx:211`). Only the plan half has a unit test (`packages/board/test/unit/create-plan-button.test.ts`).
- **The browser tests hid the bug.** Four Discovery browser tests stub `/api/fleet` with `issueAnswer: 'answered'`, which Discovery never fetches (`discovery-ticket-card.browser.test.ts:57`, `discovery-groups-toggle.browser.test.ts:69`, `discovery-lanes-by-topic.browser.test.ts:64`, `discovery-mine-filter.browser.test.ts:81`, all under `packages/board/test/integration/`). `discovery-ticket-card.browser.test.ts:91-100` counts the buttons and never reads `aria-disabled`.

## Design

### Approach

**The board payload carries the issue answer.** `discoveryLanes` (`packages/board/src/server/discovery-lanes.ts:37-92`) returns `issueAnswer` and `issueAbsence` beside `tickets`, read from the same `ensureCache(opts)` entry. It reads them from the entry directly, not from `ticketLaneData`'s return: `ticketLaneData` returns `null` while `entry.issueSets === null` (`fleet.ts:1684`), and the `nobody` source has `issueSets === null` with `issueAnswer: 'unsupported'` and an absence sentence. `BoardSchema` gains `issueAnswer: IssueAnswerSchema.nullable().optional()` and `issueAbsence: z.string().nullable().optional()`, following the `tickets` precedent (`schema.ts:1475-1481`); neither field defaults to `'unsupported'`. `/api/board?archived=1` goes through the same `discoveryLanes` and gets both fields. Discovery reads them from `board`; `App.tsx:1328` and `App.tsx:1338` stop reading `fleet`. The fleet guard at `App.tsx:516` stays. The tab's existing `Loading…` (`App.tsx:1342`) covers the time before the first board payload, so no per-row loading state is added.

**The cold cache starts at `null`.** `freshCacheEntry` seeds `issueAnswer: null`, meaning "not read yet". `IssueAnswer` keeps its three members (`answered`, `unsupported`, `failed`; `schema.ts:3662`, `packages/domain/src/entities/issue.ts:12`); no fourth member. `null` lives only in the server's memory and on the wire; the issue index (`issues.json`, `packages/domain/src/entities/issue-index.ts:65`) and `IssueFetch.answer` (`issue.ts:93`) never hold it. Consumers that must handle `null`:

- `CacheEntry.issueAnswer` (`fleet.ts:503`): type `IssueAnswer | null`.
- `freshCacheEntry` (`fleet.ts:2889`): seeds `null`.
- `/api/fleet` (`fleet.ts:7669`) and `FleetShape.issueAnswer` (`schema.ts:4559`): `IssueAnswerSchema.nullable().default('unsupported')`. An absent field from an older server still decodes to `'unsupported'`; `null` passes through.
- `/api/board`'s new `issueAnswer` (above).
- `AgentList.tsx:1160, 2485, 2500, 2509, 2617, 2632` (Delivery's WAITING ON YOU): strict comparisons; `null` matches no arm, so the section shows no issue rows and no issue note until the first read answers. `AgentList.tsx:2537` passes `fleet.issueAnswer` to `IssueRowView` only inside the `answered` list; its prop type widens.
- `IssueRowView` (`packages/board/src/app/lib/agent-rows/rows.tsx:2805-2806`), `IssueRowActions` (`menus.tsx:1663-1664`), `storyRefusal` (`menus.tsx:211`), `StoriesTab` (`packages/board/src/app/components/StoriesTab.tsx:64`, `:466`), `CreatePlanButton` (`CreatePlanButton.tsx:42`) and `CreateStoryButton` (`CreateStoryButton.tsx:50`): prop type `IssueAnswer | null`; the domain rule below decides.
- `App.tsx:1338`: passes `board.issueAnswer ?? null`.

**One domain rule decides the button.** A new rule in `packages/domain/src/rules/create-from-issue.ts` takes the binding (`DispatchInfo`), the answer (`IssueAnswer | null`) and the kind (`plan` or `story`), and returns one of three outcomes:

- `available`: the answer is `answered` and the binding is available.
- `pending`: the answer is `null`. The button is inactive (`aria-disabled`) and shows no refusal sentence.
- `refused` with a reason: `unsupported` gives the host sentence, `failed` gives the outage sentence, and an unavailable binding gives the binding's reason, in that order (the order `create-plan-button.test.ts` pins today).

`CreatePlanButton`, `CreateStoryButton` and `storyRefusal` call it, so Delivery's issue rows (`menus.tsx:1718`, `:1731`) and Discovery's ticket rows apply one rule. The two wire fields stay separate, as `schema.ts:1313-1324` records.

**Older server, newer page.** An older server sends no `issueAnswer` on `/api/board`. The field decodes to `undefined`, `App.tsx` maps it to `null`, and Create plan and Create story stay `pending` (inactive, no sentence) until the server upgrades. They never show the Bitbucket sentence. A newer server with an older page: `BoardSchema` is a plain `z.object` (`schema.ts:1266`), so the older page strips the two new fields and keeps its current behaviour.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-discovery-tab-disables-create-plan-story/panel.md`):

- [x] Source: `/api/board` carries `issueAnswer` and `issueAbsence` beside `tickets` in `discoveryLanes`'s return, from the same cache entry (`fleet.ts:1682-1683`), as `.optional()` schema fields that never default to `'unsupported'`. Discovery reads them from the board payload and does not poll `/api/fleet`. The fleet-poll option and the per-row loading state are dropped; the tab's `Loading…` covers the first payload.
- [x] Cold cache: `freshCacheEntry` starts at `null` ("not read yet"), not `'unsupported'` (`fleet.ts:2889`). The board field is `IssueAnswer | null`; `IssueAnswer` gets no new member. With `null` the buttons stay quiet until the read answers. The consumers that handle `null` are listed under Approach.
- [x] `issueAbsence` (`App.tsx:1328`) gets the same fix in this slice.
- [x] One domain rule for the refusal, taking the binding, the answer and the kind, replaces `CreatePlanButton.tsx:83` and `CreateStoryButton.tsx:93`, with domain unit tests per case.
- [x] Tests: the domain rule's unit tests, and one assertion in `discovery-ticket-card.browser.test.ts` that proves the board is the source (see Tests).
- [x] Motivation: `board.idea` and `board.story` report only the localhost binding (`schema.ts:1316-1324`), not the issue read.
- [x] Out of scope: the Planning-tab fallbacks (`App.tsx:1485`, `:1498`, `:1558`) go to issue #2836; the "issue lookup is failing" sentence for an unreadable plans directory (`fleet.ts:2085-2090`) stays as it is.

### Tests

- **Domain unit** (`packages/domain/test/create-from-issue.test.ts`): for both kinds, `answered` with an available binding gives `available`; `null` gives `pending` with no sentence matching `/no issue read/`; `unsupported` gives the host sentence; `failed` gives the outage sentence; an unavailable binding gives its reason; a refused binding with `unsupported` names the tracker first. The seven cases of `packages/board/test/unit/create-plan-button.test.ts` move here, and the story half gains the cases it lacks today.
- **Browser** (`packages/board/test/integration/discovery-ticket-card.browser.test.ts`): the `board` stub carries `issueAnswer: 'answered'` and the `fleet` stub carries `issueAnswer: 'unsupported'`. On a fresh `?tab=discovery` page, `[data-create-plan="1688"]` and `[data-create-story="1688"]` carry no `aria-disabled`. The opposite fleet answer proves that the board payload is the source; this assertion fails before the fix.
- **Dead fleet stubs**: the other three Discovery browser tests (`discovery-groups-toggle:69`, `discovery-lanes-by-topic:64`, `discovery-mine-filter:81`) move `issueAnswer: 'answered'` from the `fleet` stub to the `board` stub where the edit is one line; any left unchanged is named in the PR.

### Open Questions

- [ ] With fleetd running and no issue index, `readIssuesFromStore` sets `issueAnswer: 'unsupported'` with the absence "the fleet has left no issue index to read" (`fleet.ts:2215-2218`), and the button prints "this git host has no issue read". Does the refusal take `issueAbsence` as its reason in that case, or does this stay a separate issue?

## Slices

### Board-carried issue answer

- `bug/discovery-tab-disables-create-plan-story` — `/api/board` carries `issueAnswer` and `issueAbsence` from the cache entry; the cold cache starts at `null`; one domain rule decides Create plan and Create story for both tabs; Discovery reads both fields from the board payload; domain unit tests and one browser assertion that the board is the source <!-- builds: issueAnswer and issueAbsence on BoardSchema, a nullable cold issueAnswer, a create-from-issue domain rule --> → #2851

## Notes

- Source: tracker issue #2833, https://github.com/plot-pm/plot/issues/2833. The plan names it in `Issue:` and writes nothing to the tracker.
- The Planning-tab fallbacks (`App.tsx:1485`, `:1498`: a plan age frozen after a Delivery visit; `App.tsx:1558`: the sprint modal's plan link depends on tab history) are issue #2836.
- Amended 2026-10-28 after panel round 1.
