# Juror verdict: layering (rendered state is a domain property; board payload versus fleet as the source)

Position: amend

Evidence: Read the plan, issue #2833 (`gh issue view 2833`), `packages/board/src/app/App.tsx:500-520, 1320-1343`, `CreatePlanButton.tsx:37-92`, `CreateStoryButton.tsx:76-102`, `StoriesTab.tsx:34-64, 180, 466-505`, `lib/agent-rows/menus.tsx:15, 211, 1663-1731`, `contract/schema.ts:1313-1329, 1415-1429, 1476-1482, 3662, 4490-4567`, `server/index.ts:461-520`, `server/discovery-lanes.ts:16-93`, `server/fleet.ts:1654-1700, 1966-2094, 2195-2262, 2540-2577, 2886-2889, 2921-2972, 7666-7669`, `packages/domain/src/entities/issue.ts:1-13, 85-95`, `domain/src/rules/discovery-groups.ts:40-71`, `test/integration/discovery-ticket-card.browser.test.ts:40-125`, `test/unit/create-plan-button.test.ts`. Ran: `vitest run --project parallel test/unit/create-plan-button.test.ts` (7/7 pass), and a scratch probe under `scratchpad/juror-2833-layering/` that imports both `refusalReason`s, the domain `IssueAnswerSchema` and the board `BoardSchema`. The probe printed: the `?? 'unsupported'` path yields both Bitbucket sentences on a CAN binding; the domain enum is `['answered','unsupported','failed']` and rejects `'loading'`; `BoardSchema` has `tickets` and `idea` keys and no `issueAnswer` key.

## (a) Problem statement

- The cited lines are correct: `App.tsx:516` is `if (tab !== 'delivery') return;`, `App.tsx:1338` is `issueAnswer={fleet?.issueAnswer ?? 'unsupported'}`, `CreatePlanButton.tsx:84` and `CreateStoryButton.tsx:94` are the `unsupported` branches. The probe reproduces the symptom at function level.
- One fact in Motivation misleads. "`/api/board` answers `idea` and `story` as `available: true`" is not evidence that the issue read works. `ideaAvailability(HOST)` / `storyAvailability(HOST)` (`server/index.ts:500, 507`) answer only the localhost binding; `schema.ts:1316-1324` states that `idea` "answers only half the question" and that `issueAnswer` is the other half. The plan should cite `/api/fleet`'s `issueAnswer: "answered"` alone as the disagreement, or the reader concludes that `board.idea` already covers the issue read and fold the two.
- A cause is missing: the same defect hits `issueAbsence`. `App.tsx:1328` passes `fleet?.issueAbsence ?? null`, and `discoveryGroups` (`domain/src/rules/discovery-groups.ts:71`) then falls back to the generic `TICKETS_NOT_READ_REASON` instead of the source's absence sentence (for example a Bitbucket repo with no tracker) on a fresh Discovery page. This answers the plan's second open question: yes, one more control, and it has the same root.
- The real root is narrower than "Discovery has no fresh source". The server already holds the answer: `/api/board` calls `discoveryLanes` → `ticketLaneData` → `ensureCache(opts)` (`fleet.ts:1683`), and `ensureCache` starts the pulse clock (`fleet.ts:2971-2972`) that runs `refreshIssues`/`readIssuesFromStore` (`fleet.ts:2572-2573`). So the issue read runs whatever tab the client shows, and `tickets` in `/api/board` is lanes from the same `CacheEntry` whose `issueAnswer` `/api/fleet` serialises (`fleet.ts:7669`). The board payload carries the rows and drops the answer that belongs beside them. The schema's own rule for the fleet (`schema.ts:4494-4497`, `fleet.ts:7666-7668`: "the inbox travels with its ANSWER, never alone") is broken by `/api/board`'s `tickets`.

## (b) Approach

**Source: the board payload, not the fleet poll.** Of the two options in Design §2, only the second satisfies the layering lens:

- Rows and the answer that qualifies them must come from one snapshot. A ticket row from the 30 s board poll (`App.tsx:39`) with an `issueAnswer` from a 4 s fleet poll (`App.tsx:40`) are two readings of one `CacheEntry` taken at different instants; a client that combines them invents a state the server never held. Carried in one payload, a row cannot exist without its answer, and the question "which is true when they disagree" does not arise for Discovery.
- When `/api/board` and `/api/fleet` disagree today, the disagreement is only timing skew over the same `CacheEntry`; neither is more authoritative. For a Discovery ticket row the truth is the payload that carried the row, which is `/api/board`. Delivery keeps reading `fleet.issueAnswer` beside `fleet.issues` for the same reason.
- Polling the fleet on Discovery reverses a measured decision (`App.tsx:513-514`: "a background 4 s poll would cost the same as a foreground one") to obtain one enum, and leaves the skew in place.
- "Changes the payload contract" overstates it: the change is an additive, defaulted field. Put it in `discoveryLanes`'s return (`discovery-lanes.ts:92`) beside `tickets`, read from the same `ensureCache` entry inside `ticketLaneData`, so both come from one read of the entry. Carry `issueAbsence` the same way.

**"Loading" does not belong in the domain, and with the source above it is not needed.**

- `IssueAnswer` is a domain entity (`domain/src/entities/issue.ts:12`) declared `plot-state: reading` — "the outcome of ONE fetch". It is also the `answer` of `IssueFetch` and of the persisted issue index (`fleet.ts:2016, 2090`). "The client has not received a payload yet" is not the outcome of a fetch and must not become a value that `issues.json` can hold. Adding it would also change a declared reading enum that `scripts/check-state-declarations.sh` audits.
- "Not loaded" is a transport state of the page, and the board already renders it: `App.tsx:1322, 1343` shows `Loading…` until `board` is non-null. Once `issueAnswer` rides on `/api/board`, no ticket row can render before its answer arrives, so Design §1 (a loading state for an unread `issueAnswer`) is unnecessary; deleting `?? 'unsupported'` is enough.
- An older server that omits the new field is the one remaining "no answer" case. Default the board field to the same safe value the fleet schema uses (`schema.ts:4559`: `unsupported`, so that silence is never read as `answered`), or make it `.optional()` and let the domain rule map absence to a neutral refusal that names the missing field. Do not invent a `loading` value for it.
- There is a server-side conflation that the plan should name without fixing here: the cold cache sets `issueAnswer: 'unsupported'` before any lookup (`fleet.ts:2886-2889`). It is harmless for Discovery because `tickets` is null until `issueSets` is set (`fleet.ts:1684`), so no button renders. It is the honest analogue of this bug on the server.

**Every rendered state is a domain property.** The decision now lives in `.tsx` (`CreatePlanButton.tsx:83`, `CreateStoryButton.tsx:93`, re-exported through `menus.tsx:15, 211`). Moving it to one domain rule over `(binding: DispatchInfo, issueAnswer: IssueAnswer, kind: 'plan' | 'story')` is correct and keeps the deliberate split that `schema.ts:1313-1324` records: two fields on the wire, one rule that combines them. Do not fold `issueAnswer` into `board.idea`/`board.story` on the server: those fields are per-request binding facts (`index.ts:478-484`), and the Delivery menus (`menus.tsx:1663-1731`, `rows.tsx:2805`) pass `fleet.issueAnswer` separately, so a folded field would give the two tabs two different rules.

A further wording defect sits in the same rule: when the plans directory is unreadable, the server sets `issueAnswer = 'failed'` although the tracker answered (`fleet.ts:2085-2090`, `2238-2244`), and the button then says "the issue lookup is failing". That is a wrong sentence rather than a wrong state; name it as a follow-up and keep it out of this slice.

## (c) Slices

- One branch is the right cut for a board-only bug. The order inside it matters: the server field first, then the client wiring, then the domain rule, so that each commit keeps the board green.
- Nothing needs to ship separately first. If the plan keeps the fleet-poll option, the domain move should split out, because it is a refactor with no behaviour change; with the board-payload option all three changes fit in one diff.
- Add `issueAbsence` (`App.tsx:1328`) to this slice; it is the same defect.

## (d) Open questions

- **Poll the fleet on Discovery, or move `issueAnswer` into the board payload?** Move it, beside `tickets` in `discoveryLanes`'s return. Evidence: same `CacheEntry` (`fleet.ts:1683`, `7669`); the server's issue read runs from `/api/board` alone (`fleet.ts:2971`, `2572-2573`); one snapshot avoids the 30 s/4 s skew (`App.tsx:39-40`).
- **Does another Discovery control have the same `null` default?** Yes: `issueAbsence` at `App.tsx:1328`, rendered through `discoveryGroups` (`discovery-groups.ts:71`). `StoriesTab.tsx:504-505` is the same call site as the ticket rows; the Delivery paths (`menus.tsx`, `rows.tsx`) read the fleet that tab already polls and are not affected.

New questions the plan should carry:

- What does the board field default to for an older server: `unsupported` (the fleet's precedent, `schema.ts:4559`) or `.optional()` with absence handled in the domain rule?
- Does `/api/board?archived=1` (`index.ts:513`) need the same field? It goes through the same `discoveryLanes`, so it gets it for free if the field lives there.
- Should the plan record the cold-cache `unsupported` (`fleet.ts:2889`) as a known server-side conflation, so a later consumer of the new board field does not read it as a host fact?

## (e) Tests

- **Domain unit** (`packages/domain/test/`): the moved rule returns `''` for `(available, 'answered')`, the no-issue-read sentence for `unsupported`, the failing sentence for `failed`, and the binding's reason when the binding refuses, for both `plan` and `story`. Port the seven cases of `test/unit/create-plan-button.test.ts` and the story equivalents. This is where the decision is asserted.
- **Board unit**: `discoveryLanes` (or `/api/board` built over a stubbed `CacheEntry`) returns `issueAnswer` and `issueAbsence` equal to the entry's, including `answered` with tickets present and `unsupported` with `tickets: null`.
- **Browser, one test**: open `?tab=discovery` with `board` carrying tickets and `issueAnswer: 'answered'`, and with `/api/fleet` routed to a failure or to `issueAnswer: 'unsupported'`; assert that `[data-create-plan]` is enabled and carries no refusal title. Routing the fleet to the opposite answer is what proves that the source is the board. The existing `discovery-ticket-card.browser.test.ts:49-58` supplies `fleet: buildFleet({ issueAnswer: 'answered' })`, which the page never fetches on `tab: 'discovery'`, and its assertions (`:91-100`) only count the buttons. It therefore passes while this bug is live; amend it to assert enablement, or the new test duplicates a fixture that hides the defect.

## Amendments

1. Choose the board payload: add `issueAnswer` and `issueAbsence` to `discoveryLanes`'s return beside `tickets`, read from the same `ensureCache` entry, and drop both `fleet?.` reads at `App.tsx:1328, 1338`. Close the first open question with the evidence above.
2. Remove Design §1's new "loading" value. Do not extend the domain `IssueAnswer` enum; the page's `Loading…` before the first board payload already covers "not loaded". Name the default for an older server that omits the field.
3. Correct Motivation: `board.idea`/`board.story` are binding-only (`schema.ts:1316-1324`) and do not show that the issue read works.
4. Move the refusal decision into one domain rule over `(binding, issueAnswer, kind)`; keep the two wire fields separate, and have `CreatePlanButton`, `CreateStoryButton` and `menus.tsx:211` call it.
5. Add `issueAbsence` to the slice, and answer the second open question with `App.tsx:1328`.
6. Tests: domain unit for the rule, board unit for the payload field, and one browser test on a fresh `?tab=discovery` with the fleet routed to disagree; fix `discovery-ticket-card.browser.test.ts` so that it asserts enablement.
7. Record as follow-ups outside this plan: the cold-cache `unsupported` at `fleet.ts:2889`, and the "lookup is failing" wording when only the plans directory is unreadable (`fleet.ts:2085-2090`).
