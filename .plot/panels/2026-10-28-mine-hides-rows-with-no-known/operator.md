# Juror verdict: operator

Position: amend

Evidence: Read the plan, issue #2811 (`gh issue view`), `packages/domain/src/rules/chip-row.ts`, `ownership.ts:92-302`, `lanes-for-reader.ts`, `waiting-tickets.ts:112-249`, `packages/board/src/app/components/DeliveryFilters.tsx`, `lib/agent-rows/mine-filter.ts`, `chip-readings.ts`, `waiting-view.ts`, `AgentList.tsx:415-430,720-760,2480-2560`, `StoriesTab.tsx:320-410`, `App.tsx:280-283,1300-1345`, and `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md:123`. Ran two scratch vitest probes against the worktree's domain sources (`scratchpad/juror2811-operator/probe.test.ts`, `probe2.test.ts`), using `ownership`, `chipRow`, `waitingTickets` and `readerIsKnown`. Results are quoted below as "ran".

## (a) Problem statement

1. **The `N hidden` claim is wrong in two ways.** The plan says the chip shows `N hidden` "for agent rows only (`DeliveryFilters.tsx:87-91`)". First, the count is over `fleet.rows` (the `AgentRow` branch/PR rows) after the sprint filter (`chip-readings.ts:47`, `AgentList.tsx:735-743`). It is not over registry agents (`agentsForReader`, `AgentList.tsx:499`) and not over tickets. Second, it counts only `theirs`: `chip-row.ts:168` filters `!isMine`, and `isMine` is true for `unknown`. Ran: four rows `[pr jwloka, pr mruepp, other, plan "Somebody Unknown"]` give `hiddenCount: 1`. The two `unknown` rows are not counted. So today's `N hidden` already **is** the proposal's `N others`, for branch rows only.
2. **Discovery has no chip row.** Planning and Discovery use one header checkbox labelled *Only my work* (`App.tsx:1305-1316`). Delivery uses the `Mine (login)` chip. These are two names and two widgets for one stored key (`plot-board:agents:mine-only`, `mine-filter.ts:17`). Discovery's only owner signal is the per-lane empty text "Only my work hides every … in this lane" (`StoriesTab.tsx:333-337, 402-406`), which fires only when a lane becomes empty (`lanes-for-reader.ts:68`). Slice 2 says Discovery "renders the «N unknown ▸» control" but names no place for it.
3. **The plan leaves out the Planning tab.** `boardForReader` (`mine-filter.ts:216-225`) is the sixth ownership caller and reads the same toggle (`App.tsx:1481,1494`). The plan counts five callers and scopes the change to "Delivery and Discovery". A strict mode changes Planning too, unless the plan exempts it by name.
4. **Unassigned tickets are already out of *Waiting on you*.** `waitingTickets` uses strict `mine` (`waiting-tickets.ts:119-121, 187-188, 220-221`). It hides unassigned tickets and counts them. Ran: tickets `[jan], [], [mr], [zz]` for reader jwloka give `tickets ['1'], shown 1, hidden 3`. The sentence is `3 open tickets are not assigned to you` (`waiting-tickets.ts:235-238`), and `show every ticket` (`waiting-view.ts:5,85`) adds them back. So the proposal's "Unassigned tickets go to their own section instead of *Waiting on you*" describes the default view as it is today. The real gap is narrower: the hidden sentence puts "unassigned" and "assigned to someone else" into one number.
5. **"A high `unknown` count is a configuration signal" is only partly true.** `ownership` answers `unknown` for at least four different causes:
   - an undeclared `People` spelling, which is a configuration fault;
   - a ticket with no assignee (ran: `ticket []` → `unknown`), which is real unowned work;
   - a branch row with no PR and no plan owner, or a build row (`mine-filter.ts:96-101` → `other`), which is unowned by design;
   - a desk-inferred or `elsewhere` agent (ran: `agent desk running` → `unknown`).
   One number cannot tell the reader which `People` entry to add. Only the first cause is a configuration signal.
6. Confirmed by running: `[mr, jan]` on a `tracker-account` source answers `theirs` (`ownership.ts:158-162`). This contradicts the doc comment at `ownership.ts:176`.

## (b) Approach

1. **The proposed control duplicates the chip's own count.** With «Mine» on, the chip already renders `Mine (jwloka) 14 hidden` (`DeliveryFilters.tsx:86-91`). The mock-up adds `14 others · 23 unknown ▸` beside it, so the same 14 shows twice under two words ("hidden", "others"). The minimal form keeps one place for each number. Either the chip keeps `14 hidden` and only `· 23 unknown ▸` is added, or the in-chip count moves into the new control. "others" and "hidden" must not both name the same rows.
2. **"One control, not two toggles" does not hold as written.** A click "adds the unknown rows back", so the control has two states. The plan does not say what the control shows in its second state (for example `23 unknown ◂` or `showing 23 unknown`), and it does not say whether the state survives a reload. If it is stored, it is a second toggle with a second storage key. If it is not stored, the unknown rows disappear again on each reload of a board that "is reloaded several times an hour" (`mine-filter.ts:13-15`). Choose one and write it into the design.
3. **There is a direct conflict with `show every ticket`.** `waitingView` applies the «Mine» narrowing last, to the union of `issues` and `waiting.tickets` (`waiting-view.ts:97`). Today the loose filter keeps unassigned tickets there. With strict «Mine» on, that union narrows back to `mine`, so the `show every ticket` checkbox does nothing visible while «Mine» is on. The reader sees a checked box and no change. The plan must decide which control wins for tickets.
4. **A stored filter can empty the board while the chip reads off.** `mineChip` returns `on: false` while disabled (`chip-row.ts:164-166`). However, `AgentList` filters with the raw stored `mineOnly` at all four sites (`AgentList.tsx:499, 726, 758, 1085`), and nothing checks whether the chip is disabled. Today this is harmless because `unknown` stays visible. Under strict mode, a reader with stored `mine-only=1` and no comparable login sees an empty board and a chip that reads off and disabled.
5. **`readerIsKnown` is the wrong test for the fallback.** Ran: a `gitEmail`-only reader and an email-shaped `hostUser` both give `readerIsKnown: true`. Every row still answers `unknown`, and the chip is disabled with a reason. Open question 3 asks about `readerIsKnown`, but the predicate that matches the chip is `comparableLogin(reader) !== ''` (`chip-row.ts:163-165`).
6. **The layering is right.** The count and the control's visibility as `chipRow` properties follow "Every rendered state is a domain property". `DeliveryFilters` already only renders `chipRow()` output (`DeliveryFilters.tsx:106`). The Discovery count would also need a domain home, for example `lanesForReader` returning a count beside `hiddenByOwner`, and not a count made in `StoriesTab.tsx`.

## (c) Slices

- Slice 1 is cut correctly, but the `[mr, jan]` fix should ship first as its own bug plan. Today it hides an own ticket whenever «Mine» is on, because `theirs` is hidden even under the loose rule. It is a defect now, not only after this plan.
- Slice 2 is too broad for one branch. Delivery has a chip row and Discovery and Planning have a checkbox, so these are two UI surfaces. Split it, or name the Discovery and Planning placement before approval.
- Slice 3 (*Unassigned* section) should leave this plan or change shape. Finding (a)4 shows that the default *Waiting on you* view already excludes unassigned tickets. The minimal change is a domain change to `waitingTickets` and `hiddenSentence`: split `hidden` into `assignedToOthers` and `unassigned`, for example "3 open tickets are not assigned to you — 1 unassigned". That keeps one control (`show every ticket`). A new collapsed section would be a third place that lists or counts the same tickets.

## (d) Open questions

- **Q5 (Unassigned versus the unknown count for tickets):** neither, as proposed. Tickets should be **exempt from the chip's «N unknown»**. *Waiting on you* already has its own hidden count and its own control for these exact rows, and counting them in the chip as well counts them twice in two places. Do not add a section. Split the existing `waitingTickets.hidden` into unassigned and assigned to others. An unassigned ticket is not a `People` configuration fault, so it does not belong in a count whose stated purpose is to show configuration faults.
- **Q3:** «Mine» must not filter while `comparableLogin(reader) === ''`. The filter must read the chip's effective `on` (false while disabled), not the stored value. The Discovery and Planning checkbox needs the same disabled state with the same reason text. It has no disabled state today (`App.tsx:1305-1316`).
- **Q4:** keep the key. Show the «N unknown ▸» control on the first render after the upgrade so the change is visible. A reader who sees `23 unknown ▸` beside the chip can see that rows are hidden and can bring them back with one click. No separate notice is needed if the control is always shown while N > 0.
- **Q2 (agents):** from this lens, exempt agent rows, or count them separately. A desk without a manifest is not something `People` can fix, so mixing it into the unknown count makes the number less useful.
- **New question A:** is the «unknown» count split by cause (unresolved spelling versus no owner named)? Only the first is the configuration signal the Motivation names. `ownership` would need to return the reason, for example `unknown: 'unresolved' | 'unowned'`.
- **New question B:** does the existing in-chip `N hidden` stay, move, or get renamed to "others"? Pick one word.
- **New question C:** what does the unknown control show once clicked, and does that state persist?
- **New question D:** does strict «Mine» apply to Planning cards (`boardForReader`)?

## (e) Tests

- Domain unit, `chip-row.test.ts`: in strict mode, `hiddenCount` counts `theirs` plus `unknown`, `unknownCount` counts `unknown`, and the control is absent when the count is 0 or the chip is disabled. Assert one fixture with both kinds of row. My probe's four-row set separates the two numbers (1 versus 3).
- Domain unit, `ownership.test.ts`: `[mr, jan]` gives `mine`, and the unknown reason is split by cause if new question A is adopted.
- Domain unit, `waiting-tickets.test.ts`: the hidden count is split into unassigned and assigned to others, using the probe's four tickets (`hidden 3` becomes 1 unassigned and 2 others).
- Domain unit, new: the effective `on` is false when `comparableLogin` is empty and `mine-only=1` is stored, so the rows are untouched.
- Board unit: `waitingView` with strict «Mine» and `showEvery` gives a defined, asserted result for the conflict in (b)3.
- Browser: one test that the chip row renders the control text from `chipRow`, and one Discovery test for the chosen placement. No browser test should decide a count.

## Amendments

1. Correct the "agent rows only" claim. `N hidden` counts `theirs` among branch/PR rows (`chip-row.ts:168`, `chip-readings.ts:47`), and it equals the proposed "N others".
2. Remove the duplicate number. Keep `N hidden` in the chip and add only `· M unknown ▸`, or move the count out of the chip. Use one word.
3. Define the control's second state and whether it persists.
4. Drop the *Unassigned* section slice. Split `waitingTickets.hidden` into unassigned and assigned to others, keep `show every ticket` as the one control, and exempt tickets from the chip's unknown count.
5. Resolve the conflict between strict «Mine» and `show every ticket` (`waiting-view.ts:97`).
6. Replace `readerIsKnown` with `comparableLogin(reader) !== ''` in Q3. Make every filter site use the chip's effective `on` (`AgentList.tsx:499,726,758,1085`), and give the Discovery and Planning checkbox the same disabled state.
7. Name the Discovery placement of the control (there is no chip row there), and add Planning (`boardForReader`) to the caller list and the scope.
8. Ship the `[mr, jan]` fix first as a bug plan. It hides an own ticket today.
9. Qualify the "configuration signal" claim, or split `unknown` by cause so the count names what `People` lacks.
