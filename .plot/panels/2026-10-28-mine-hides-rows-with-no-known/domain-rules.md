# Juror verdict: domain-rules

Position: amend
Evidence: Read `packages/domain/src/rules/ownership.ts`, `entities/person.ts`, `rules/chip-row.ts`, `rules/lanes-for-reader.ts`, `rules/waiting-tickets.ts`, `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `chip-readings.ts`, `AgentList.tsx`, `App.tsx`, `DeliveryFilters.tsx`, `packages/domain/test/ownership.test.ts`, `chip-row.test.ts`, the 2026-09-24 plan, and issue #2811 (`gh issue view`). Ran two vitest probes from `scratchpad/juror2811-domain-rules/` against the worktree's domain source (worktree HEAD `21dae9a69`): `probe.test.ts` (`ownership`, `isMine`, `chipRow`, `lanesForReader` over 21 cases) and `probe2.test.ts` (`waitingTickets` with a Jira source). No repo file was changed.

## (a) Problem statement

Cited lines that hold: `ownership.ts:176` (the "any match is `mine`" sentence), `ownership.ts:247-250` (`agentOwnership`; the body is at 248-251), `chip-row.ts:168`, `lanes-for-reader.ts:67`, `DeliveryFilters.tsx:87-91`, and plan 2026-09-24 line 123. The test pins also hold: `packages/domain/test/ownership.test.ts:200,269` (the plan gives no directory; the file is under `test/`, not `test/rules/`) and `chip-row.test.ts:141`.

Facts that are wrong or incomplete:

1. **The `[mruepp, me]` defect is not a "visible-anyway quirk". It hides the reader's own ticket today, in two places.** Probe output: `ownership(ticket(['mruepp','jan'], jira))` gives `"theirs"`, and `isMine` gives `false`. So `ticketsForReader` (`mine-filter.ts:207`) and `lanesForReader` (`lanes-for-reader.ts:67`) already hide that ticket while «Mine» is on. Reversing the order to `['jan','mruepp']` gives `"mine"`, so the answer depends on assignee order. Only the `tracker-account` arm has this defect. The `host-login` arm loops correctly (`ownership.ts:188-195`, and the probe gives `[mruepp, jwloka]` → `"mine"`).
2. **The defect also breaks *Waiting on you* with «Mine» off.** `waitingTickets` checks whether the reader matched with `accountMatches` (`waiting-tickets.ts:83-93`), which scans every assignee. It then selects rows with `ownership(...) === 'mine'` (`:223`), which stops at the first declared assignee. Two implementations answer one question differently inside one function. Probe: rows `#1 [jan]`, `#2 [mruepp, jan]`, `#3 [mruepp]`, no inbox → `tickets: ["1"], shown: 1, hidden: 2`. The reader's ticket #2 is hidden and counted as somebody else's. An inbox read masks this only where it returns the row.
3. **There are six `isMine` call sites, not five.** `mine-filter.ts` has four: `rowsForReader` :159, `agentsForReader` :173, `ticketsForReader` :207 and `boardForReader` :222. `lanes-for-reader.ts:67` and `chip-row.ts:168` are the other two. The plan never names `boardForReader`, which filters the **Planning** tab's Kanban and Swimlanes (`App.tsx:1481,1494`). That tab's "Only my work" checkbox (`App.tsx:1305-1315`) reads the same `MINE_KEY` (`mine-filter.ts:17`) as the Delivery chip (`AgentList.tsx:422`). `waitingTickets` calls `ownership` directly (`:188,:223`), so the multi-assignee fix reaches it too.
4. **"The chip shows `N hidden` for agent rows only" uses the wrong word.** `hiddenCount` is computed over `sprintFilteredRows` mapped through `ownedFromRow` (`chip-readings.ts:47`). Those are the Delivery *branch* rows (`AgentRow`). They are not `kind: 'agent'` registry rows, and they are not tickets. Today the count leaves out registry agents and *Waiting on you* tickets. Written as "agent rows" next to `agentOwnership`, a reader takes it for the opposite.
5. **The motivation over-claims the configuration signal.** A high `unknown` count means that `People` lacks spellings only for some `unknown` answers. In the probe, `plan author "Max A."` gives `unknown`, an undeclared spelling that `People` can fix. `{kind:'other'}` (builds, bare branches, `ownedFromRow`'s fallback at `mine-filter.ts:100`), unassigned tickets, `source: null`, and synthesized or `elsewhere` agents also give `unknown`, and no `People` entry can change them. A single «N unknown» mixes the two kinds and does not tell the reader what to fix.

## (b) Approach

- **Do not redefine `isMine`.** Its contract is permissive in the name, the doc (`ownership.ts:278-288`), the tests, and a dependant's prose (`waiting-tickets.ts:120` contrasts `=== 'mine'` with "`isMine`'s looser" answer). Add one domain function that partitions instead. For example, `mineView(rows, reader) → { mine, theirs, unknownByCause }`, where `unknownByCause` separates *unresolved spelling* from *no owner carried*. The filter, the chip's counts, the «N unknown ▸» visibility and Discovery's `hiddenByOwner` then come from one partition and cannot drift apart. This follows "Every rendered state is a domain property". When all six sites have migrated, delete `isMine` rather than keep a dead permissive twin.
- **"A stricter filter for Delivery only" conflicts with the shared storage key.** Delivery, Planning and Discovery all read `plot-board:agents:mine-only`. A Delivery-only strict mode makes one stored `1` mean two different things depending on the tab. Choose one of two options: all three surfaces go strict together, or Delivery gets its own key. The second option also answers open question 4.
- **Agents (open question 2): fix them at the source, and do not exempt them.** `agentOwnership` ignores the reader. A manifest agent is `mine` even with `reader = {}` (`ownership.test.ts:103`, confirmed by the probe), because the board's machine is the reader's machine. A `synthesized` desk with a local state (`running`, `waiting` and so on) is on that same machine, so `unknown` for it (`ownership.test.ts:107`) is not consistent with that reasoning. Make synthesized-and-local `mine`. Keep `elsewhere` and `unknown` states `unknown`, count them under *no owner carried*, and keep them out of the `People` hint. An exemption would leave strict mode with a hole in it.
- **Reader with no comparable login (open question 3): the plan names the wrong predicate.** The chip disables on `comparableLogin(reader) === ''` (`chip-row.ts:163-165`), not on `readerIsKnown`. A reader with only `gitEmail`, or with an email-shaped `hostUser`, is "known" to `readerIsKnown` (`ownership.ts:301`), but every person-owned row still reads `unknown` (probe: `email reader pr` → `unknown`). A defect follows from this. The disabled chip reports `on: false` (`chip-row.ts:165`), but `AgentList` still passes the stored `mineOnly` to `rowsForReader` (`AgentList.tsx:726,1085`), `agentsForReader` (`:499`) and `ticketsForReader` (`:758`). Today this costs nothing, because every row is `unknown` and stays. Under strict mode, a Bitbucket reader with a stored `1` gets an empty board and a chip they cannot click. The rule must return an *effective on*, equal to `on && comparableLogin(reader) !== ''`, and every filter must read it.

## (c) Slices

- **Ship the multi-assignee fix first as its own bug plan.** It is a live defect with «Mine» off (finding a2), it has no design question, and the `tracker-account` arm has no multi-assignee test (`ownership.test.ts:247-300`, where only the `host-login` arm has one at :260). The fix loops the way `ticketOwnership`'s host arm does: `mine` on any self match, otherwise `theirs` on any declared other, otherwise `unknown`. `waitingTickets.accountMatches` should then call the fixed rule rather than keep a second copy.
- Slice 1, *Ownership rule*, becomes the partition function plus the synthesized-agent source fix and the effective-on property. The `accountTicketOwnership` fix leaves this slice.
- Slice 2 must name `boardForReader` and the Planning tab, or state why Planning keeps the released rule while sharing the key.
- Slice 3, *Unassigned section*, changes what *Waiting on you* holds, which the 2026-09-24 plan line 120 says the «Mine» filter must not do. It belongs to `waitingTickets` (server side), not to «Mine». Move it to its own plan, or justify its place in this one.

## (d) Open questions

1. Q1: do not redefine `isMine`, and do not add a Delivery-only mode. Add one partition function for all six sites, then remove `isMine` (see b).
2. Q2: make synthesized-and-local `mine` at the source. `elsewhere` stays `unknown` and is counted under *no owner carried*.
3. Q3: key the decision on `comparableLogin`, not `readerIsKnown`. Make the effective-on a domain property, and have the filters read it rather than the stored flag.
4. Q4: a new storage key follows naturally if the meaning changes. Otherwise the Delivery chip, the Planning checkbox and the Discovery checkbox inherit a stricter `1` together.
5. Q6: yes, as a bug plan before this one (see c).
6. New question: does «N unknown» split *unresolved spelling* (fixable in `People`) from *no owner carried* (builds, bare branches, unassigned, `source: null`, `elsewhere`)? Without the split, the configuration-signal motivation does not hold.
7. New question: does the chip's existing `N hidden` keep counting branch rows only, or does it start to count registry agents and tickets too?

## (e) Tests

- Bug plan, domain unit: `ownership.test.ts` gets `['mruepp','jan']`, `['jan','mruepp']` and `['stranger','jan']` with the `jira:` prefix, and all three must give `mine`. `waiting-tickets` test: the probe2 fixture must show #2 with `hidden: 1`.
- Slice 1, domain unit: partition counts per kind and per cause, the synthesized-local agent as `mine`, `elsewhere` as `unknown`, and effective-on `false` for an empty, email-shaped or `gitEmail`-only reader with stored `on`. Update the pins at `ownership.test.ts:200,269` and `chip-row.test.ts:141` deliberately, and amend plan 2026-09-24 line 123.
- Slice 2, board unit: `mine-filter.test.ts` checks that each of the four filters reads the partition and the effective-on. One browser test checks that «N unknown ▸» renders the domain count and that a click restores the rows.

## Amendments

1. Split the `accountTicketOwnership` multi-assignee fix into a bug plan that lands first. State that it already hides own tickets in «Mine» and drops them from *Waiting on you* (probe evidence in a1 and a2), and make `accountMatches` reuse the fixed rule.
2. Correct "five callers" to six. Name `boardForReader` and the Planning tab, and decide the shared `MINE_KEY` meaning across all three tabs.
3. Replace "redefine `isMine` or Delivery-only strict" with one domain partition function that all sites read. Remove `isMine` once nothing calls it.
4. Change open question 3 to `comparableLogin`, and add an effective-on domain property. A disabled chip must not leave a strict filter running.
5. Fix synthesized-and-local agents at the source. Count `elsewhere` separately.
6. Split the unknown count by cause, or drop the claim that it is a `People` signal.
7. Correct "agent rows" in *Signals that exist* to "branch rows (`AgentRow`)".
8. Move *Unassigned tickets* out of this plan, or reconcile it with plan 2026-09-24 line 120.
