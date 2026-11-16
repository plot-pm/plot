# Juror: cost (round 2)

Position: amend

The round-1 amendments hold for the cost lens on three points: the bundle sentence (plan:26), the ticket ordering (slice 1 now waits on `feature/delivery-tickets-section`), and the PR rule written as a delta from `youCase` with `gateUnpassable` and the spent budget kept. The findings below are new, or they are costs that the amendments created.

## 1. Claims the source does not support

- **"You ignores Mine" removes the shipped loose rows from Unblock.** Plan:63 says "You places an item only when its `ownership === 'mine'`, in every Mine mode". Plan:64 says "A loose branch with no PR already shows both buttons (`AgentList.tsx:1165-1172`); that stays." The two lines contradict each other. A row with no PR and no person field reads as `{ kind: 'other' }` (`packages/board/src/app/lib/agent-rows/mine-filter.ts:141-145`), and `ownership` answers `'unknown'` for that kind (`packages/domain/src/rules/ownership.ts:288`). A loose branch has no desk and no plan by definition, so it is always `unknown`. Today the gate is lenient: `mineAllows` passes `unknown` in `off` and `mine` modes (`delivery-placement.ts:192-193`). With `=== 'mine'` every loose branch fails the You test, falls to `workGroup` (`:345`), and lands in Work items or in `unplaced`. `loose-ends-show-under-unblock.browser.test.ts` then breaks, and the Unblock group that this plan grows loses most of its rows. The same applies to any item whose owner cannot be determined, for example a reader with an empty host login (`ownership.ts:106,122,176,197`). The rule as written is today's `strict` mode applied everywhere. The plan does not count this blast radius.
- **Slice 2 "only renders" (Open Points, plan:124) is not true.** Slice 2 adds a plan-parser fact and a payload field next to `planSliceCount` (plan:69, plan:108). `planSliceCount` is a field of the board contract's `SliceSchema` (`packages/board/src/contract/schema.ts:2310`), filled from `rules/pulse.ts:68` and passed through `server/fleet.ts:4265`. A new fact on that path changes the contract, the domain reading and the server. No file today reads `### Open Questions` or `## Open Points` from a plan (`StoryCard.hasOpenPoints`, `schema.ts:1050`, is for stories only). That is a parser change and a schema change, not a render change.
- `nestItems`'s Draft exception is at `agent-rows/delivery-view.ts:246`, not `:248` (plan:68). This does not matter.

## 2. What no slice provides

- **Two slices claim Release · Delete on closed-PR rows.** Slice 1 claims "closed PRs on unnamed branches under Unblock" and the group-keyed tables, which include "the `loose` row's Do cell changes ... to 'Release · Delete'" (plan:62). Its Done When line requires "Release and Delete, both calling their controllers" (plan:79). Slice 2's list also names "Release · Delete on closed-PR Unblock rows" (plan:108). The guard that hides the buttons on any PR row, `item.rows[0]?.pr === null` (`AgentList.tsx:1167`), has to change in exactly one of these two slices.
- **After slice 1 merges, five slices start at once on the same files.** Slice 2 and slice 3 wait only on `feature/delivery-you-groups`. Plan 1's `feature/delivery-slice-states` and `feature/delivery-tab-todo-list` and plan 3's `feature/delivery-work-items-gates` also wait on it (`delivery-tab-header-and-my-sprint.md:121,125`, `delivery-work-items-show-gates.md:82`). The new collision is between slices 2 and 3: both edit the You header and rows in `AgentList.tsx` (1632 lines) and `agent-rows/delivery-view.ts`. Round 1's collision finding is fixed for slices 1 and 2 and appears again for slices 2 and 3.

## 3. What a builder would have to guess

- Which file the "plan-parser fact" goes into: the shell scan, `fleet.ts`, or a domain rule. If it goes into the shell, `scripts/check-shell-lines.sh` makes the builder delete an equal number of shell lines elsewhere.
- Whether the phase strip's story reading (`/api/stories`, plan:66) adds a new client fetch to the Delivery tab on every poll. The plan says the Discovery tab "already takes" it. It does not say whether the Delivery tab shares that fetch.
- How large slice 1 is. It now holds the 12-reason table, the markers, the PR rule, the Mine change, a readings change in the board (`delivery-readings.ts:128`), five group-keyed tables in two packages (`REASON_STATUS`/`REASON_DO` at `delivery-row-form.ts:107,123`; `GROUP_LABELS`/`REASON_WORDS` at `agent-rows/delivery-view.ts:32-57`; `holdersOf` at `delivery-row-form.ts:378`), the header counts, and the 18 test sites plus six board tests. That is the largest slice in the plan. It also sits on the critical path of plans 1, 3 and 5: section-header → tickets-section → you-groups → slice-states → release-plan-rows / release-card → my-sprint-scope. The downstream slices need only the placement and the markers. The closed-PR reading and the header counts could leave slice 1 and shorten that chain. The plan does not weigh this.

## 4. Most serious gap

The Mine change (plan:63) removes loose branches, and every other row of unknown ownership, from You. It contradicts plan:64 and breaks a shipped browser test. The fix is an edit to the plan, so the gap is not fatal: write the You gate as `ownership !== 'theirs'` (today's lenient test) in every mode, or exempt `loose` and the other reasons that cannot carry an owner, and add a Done When line that a loose branch with no PR still shows under Unblock in `strict` mode.

## Changes

1. Restate the You gate so that `unknown` passes, or list the reasons that bypass the gate. Add a unit case for a loose branch with no PR in every Mine mode.
2. Give the closed-PR Release · Delete rendering and the `AgentList.tsx:1167` guard to one slice, and remove it from the other slice's list.
3. Correct Open Points line 124: slice 2 changes the parser and the contract. Name the file that holds the open-question fact.
4. Make `feature/delivery-you-phase-strip` wait on `feature/delivery-you-plan-rows`, or state that the two slices touch disjoint parts of the You header.
5. Consider moving the closed-PR reading and the header counts into a slice after slice 1, so that the five downstream waits depend on a smaller slice.
