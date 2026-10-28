# Juror verdict: compatibility

Position: amend

Evidence: Read the plan, issue #2811, `packages/domain/src/rules/ownership.ts`, `chip-row.ts`, `lanes-for-reader.ts`, `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `chip-readings.ts`, `AgentList.tsx` (415-430, 490-505, 715-770, 1075-1095), `App.tsx` (275-290, 1295-1350, 1470-1500), `DeliveryFilters.tsx`, `server-info.ts:195-260`, `fleet.ts:1905-1935`, `plot-host.sh` (`account` arm, 4000-4030), `docs/plans/2026-09-24-the-board-shows-me-only-my-work.md:118-123`, and the cited tests. Ran: (1) `plot-host.sh account` read-only in `/Users/jwloka/Quatico/ewz/ewz-kus-portal` with `PLOT_BUDGET_ACCOUNT` unset: exit 4, and that checkout has `git config user.email` set, `Tracker: jira`, and `People: jwloka = Jan Wloka` with no `jira:` spelling. (2) A vitest probe (scratch dir `juror2811-compatibility/`) that imports the domain's `ownership`, `isMine`, `readerIsKnown`, `comparableLogin`, `chipRow` and compares today's `isMine` with a strict `ownership === 'mine'` over 16 row shapes and 7 readers. Probe output is quoted below.

## Probe result (16 rows: PRs, plans, a story, GitHub and Jira tickets, agents, a bare branch)

| Reader | `readerIsKnown` | `comparableLogin` | Mine chip | rows kept today | rows kept strict |
|---|---|---|---|---|---|
| GitHub, People without `jira:` spellings | true | `jwloka` | enabled | 14 | 7 |
| GitHub, People with `jira:` spellings | true | `jwloka` | enabled | 14 | 8 |
| GitHub, no `People` key | true | `jwloka` | enabled | 15 | 5 |
| **Bitbucket, `account` exit 4, gitEmail set (ewz-kus-portal today)** | **true** | `''` | **disabled, `on:false`** | 16 | **1** |
| Bitbucket with `PLOT_BUDGET_ACCOUNT=jwloka` | true | `jwloka` | enabled | 15 | 7 |
| `hostUser` email-shaped | true | `''` | disabled | 16 | 1 |
| empty reader (first paint before `/api/board` identity, older server) | false | `''` | disabled | 16 | 1 |

The one row that survives in every no-login case is a manifest agent with a desk here, because `agentOwnership` does not read the reader at all (`ownership.ts:248-251`).

## (a) Problem statement

- Correct: `isMine` is `ownership !== 'theirs'` (`ownership.ts:288`); `rowsForReader`/`ticketsForReader` filter through it (`mine-filter.ts:159,207`); the released rule is at `2026-09-24-the-board-shows-me-only-my-work.md:123`; `chip-row.ts:168`, `lanes-for-reader.ts:67`, `ownership.ts:247-250` match.
- **The `isMine` caller count is wrong: there are six production callers, not five.** `mine-filter.ts:159` (`rowsForReader`), `:173` (`agentsForReader`), `:207` (`ticketsForReader`), `:222` (`boardForReader`, the Planning tab's cards via `App.tsx:1481,1494`), `chip-row.ts:168`, `lanes-for-reader.ts:67`. The `isMine` in `packages/fleet/src/shared/continue-lock.ts:184` and `implement-run.ts:357,377` is an unrelated lock helper. The plan's "Board impact" names Delivery and Discovery only; **the Planning tab is missing**, and it is the one surface with no hidden-count signal at all (no `hiddenByOwner`, no chip count — `BoardView`/`Swimlanes` receive the already-filtered board).
- **The Bitbucket failure case is misdescribed.** The plan frames it as "what «Mine» does when `readerIsKnown` is false". On the real Bitbucket estate `readerIsKnown` is **true**: `readerIsKnown` accepts a non-empty `gitEmail` (`ownership.ts:301-302`), and ewz-kus-portal has one. Every ownership arm reads only `comparableLogin` (`ownership.ts:104,120,154,184`), which is `''` there. So a guard on `readerIsKnown` never fires on the case it is meant for. Also `readerIsKnown` has no production caller: `mine-filter.ts:141` re-exports it and nothing in `packages/board/src` imports it (`git grep readerIsKnown`), contrary to the comment at `mine-filter.ts:137-140`.
- **The `accountTicketOwnership` defect is not "a visible-anyway quirk" today.** It answers `theirs`, and today's `isMine` already hides `theirs`. Probe: Jira ticket `[acc-mr, acc-jan]` with both spellings declared → `theirs`, hidden by today's filter. The reader's own co-assigned Jira ticket is hidden on `main` now. Minor: the contradiction is with `ticketOwnership`'s doc (`ownership.ts:176`), not `accountTicketOwnership`'s own doc (`:143-152`), which describes the current behaviour. No test covers multiple tracker-account assignees (`git grep` in `ownership.test.ts`).
- `DeliveryFilters.tsx:87-91`: the chip's count covers branch rows only (`chip-readings.ts:46-47`, `ownedFromRow`); hidden tickets and hidden registry agents are counted nowhere.

## (b) Approach

- **A stored `mine-only=1` with a disabled chip empties the Delivery tab silently.** The filter reads `mineOnly` straight from storage (`AgentList.tsx:422,499,726,758`; `App.tsx:280,1481`) and never consults whether the chip is disabled. `mineChip` answers `on: false` while `comparableLogin` is `''` (`chip-row.ts:163-165`). The plan renders «N unknown ▸» "only while «Mine» is on". On ewz-kus-portal: rows filtered strictly, chip shows "Mine" greyed and off, no count, no control. Today this is harmless only because unknown passes. This is exactly the failure line 121/123 of the released plan forbid.
- **Planning and Discovery have no disabled state.** The "Only my work" checkbox (`App.tsx:1305-1314`) is always enabled and shows no count. Discovery has `hiddenByOwner` per lane (`StoriesTab.tsx:335,404`); Planning has nothing.
- **First paint.** `AgentList.tsx:418-420` states the identity "arrives on a separate fetch, so an unknown reader hides nothing". Strict, the empty reader keeps 1 of 16 rows, so every load with a stored key flashes an empty board, then refills.
- **Jira without `jira:` spellings hides every ticket even with a login.** Probe rows `jira ticket [acc-jan]` are `unknown` for every reader whose People lacks `jira:` (ewz-kus-portal's `People` today). A strict filter removes all of *Waiting on you*'s tickets from the reader whose tracker is Jira, and the chip's count does not include tickets.
- **Agents.** `agentsForReader` feeds `brokenAgentRows` (`AgentList.tsx:499-505`). `NO_DESK_HERE` contains `unknown` (`ownership.ts:82`), so strict hides every broken agent with state `unknown` and every synthesized desk from *Waiting on you*. That changes what the section means, which the released plan forbids (`:119`). Agents must stay exempt or the source must be fixed first.
- **The `unknown` count is a mixed signal.** It mixes rows `People` can fix (free-text plan authors, Jira accounts) with rows nothing can fix (`other`: builds, bare branches; unassigned tickets; agents). "A high count means People lacks spellings" holds only for the first group. Count per reason, or exclude `other`.
- Layering: the gate for "does the filter apply" has to be a domain property (one function that takes reader + stored preference + row kind), or each of the three tabs will decide it in `.tsx` again, as they do today.

## (c) Slices

- The `[mruepp, me]` fix should ship first as its own bug plan: it is a live defect under today's rule, independent of the reversal, and needs no decision on open questions 1-5.
- Slice `feature/mine-keeps-only-mine-rule` must also define the domain predicate "strict filter applies" keyed on `comparableLogin`, and the stored-preference migration (below), so slice 2 renders decisions rather than makes them.
- Slice `feature/mine-unknown-control` must cover the Planning tab (`boardForReader`) explicitly, or the plan must state that Planning keeps the released rule.

## (d) Open questions

- **Q3 — «Mine» while the reader cannot be placed.** Use `comparableLogin(reader) === ''` (the predicate the chip already uses, `chip-row.ts:163`), not `readerIsKnown`. With no comparable login, no filter applies on any tab, whatever storage says, and every tab shows the chip's disabled reason (`chip-row.ts:140-148` already names `hostUser`; for Bitbucket it should name `PLOT_BUDGET_ACCOUNT`, the only fix that exists — `plot-host.sh:4019-4026`). This also fixes the first-paint flash.
- **Q4 — stored `mine-only=1`.** Read the old key as "Mine on, unknown added back", which reproduces today's view exactly (strict set + unknown = today's set). Store the «unknown ▸» expansion under a new key; a reader who never touches the new control sees no change. A key rename alone also works (`readMineOnly` treats a missing key as off, `mine-filter.ts:54-61`), but it turns the filter off for every current user, which the released comment at `mine-filter.ts:29-30` would accept and the reader would notice. A one-time notice adds UI for a state that the mapping makes unnecessary.
- Q2 (agents): exempt. Probe shows strict hides synthesized and `elsewhere` agents and broken `unknown` agents; the last is a *Waiting on you* contract break.
- Q6: yes, a separate bug plan first — see (a).
- New questions the plan should carry: (1) Does the «N unknown ▸» expansion persist, and under which key? (2) Does the Planning tab adopt the strict rule, and where does its count show? (3) Is the `unknown` count split by reason (People-fixable versus `other`/unassigned/agent)? (4) Do hidden tickets enter any count?

## (e) Tests

- Domain unit (`ownership.test.ts`): strict answer per row kind; multi-assignee Jira `[other, me]` → `mine` (fails on `main` today); the "filter applies" predicate is false for `{hostUser:'', gitEmail:'x'}` (Bitbucket shape) and for `{}` — the exact readers in the probe table.
- Domain unit (`chip-row.test.ts`): disabled chip ⇒ unknown control absent **and** no rows hidden; enabled chip ⇒ unknown count equals strict-minus-lenient row count.
- Board unit (`mine-filter.test.ts`): stored `'1'` under the old key with no new key reproduces today's kept set over a fixture mixing all 16 row shapes; `boardForReader` likewise.
- Board unit: `agentsForReader` keeps a `state: 'unknown'` agent under strict.
- Browser (one): Bitbucket-shaped server info with a stored `mine-only=1` shows every row and the disabled reason.
- Amend, do not delete, `ownership.test.ts:198-201` ("a later change that makes unknown hide fails here") and the `mine-filter.test.ts:74-100` cross-tab table: keep `isMine` lenient if the stricter filter is a sibling, so those pins stay true.

## Amendments

1. Replace "when `readerIsKnown` is false" with "when `comparableLogin` is empty"; state that ewz-kus-portal (Bitbucket, gitEmail set) is that case, and that the filter then applies nowhere regardless of storage.
2. Gate every filter call site on the chip's own enabled state through one domain predicate; today `AgentList.tsx:726` and `App.tsx:1481` filter while the chip is disabled.
3. Correct the caller count to six and add the Planning tab (`boardForReader`, `mine-filter.ts:222`) to Board impact and to slice 2, or exempt it explicitly.
4. Answer Q4 as "old key = Mine on with unknown shown"; add a new key for the expansion.
5. Exempt agent rows (Q2), citing broken `unknown` agents in *Waiting on you*.
6. Move the `accountTicketOwnership` fix to a bug plan that lands first; correct the "visible-anyway" claim — it hides the reader's ticket on `main` today.
7. Split the unknown count by reason, or exclude `other` rows, before calling it a `People` signal; state whether hidden tickets are counted.
8. Add a Jira-without-`jira:`-spellings case to the design: with ewz-kus-portal's `People`, strict hides every Jira ticket.
