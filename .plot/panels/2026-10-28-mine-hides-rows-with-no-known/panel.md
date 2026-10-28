# Panel moderation: mine-hides-rows-with-no-known, round 1

**Reconciliation:** unanimous `amend` (compatibility, domain-rules, operator, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran | Read |
|---|---|---|
| domain-rules | two vitest probes of `ownership`, `isMine`, `waitingTickets` | `ownership.ts`, every `isMine` call site, `AgentList.tsx`, `App.tsx` |
| operator | two vitest probes of `ownership`, `chipRow`, `waitingTickets`, `readerIsKnown` | `DeliveryFilters.tsx`, `chip-row.ts`, `chip-readings.ts`, `waiting-view.ts`, Discovery and Planning headers |
| compatibility | read-only `plot-host.sh account` in ewz-kus-portal (exit 4); a probe over 16 row shapes × 7 readers comparing today's `isMine` with a strict one | `ownership.ts`, `chip-row.ts`, `AgentList.tsx`, `App.tsx`, the 2026-09-24 plan |
| testability | baseline: named domain and board tests green; mutation: `isMine` changed to `=== 'mine'` in a scratch copy and the same files rerun | browser tests `mine-filter.browser.test.ts:145,576` (read only) |

All four executed. The mutation run is the strongest evidence: it measures the contract change instead of estimating it.

## Where the jurors agree

1. **The `[other, me]` defect is live today and ships first as its own bug.** `accountTicketOwnership` stops at the first declared assignee: `[mruepp, jan]` answers `theirs`, `[jan, mruepp]` answers `mine` (three probes). With «Mine» on, the reader's own ticket is hidden now. `waitingTickets` matches with every assignee (`waiting-tickets.ts:83-93`) but selects with `ownership === 'mine'` (`:223`), so the ticket is dropped and counted hidden with «Mine» off too. No test covers a `tracker-account` ticket with several assignees. The plan's "visible-anyway quirk" is wrong.
2. **There are six `isMine` call sites, not five.** The plan misses `boardForReader` (`mine-filter.ts:222`, `App.tsx:1481,1494`), which filters the Planning tab. Delivery, Planning and Discovery share one stored key (`MINE_KEY`), so a Delivery-only strict mode makes one stored `1` mean two things.
3. **The filter reads the raw stored flag, not the chip's effective state.** A disabled chip reports `on: false` (`chip-row.ts:165`), but `AgentList.tsx:499,726,758,1085` and `App.tsx:1481` filter on the stored `mineOnly`. Today that hides nothing. Under a strict rule, a reader the board cannot identify with a stored `1` gets an empty board behind a greyed chip with no count and no way back. The effective state must be one domain value that every filter site reads.
4. **Open question 3 names the wrong predicate.** `readerIsKnown` is true for a reader with only a git email (`ownership.ts:301`) and has no production caller; every ownership arm reads `comparableLogin`. On ewz-kus-portal (`account` exits 4, git email set) `readerIsKnown` is true and `comparableLogin` is `''`; strict «Mine» keeps 1 of 16 rows. The gate is `comparableLogin === ''`, the chip's own test (`chip-row.ts:163`).
5. **"N unknown" is not the configuration signal the plan claims.** It mixes rows a `People` entry can fix (an undeclared spelling) with rows nothing can fix (builds, bare branches, unassigned tickets, `elsewhere` agents).
6. **The plan misreads the existing count.** The chip's `N hidden` counts `theirs` among branch/PR rows (`chip-row.ts:168`, `chip-readings.ts:47`), not agent rows. It already is the proposal's "N others", so the mock-up shows one number twice.
7. **The *Unassigned* section reverses a second released line** (`2026-09-24-the-board-shows-me-only-my-work.md:121`: the filter never changes *Waiting on you*'s rule) and duplicates what `waitingTickets` does already: strict `mine`, unassigned hidden by default, a count sentence and `show every ticket`.
8. **The contract change is large.** The strict rule breaks 37 unit tests in 7 files (domain `ownership` 10, `lanes-for-reader` 7, `chip-row` 1; board `mine-filter` 4, `a-row-is-owned-by-more-than-its-pr` 10, `agent-list` 3, `plan-estate-branch-owner` 2) plus two browser tests. It hides 51 of 113 own plans when `People` is empty (`ownership.test.ts:162`).

## Where they differ

- **Agents (question 2).** domain-rules: a desk synthesized on this machine should answer `mine` at the source, and `elsewhere` stays unknown. compatibility: keep agents exempt from the strict filter, because a broken agent reads `unknown` and hiding it changes what *Waiting on you* means. Both keep the reader's own working desks visible; they differ on whether that is done by an answer or an exemption.
- **The rule's shape (question 1).** domain-rules: no Delivery-only mode; one domain function sorts every row into mine/theirs/unknown, all six sites read it, and `isMine` goes. testability: the rule slice can merge alone only as a stricter sibling that leaves `isMine` and its tests untouched. These are compatible as an order: add the sibling first, move the sites, remove `isMine` last.
- **Stored state (question 4).** compatibility: read the old key as "«Mine» on, unknown shown", which reproduces today's view exactly, and store the expansion under a new key. No juror disagrees.
- **Unassigned (question 5).** operator: drop the section, exempt tickets from the chip's unknown count, and split `waitingTickets.hidden` into unassigned and assigned-to-others. domain-rules and testability: if kept, it is its own plan. No juror argues to keep it in this plan.

## Shared blind spot

Every juror judged the rule against today's board and readers. None asked whether a reader wants the strict view at all once the `[other, me]` bug and #2808's slices are fixed: the issue's evidence (16 unassigned, an undeclared assignee, three Draft rows) was gathered with both bugs live. Part of what «Mine» "kept" was these bugs.

## Amendments the panel asks for

- Split the `[other, me]` fix into its own bug plan that ships first.
- Count six call sites; name the Planning tab; keep one stored key with a stated meaning.
- Make the effective «Mine» state a domain value, gated on `comparableLogin !== ''`, and read it at every filter site.
- Replace "N others · M unknown" with a design that reuses `N hidden` and says what the expansion shows, whether it persists, and where Discovery and Planning show it.
- Decide agents: answered `mine` at the source for local desks, `elsewhere` unknown.
- Drop *Unassigned* from this plan; at most split `waitingTickets.hidden`.
- State the contract change: the 2026-09-24 lines 121 and 123, the 37 unit tests and two browser tests.
- Order the slices: stricter sibling rule, then the effective-state value and the board control, then the removal of `isMine`.
