# Juror verdict: domain-rules

Position: amend

Evidence: Read `packages/domain/src/rules/waiting-tickets.ts`, `rules/ownership.ts`, `entities/person.ts`, `rules/plan-card.ts`, `rules/chip-row.ts`, `rules/lanes-for-reader.ts`, `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `packages/board/src/server/fleet.ts` (`waitingOf`, `refreshIssues`, `readIssuesFromStore`, the dispatch at :2572-2573), `packages/fleet/src/shared/issue-refresh.ts` (`inboxOutcomeOf`, `inboxSkipped`), `adapters/tracker/tracker-jira.ts` and `tracker-shell.ts` (`walk`), `plot-host.sh` (Bitbucket `author`, `account`), `packages/domain/test/waiting-tickets.test.ts`, and issue #2808. Ran: two esbuild-bundled node probes against the worktree's TypeScript source (scratch dir `juror-domain-rules/`): `probe.ts` exercises `waitingTickets` and `ownership` with the ewz-kus-portal shape (40 open project rows, none assigned to the reader, 16 unassigned, first row EWZKUS-3902 assigned to mruepp, `People` declaring `jira:` spellings for jwloka, mruepp and ckehl), under `hostUser` `jwloka` and `Jan Wloka`; `probe-variant.ts` runs the same cases against a one-line variant of line 201; `dup.ts` feeds an open read with 12 overlapping rows. No vitest run, no network call.

## (a) Problem statement

**The cited cause is right only for `inbox === undefined`, and that is the arm the plan leaves unchanged.** Measured on current main:

| case | tickets | notice |
|---|---|---|
| A: `inbox = undefined` | 40 | *"…assignee `markus.ruepp@quatico.com`; … add `jira:markus.ruepp@quatico.com`"* (the exact banner from the issue) |
| B: `inbox = []` (an answered, empty inbox) | 0, hidden 40 | `null` |

`waiting-tickets.ts:201` already takes `inbox` as the candidate set whenever it is defined, `[]` included, and `:203` skips the notice when `candidates.length === 0`. So an answered empty inbox already reads as zero today. The banner the issue reports can only come from `inbox === undefined`.

**Two paths deliver `undefined` while the open rows are project-wide:**

1. The board's live path, `refreshIssues`, never runs an inbox read. `fleet.ts:2098` calls `waitingOf(opts, rows, plans, ticketSource, said.value.complete)` with no `inbox` argument. Only `readIssuesFromStore` (`fleet.ts:2262`) passes `index.inbox`. `fleet.ts:2572-2573` picks the store path only while fleetd owns PRs. A board with no running fleet therefore always shows the banner on a Jira repository with `Ticket prefixes`. This is the most likely path for the observation. The plan names neither `refreshIssues` nor the board/fleet split.
2. In the fleet path, a failed inbox read with no kept rows leaves `inbox: undefined` (`issue-refresh.ts:259-262`, `kept` undefined on the first pass or after a source change, `:412`).

`undefined` also legitimately means *"the open read is already person-scoped"*. `tracker-jira.ts:173-181` answers `unaskable` with no `Ticket prefixes`, and `inboxSkipped()` drops the inbox (`issue-refresh.ts:258`). `waitingTickets` receives the same `undefined` for both meanings, so it cannot tell a person-scoped read from a project-wide read whose inbox nobody asked for. **The missing cause is that missing input.** It is not the empty array.

**The issue's question 4 rests on a premise the rule contradicts.** `prOwnership` (`ownership.ts:103-109`) answers `unknown` only when the author or the login is empty. Any non-empty author that does not resolve to the reader is `theirs`. Probe: `pr author "Christian Kehl"` gives `theirs`, and so does an undeclared `"some-nick"`. Under `hostUser: 'Jan Wloka'`, which the chip label «Mine (Jan Wloka)» implies (`chip-row.ts:166` labels with `comparableLogin`), the result is the same. A row carrying a PR authored «Christian Kehl» therefore cannot be `unknown`. The three Draft plans showed under «Mine» for one of two reasons:

- they are plan cards or plan rows, read through `ownedFromCard`/`ownedFromRow` from `Assignee:` and `Approved:` only (`plan-card.ts:49-52`: *"The plan file records no author"*). A Draft plan with no `Assignee:` is `unknown` (probe: `plan card no fields → unknown`).
- their row's `pr.author` arrived `''`.

Neither case involves resolving «Christian Kehl». `plot-host.sh:4835-4839` already states that the Bitbucket author is `nickname`, which equals the display name on a Quatico workspace. So `People`'s plain `Christian Kehl` spelling matches it today.

**Duplicates (problem 2) have a domain-side mechanism the plan does not name.** The fallback branch renders `[...candidates]` unchanged (`waiting-tickets.ts:213`). Only the matched branch goes through `unionDedup` (`:99`, `:224`). `walk` (`tracker-shell.ts:277-299`) dedups page tokens and not issue numbers. In `dup.ts`, 52 rows with 12 overlapping produce 50 rendered tickets with 12 duplicates, each adjacent to its twin, and `shown: 52`. That matches *"twelve rows … twice in sequence"* and *"more rows rendered"*. The issue shows the reader in this fallback branch. With `inbox = []` the same rows render 0 and no duplicate. I did not prove that the live open read overlapped. That needs a read-only `issue-list --state open --paged` against the instance, which belongs to the connectors lens.

## (b) Approach

**Slice 1 as written changes nothing.** Every case it lists (answered empty gives 0 and no notice, notice only from a non-empty inbox, `raw` taken from an inbox row) is what lines 201-220 already do. The case it keeps (`inbox === undefined`) is the one that produced the bug. A unit test for *"empty inbox reads as zero"* passes on main today. The slice would merge green and the banner would remain.

What fixes the cause: `waitingTickets` needs to know whether `rows` is person-scoped. Two ways, both domain-owned:
- pass the inbox read's outcome rather than its rows alone (`answered | unaskable | failed | not-read`), or
- pass a `rowsScope: 'reader' | 'project'` derived from the same `Ticket prefixes` fact that gates `issueListInbox`.

When the rows are project-wide and no inbox answered, the rows must not feed `candidates` (`:201`) and must not feed the spelling notice. `probe-variant.ts` makes that one change (`candidates = []` for a project-scoped read with no inbox). Case A then gives 0 tickets and no notice, and cases B, E, F and G are unchanged. The board side must also do one of two things: give `refreshIssues` an inbox read, or pass the scope so that the no-fleet board stops falling back. The plan's board-impact note does not list `fleet.ts`.

**Other arms with the same defect:**
- **No `jira:` spelling declared** (`:196-198`): with `inbox` undefined, this arm returns every project row with no notice. That is the same "40 project-wide tickets under *Waiting on you*" symptom for a repository that has not declared spellings yet.
- **No host login on a tracker-account source.** Bitbucket gives no host login without `PLOT_BUDGET_ACCOUNT`, per `plot-host.sh:4008-4024`. Probe D: the notice renders with an empty handle: *"…declares no `jira:` spelling for  — add…"*. `accountMatches` (`:84-85`) returns false for every row, so any non-empty inbox triggers this notice. The plan names the "host-login arm" but means `source.match === 'host-login'` (`:182-191`). The no-login case on a tracker-account source is a separate gap.
- **Failed vs answered-empty inbox.** In the fleet path a failed read keeps the previous rows (`issue-refresh.ts:260`), so the reader sees stale rows silently. With nothing kept, the read degrades to the buggy `undefined` arm. The domain receives no failure signal, so it cannot say *"your inbox could not be read"*.

**Slice 3 and the three-way answer.** `isMine` (`ownership.ts:288`) has five callers: `rowsForReader`, `agentsForReader`, `ticketsForReader` and the card filter (`mine-filter.ts:159,173,207,222`), plus `lanes-for-reader.ts:67` (the Discovery tab) and `chip-row.ts:168` (the `Mine` chip's `hiddenCount`). Changing `isMine` to *mine only* changes all five. The plan names two. Per-kind consequences:
- **Agents:** `agentOwnership` (`:248-251`) never answers `theirs`. Under mine-only every synthesized agent and every agent elsewhere disappears. They would then all count as `unknown`, which the plan does not state.
- **PR rows:** these are never `unknown` with a non-empty author, so the `unknown` count for them only measures empty authors. The rule is asymmetric. An undeclared plan-field spelling reads `unknown` (`personFieldOwnership`, `:125`), while an undeclared PR author reads `theirs`. The count therefore does not signal *"People is missing a spelling"* for PR rows as the issue hopes.
- **Tickets: a defect slice 3 inherits.** `accountTicketOwnership` (`:158-163`) returns `theirs` at the first declared assignee who is someone else. It does not check the rest. Probe: `[mruepp, me]` gives `theirs`, while `[milz, me]` gives `mine`. This contradicts `:176` (*"Every assignee is checked; any match is mine"*). Jira has one assignee, so this rarely shows today. A filter that hides everything except `mine` makes it more visible.
- **The existing count:** `chip-row.ts:168` already counts `!isMine` rows as the `Mine` chip's `hiddenCount`. The `N others · M unknown` control belongs on that `Chip` (a second count beside `hiddenCount`), not in a new property.
- **The 16 unassigned tickets:** they mostly come from the slice 1 fallback (case A renders all 40 rows), and `ticketsForReader` then keeps the `unknown` ones. Once slice 1 is fixed, `waitingTickets` no longer selects unassigned rows (they go to `hidden`). An *Unassigned* section then has no rows unless `waitingTickets` returns them as a new field (for example `unassigned: WaitingTicket[]`). The plan must name that domain output. Otherwise the section is computed in `.tsx`, which breaks *Every rendered state is a domain property*.
- **Earlier contract:** slice 3 reverses a stated contract. `2026-09-24-the-board-shows-me-only-my-work.md:123`: *"It does not guess. A row whose owner cannot be determined is shown, never hidden."* `ownership.test.ts:200` and `:269` assert it (*"answers true for unknown, the permissive default"*). The plan should name both.

## (c) Slices

- Slice 1 needs a new scope: the domain input (scope or inbox outcome) plus `fleet.ts:2098`. Keep it first.
- Slice 2 should start from the mechanism above: the fallback branch does not dedup, and `walk` does not dedup by number. If slice 1 removes the fallback for project-scoped reads, the visible symptom goes with it. Dedup by `number` in `render` (or in `walk`) is still worth keeping, because the person-scoped fallback (`:197`, `:213`) can still render an overlapping read. Slice 2 can merge independently of slice 1.
- Slice 3 is a contract change to a released rule with five callers, on a `feature/` branch inside a `Type: bug` plan. I recommend moving it to its own feature plan, which names the reversal of the 2026-09-24 contract and every `isMine` caller. Question 4 then becomes a docs item. The rule already matches the Bitbucket nickname, and the open question is why plan rows carry no owner.

## (d) Open questions

1. *Where does the duplicate come from?* The most likely source is an overlapping open read rendered by the non-deduped fallback branch (`:213`). `dup.ts` reproduces it: duplicates adjacent, `shown > open count`. Confirm with one read-only paged `issue-list --state open` against EWZKUS.
2. *Which spelling does `resolvePerson` match for a Bitbucket author?* The nickname (`plot-host.sh:4835`), case-insensitive (`person.ts:30`). `ckehl = Christian Kehl` already resolves (probe: `theirs`). The question that remains is why the Draft rows are `unknown`: most likely no `Assignee:` (`plan-card.ts:49-52`), or an empty `pr.author`.
3. *Unassigned with «Mine» off?* From the domain side, yes. An unassigned ticket is `unknown` under every reader, and `waitingTickets` already excludes it from the matched selection (doc at `:120-121`), so the section is independent of the toggle. It needs its own `waitingTickets` field either way.
4. *Which toggle?* The control is the `Mine (<login>)` chip from `chip-row.ts:163-170`. `AgentList.tsx:749-755` still calls it *Only my work* in a comment. The chip's `hiddenCount` is where the new count goes.

New questions for the plan to carry:
- How does `waitingTickets` learn that `rows` is project-wide, and who supplies that on the no-fleet path?
- What does *Waiting on you* say when the inbox read failed, or was never made, on a project-wide read? Today the answer is a misleading spelling notice.
- Does mine-only apply to agents, which can never be `theirs`?
- Should `accountTicketOwnership` check every assignee before it answers `theirs`?

## (e) Tests

- **Slice 1, domain unit** (`packages/domain/test/waiting-tickets.test.ts`): *"a project-scoped Jira read with no inbox answers no rows and no notice"* (case A). It must fail on main. The test at `:175` (*"the same Jira reader with no inbox answers the open rows and the same notice"*) encodes the bug for the project-wide case. Restate it explicitly as person-scoped. Add the no-login tracker-account case (no empty handle in a notice) and the no-declared-spelling case at `:196`.
- **Slice 1, board unit:** `refreshIssues` passes the scope or inbox to `waitingOf`, asserted on `entry.waiting.notice === null` for an EWZKUS-shaped stub with an empty inbox and no fleet.
- **Slice 2, domain unit:** an open read with duplicate `number`s renders each ticket once, and `shown` counts each once, in both the fallback and the matched branch.
- **Slice 3, domain unit:** in `ownership.test.ts`, replace `:200` and `:269` with the new contract, and add `[theirs, mine] → mine` for tracker-account. In `chip-row.test.ts`, the `Mine` chip carries `othersCount` and `unknownCount`. In `waiting-tickets.test.ts`, the unassigned rows come back as their own field. One browser test only proves that the control renders the counts.

## Amendments

1. Restate slice 1's cause: `inbox === undefined` on a project-scoped read. The main producer is `refreshIssues` (`fleet.ts:2098`) passing no inbox, and the secondary producer is a failed first inbox read in the fleet. Drop the claim that an answered empty inbox is the bug. It already reads as zero (probe case B).
2. Give `waitingTickets` the missing input (rows scope or inbox outcome). Make the project-scoped/no-inbox arm return no candidates and no notice. Fix the board's no-fleet path. Add `packages/board/src/server/fleet.ts` to the board-impact note.
3. Cover the `:196-198` arm (no `jira:` spelling, project-wide rows) and the no-login tracker-account notice (empty handle).
4. Point slice 2 at the non-deduped fallback (`:213`) and at `walk` not deduping by number. Make the regression test domain-tier.
5. Move slice 3 to a separate feature plan. Name the reversal of `2026-09-24-the-board-shows-me-only-my-work.md:123`, all five `isMine` callers including agents and Discovery lanes, a new `waitingTickets` field for *Unassigned*, the count on the existing `Mine` `Chip`, and the `accountTicketOwnership` first-match defect.
6. Rewrite question 4. `resolvePerson` already matches «Christian Kehl», and a PR row with that author is `theirs`. Ask why the Draft rows carry no owner: no `Assignee:`, or an empty `pr.author`.
