# «Mine» hides rows with no known owner and counts them

> «Mine» gets a stricter mode that keeps only rows the reader owns and counts the rows with no known owner in the existing `N hidden`. Today's view stays the default, one domain value decides the filter on all three tabs, and *Waiting on you* splits its hidden count into unassigned and assigned to others.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2811
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2812 merged
- **Started:** 2026-10-28, Jan Wloka, `feature/mine-strict-ownership-rule`
- **Started:** 2026-10-28, Jan Wloka, `feature/waiting-hidden-split`
- **Started:** 2026-10-28, Jan Wloka, `feature/mine-mode-control`
- **Started:** 2026-10-28, Jan Wloka, `feature/is-mine-removed`

## Changelog

- With «Mine» on, a control beside the filter hides the rows with no known owner too, and `N hidden` then counts them. The choice persists across reloads. The default view does not change.
- «Mine» filters nothing while the board cannot compare the reader's login with a row's owner, whatever the stored setting says, and every tab names the reason.
- The reader's own desks on this machine count as the reader's, with or without a manifest.
- *Waiting on you* names how many hidden tickets are unassigned and how many are assigned to someone else.

Board impact: changes the Delivery chip row, the Planning and Discovery «Only my work» header, and every «Mine» filter site in `packages/board`, and adds rules in `packages/domain` (`ownership`, `chip-row`, `lanes-for-reader`, `waiting-tickets`). The `WaitingTickets` wire shape gains two count fields. No change to the plan format, the template or the helper scripts. The board artifact needs a rebuild on merge.

## Motivation

A reader who turns on «Mine» asks for their own work. `isMine` answers true for `mine` and for `unknown` (`packages/domain/src/rules/ownership.ts:288`), so «Mine» keeps every row whose owner the board cannot determine, and no count says how many such rows there are.

`unknown` has several causes. Some rows carry an owner spelling that `People` does not declare, and a `People` entry fixes them. Other rows carry no owner at all: builds and bare branches (`ownedFromRow`'s `other` fallback), unassigned tickets, and agents whose desk is not on this machine. No configuration fixes those rows. So the unknown count is not a `People` signal, and this plan does not present it as one.

## Design

### Approach

**One domain value decides «Mine».** The domain computes the effective «Mine» mode from the reader and the two stored strings:

- `all` — «Mine» is off, or `comparableLogin(reader)` is `''` (the chip's own test, `packages/domain/src/rules/chip-row.ts:163`). Every row shows.
- `mine-and-unknown` — «Mine» is on and the stricter mode is off. Rows answering `theirs` hide. This is today's view.
- `mine` — «Mine» is on and the stricter mode is on. Only rows answering `mine` stay.

Every filter site reads this value, never the raw stored flag. Today the filters read the stored `mineOnly` directly (`packages/board/src/app/components/AgentList.tsx:499,726,758,1085`, `packages/board/src/app/App.tsx:1481`) while a disabled chip reports `on: false` (`chip-row.ts:165`). Under a strict mode that mismatch would empty the board behind a greyed chip. The value closes it.

**The gate is `comparableLogin`, not `readerIsKnown`.** `readerIsKnown` answers true for a reader with only a git email (`ownership.ts:301-302`) and has no production caller. Every ownership arm compares `comparableLogin` (`ownership.ts:104,120,154,184`). On a Bitbucket checkout where `plot-host.sh account` exits 4 and `PLOT_BUDGET_ACCOUNT` is unset, `comparableLogin` is `''`, the mode is `all`, and the Delivery chip and the Planning and Discovery checkbox both show the chip's disabled reason.

**Stored state.** The existing key `plot-board:agents:mine-only` (`packages/board/src/app/lib/agent-rows/mine-filter.ts:17`) keeps its meaning: `1` is «Mine» on with unknown rows shown. A new key holds the stricter mode, and an absent new key reads as off. A reader who never touches the new control sees today's view exactly. Both keys are per browser origin in `localStorage`, as the existing key is, and all three tabs share them.

**The control.** The chip's `N hidden` already counts the branch and PR rows that answer `theirs` (`chip-row.ts:168`, `packages/board/src/app/lib/agent-rows/chip-readings.ts:47`). It counts no registry agents and no tickets. The control reuses that count and adds no second number for the same rows:

```
mine-and-unknown:  [Mine (jwloka) 14 hidden]  hide 23 unknown
mine:              [Mine (jwloka) 37 hidden]  show 23 unknown
```

- The control shows only while the mode is `mine-and-unknown` or `mine` and the unknown count is above 0.
- In `mine`, `N hidden` counts the `theirs` rows plus the `unknown` rows, so the number always names every row the filter hides.
- The unknown count covers branch and PR rows and registry agents. Tickets stay out of it: *Waiting on you* counts its own hidden tickets.
- The labels and both counts are domain properties of `chipRow`. `ChipRowReadings` widens to take the registry agents. One browser test proves the chip row renders them.

**Planning and Discovery.** These tabs have no chip row. They share one «Only my work» header checkbox (`App.tsx:1305-1316`), which reads the same key as the Delivery chip. The same control renders beside that checkbox with the active tab's counts: Planning counts the plan cards `boardForReader` hides (`mine-filter.ts:216-225`), and Discovery counts the lane rows `lanesForReader` hides. `lanesForReader` returns its counts beside `hiddenByOwner` (`packages/domain/src/rules/lanes-for-reader.ts:23`). The checkbox gets the chip's disabled state and reason while the mode is `all` because of an empty `comparableLogin`.

**Agents.** `agentOwnership` answers `mine` only for a manifest agent with a desk here (`ownership.ts:247-250`). A synthesized desk whose state shows it is on this machine also answers `mine`, because the board's machine is the reader's machine. An agent whose state is `elsewhere` or `unknown` stays `unknown` (`NO_DESK_HERE`, `ownership.ts:82`), so it hides in the `mine` mode and the unknown count includes it.

**The stricter rule sits beside `isMine`.** Slice 1 adds the strict answer and the mode with no change to `isMine` or its tests. Slice 3 moves all six `isMine` call sites to the mode: `rowsForReader`, `agentsForReader`, `ticketsForReader` and `boardForReader` (`mine-filter.ts:159,173,207,222`), `lanesForReader` (`lanes-for-reader.ts:67`) and the chip's `hiddenCount` (`chip-row.ts:168`). Slice 4 removes `isMine` once nothing calls it.

**The *Waiting on you* hidden count splits.** `waitingTickets` already keeps only the reader's tickets and counts the rest in one `hidden` number, which `hiddenSentence` renders as *N open tickets are not assigned to you* (`packages/domain/src/rules/waiting-tickets.ts:235-238`). The rule adds two fields, `unassigned` and `assignedToOthers`, whose sum is `hidden`, and the sentence names both, for example *3 open tickets are not assigned to you — 1 unassigned*. `hidden` keeps its meaning, so an older consumer of the wire shape still reads it. The section's rule does not change.

### Contract Change

- `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md:123` says a row whose owner cannot be determined is shown, never hidden. The `mine` mode reverses that line for a reader who turns it on. The default mode keeps it. The released plan stays unchanged as the record of 2026-09-24.
- `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md:120` says the filter subtracts from the view and never changes *Waiting on you*'s rule. That line still holds: the hidden-count split changes the sentence, not which tickets the section selects.
- Applied as the only rule, the strict answer breaks 37 unit tests in 7 files: `packages/domain/test/ownership.test.ts` (10), `packages/domain/test/lanes-for-reader.test.ts` (7), `packages/domain/test/chip-row.test.ts` (1), `packages/board/test/unit/mine-filter.test.ts` (4), `packages/board/test/unit/a-row-is-owned-by-more-than-its-pr.test.ts` (10), `packages/board/test/unit/agent-list.test.ts` (3) and `packages/board/test/unit/plan-estate-branch-owner.test.ts` (2). It also breaks two browser tests, `packages/board/test/integration/mine-filter.browser.test.ts:145` and `:576`. The tests that pin the lenient view keep their meaning as the `mine-and-unknown` mode. Each test that slice 3 or slice 4 rewrites is a named contract change in that slice's PR.
- The `mine` mode also hides the reader's own work where the owner reads `unknown`: plan cards with free-text owner names when `People` is absent (51 of 113 plans, `ownership.test.ts:162`), and tickets whose tracker spelling `People` does not declare (`lanes-for-reader.test.ts:74`). The `show N unknown` control is the way back, and the default mode is unaffected.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-mine-hides-rows-with-no-known/panel.md`):

- [x] The `[other, me]` multi-assignee defect in `accountTicketOwnership` leaves this plan. It is issue #2819, planned separately and shipping first.
- [x] Rule shape: a stricter rule beside `isMine` first, with no change to `isMine` or its tests; then one effective «Mine» value gated on `comparableLogin !== ''` that all six call sites and every raw-flag reader use; then `isMine` goes once nothing calls it.
- [x] Agents: a desk on this machine answers `mine` at the source; an `elsewhere` agent stays `unknown`.
- [x] The *Unassigned* section is dropped. *Waiting on you*'s hidden count splits into unassigned and assigned to others, as a domain field in `waitingTickets`, in its own slice because it is independent of the strict rule.
- [x] Stored state: the existing key keeps meaning «Mine» on with unknown shown; the stricter mode lives under a new key.
- [x] The control reuses `N hidden` and adds no «N others» count.
- [x] Is the unknown count a `People` signal? No: it mixes fixable spellings with rows nothing can fix. A split by cause is not in this plan.
- [x] *Show every ticket* in the `mine` mode: the box wins. It shows every open ticket, narrowed only by the `mine-and-unknown` answer, so an unassigned ticket comes back (`waiting-view.ts:97`, `mine-filter.browser.test.ts:576`). The mode filters the other sections.

## Slices

### Strict ownership rule

- `feature/mine-strict-ownership-rule` — Domain only: a strict ownership answer beside `isMine`, the effective «Mine» mode with its stored-key reader, and a synthesized desk on this machine answering `mine`. `isMine` and its tests stay unchanged; `ownership.test.ts:107` changes deliberately. <!-- builds: strict ownership answer, effective Mine mode, local desk answers mine --> → #2823

### Waiting hidden split

- `feature/waiting-hidden-split` — Domain: `waitingTickets` splits `hidden` into `unassigned` and `assignedToOthers`, and `hiddenSentence` names both; independent of the other slices. <!-- builds: unassigned and assigned-to-others counts --> → #2829

### Mine mode control

- `feature/mine-mode-control` — Board: all six `isMine` call sites and every raw-flag reader move to the effective mode; the hide/show unknown control on the Delivery chip row and the Planning and Discovery header; counts from `chipRow` and `lanesForReader`; the new storage key. <!-- builds: hide/show unknown control, disabled Only my work checkbox --> → #2849

### isMine removal

- `feature/is-mine-removed` — Domain: removes `isMine` and its tests once no production code calls it. → #2870

## Notes

- Created from issue #2811 by `/plot-idea`.
- Depends on #2819 (`[other, me]` answers `theirs` in `accountTicketOwnership`). That bug ships first: under the `mine` mode a wrongly `theirs` ticket is hidden with no count to bring it back.
- `bug/draft-rows-obey-mine` in `2026-10-28-empty-jira-inbox-read-as-a` adds a seventh `isMine` caller for Draft plan rows. If it merges first, slice 3 moves that caller too.
- Slice order: slices 1 and 2 merge in any order; slice 3 needs slice 1; slice 4 needs slice 3. Each slice leaves `main` green on its own.
