# Juror verdict: callers

Position: amend

Evidence: Read the plan, issue #2819, `packages/domain/src/rules/ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts` (`ownerOf`), `lanes-for-reader.ts`, `chip-row.ts`, `packages/board/src/app/lib/agent-rows/mine-filter.ts`, `chip-readings.ts`, `AgentList.tsx:740-760`, `packages/board/src/server/fleet.ts:1858-1940,2098,2262`, `packages/domain/src/adapters/tracker/tracker-listers.ts`, `skills/plot/scripts/plot-host.sh:5350,5429`, PR #2814's diff of `waiting-tickets.ts`, plan `2026-10-28-empty-jira-inbox-read-as-a.md` (#2808, main), and plan `2026-10-28-mine-hides-rows-with-no-known.md` (#2811, branch `idea/mine-hides-rows-with-no-known`, PR #2812). Ran: a Node 24 probe (`juror-2819-callers/probe.mts`) importing the worktree's domain sources for `ownership`, `isMine`, `ownerOf`, `waitingTickets` and `lanesForReader` over multi-assignee Jira tickets; the same probe (`probe2.mts`) against PR #2814's `waiting-tickets.ts` (fetched from `origin/bug/an-absent-inbox-guesses-no-spelling`); and `vitest run test/ownership.test.ts test/waiting-tickets.test.ts test/lanes-for-reader.test.ts` in `packages/domain` (3 files, 112 tests, all pass on the worktree).

## (a) Problem statement

- Every cited line is right: `accountTicketOwnership` at `ownership.ts:153` returns at the first declared assignee (`:160-162`); the doc comment *"Every assignee is checked; any match is `mine`."* is at `ownership.ts:176`; the `host-login` arm's `sawTheirs` loop is at `:188-195`; `accountMatches` checks every assignee at `waiting-tickets.ts:83-93`; the `=== 'mine'` filter is at `:223`.
- The probe reproduces the defect. With `People` declaring `jira:jan@q.com → jwloka` and `jira:m@q.com → mruepp`, reader `jwloka`: `[m, jan]` → `theirs` (`isMine` false); `[jan, m]` → `mine`; `[undeclared, jan]` → `mine`; `[undeclared, m]` and `[m, undeclared]` → `theirs`.
- **Missing fact: the shipped Jira connector never produces two assignees.** `plot-host.sh:5429` projects `assignees: ([.fields.assignee.emailAddress // .fields.assignee.accountId] | map(select(. != null)))` — at most one entry, because Jira's `assignee` field is single-valued. Jira is the only `tracker-account` lister (`tracker-listers.ts:19-22`). So no live board row reaches the multi-assignee arm today; the defect is in the domain rule only, and every reproduction (the three #2811 jurors' and mine) used synthetic rows. The plan's "Effect on the board" and its Changelog line (*"A Jira ticket assigned to several people … shows as the reader's own"*) describe a board state no user can reach with the shipped connector.
- "No test covers a `tracker-account` ticket with several assignees" is slightly too broad: `waiting-tickets.test.ts:199-206` covers one through `accountMatches` and the inbox, and `ticket-lanes.test.ts:62,78` cover `ownerOf` with two assignees. What no test covers is `accountTicketOwnership` (that is, `ownership`) with several.

## (b) Approach

The fix targets the cause, one function, and leaves every caller's code unchanged. Per caller:

| Caller | Reads | Today, `[other, me]` | After the fix |
|---|---|---|---|
| `lanesForReader` (`lanes-for-reader.ts:67,76-77`), Discovery «Only my work» | `isMine(ownedTicket(...))` | hidden; probe: `open.rows = []`, `hiddenByOwner = true` | kept |
| `ticketsForReader` (`mine-filter.ts:202-207`), *Waiting on you* under «Mine» via `AgentList.tsx:757-759` | `isMine(ownedFromTicket(...))` | hidden | kept |
| `waitingTickets` matched arms (`waiting-tickets.ts:188,223`) | `ownership(...) === 'mine'` | dropped from `mine`, counted in `hidden` unless the inbox carries it | selected |
| `chipRow` Mine chip (`chip-row.ts:168`) | `isMine` over `chip-readings.ts:47` `ownedFromRow` rows | no change: `ownedFromRow` (`mine-filter.ts:96-100`) yields only `pr`/`plan`/`other`; tickets never reach the chip's count | no change |
| `ownerOf` (`ticket-lanes.ts:98-109`), card and *Waiting on you* `owner` label | first declared assignee, no reader | names `mruepp` | still names `mruepp` — see (d) |

- It follows "Every rendered state is a domain property": the change stays in `ownership.ts`, and no `.tsx` decides anything.
- The approach's three-way fold is exactly `planOwnership`'s shape (`ownership.ts:135-141`: any `mine` → `mine`, else any `theirs` → `theirs`, else `unknown`). The plan names the `host-login` arm as the model; `planOwnership` is the closer one, because the `host-login` arm reads every non-matching assignee as `theirs` while the tracker arm reads an undeclared one as no information. Naming it lets the implementer map each assignee to a per-assignee reading and fold, and keeps the two rules visibly alike.
- **Interaction with PR #2814 (#2808 slice *Inbox*, open).** PR #2814 makes the `tracker-account` arm return `[]` with a notice when `inbox === undefined` (its diff adds `if (inbox === undefined) return render([], …)` before `:196`). Probed against that file: `inbox: undefined` → `[]`, notice *"The inbox was not read …"*; `inbox: []` → `['A-2']` (the `[m, jan]` ticket A-1 is missing); `inbox: [A-1, A-2]` → `['A-1', 'A-2']`. So once #2814 merges, *Waiting on you* drops a multi-assignee ticket only when the inbox answered and does not hold it. The live inbox read is `assignee = currentUser()` (`plot-host.sh:5350`), so a ticket assigned to the reader is in the inbox and the union (`unionDedup`, `:224`) selects it whatever `ownership` says. The *Waiting on you* half of the Motivation therefore holds on current main only on the no-inbox path (`fleet.ts:2098`), and #2814 removes that path for `tracker-account`.
- **The plan's proposed `waiting-tickets.test.ts` assertion breaks after #2814 if it passes no inbox.** On current main, a test with `inbox: undefined` would pass after the fix, then fail once #2814 merges, because that arm then returns `[]` before `ownership` runs. Written with `inbox: []` (reader declared, so `candidates.length === 0` skips the notice branch and reaches `:223`), the assertion holds on both bases. It fails before the fix and passes after on both, as shown by the probe rows above.
- **Interaction with #2811.** #2811 is Draft, not Approved (`State: Draft`, `Rounds: 1`, PR #2812 open). It records *"#2819 … ships first"* in its Decisions and Notes. Two slices read this function's answer:
  - `feature/mine-strict-ownership-rule`: the strict mode keeps only `mine`. Today `[other, me]` is hidden in both modes; after the fix it is kept in both. The fix must merge first, or a strict-mode test pins the wrong answer.
  - `feature/waiting-hidden-split`: `hidden` splits into `unassigned` and `assignedToOthers`. A `[other, me]` row in `rows` but not in the inbox counts as `assignedToOthers` today and is shown after the fix. If the split merges first, its tests may fixture that row as `assignedToOthers`. This plan should say it precedes both.
- **No regression for the other readers of `ownership`.** `pr`, `agent`, `plan` and `story` arms are untouched, and the `host-login` ticket arm already folds every assignee. The three domain test files pass today. No existing test asserts the order-dependent answer, so nothing in them should flip.

## (c) Slices

- One slice, one branch, domain only: right. It touches no file in `packages/board`, so no board artifact rebuild is needed beyond `main`'s own.
- Order: before #2811's `feature/mine-strict-ownership-rule` and `feature/waiting-hidden-split`. Independent of #2814 apart from one shared test file (`packages/domain/test/waiting-tickets.test.ts`), where both add `it` blocks; a textual conflict there is a rebase, not a design conflict.
- Nothing needs to ship separately first. Nothing should leave the plan.
- **Optional, and out of scope here:** `accountMatches` (`waiting-tickets.ts:83-93`) re-implements the per-assignee match with `.handle ===` and a raw `hostUser.trim()` instead of `comparableLogin`. After this fix it answers the same as `ownership(...) === 'mine'` for every comparable login. Replacing it is a separate cleanup; PR #2814 edits the same function's surroundings now, so doing it here invites a conflict.

## (d) Open questions

- **The plan's question — should `[undeclared, declared-other]` stay `theirs`?** Yes, from the callers' view. It matches `planOwnership` (`ownership.ts:131-141`), which reads a declared other as `theirs` beside an undeclared field. Answering `unknown` would make the tracker arm the only multi-person rule where a declared other person counts for nothing. With Jira's single assignee (`plot-host.sh:5429`) the case has no live occurrence either way. Close the question as decided.
- **New: should the Motivation and Changelog say the shipped Jira connector reports one assignee?** I think so. The Changelog line promises a user-visible change that no shipped connector can show. Suggest: *"The ownership rule checks every assignee of a tracker-account ticket, so the answer no longer depends on assignee order."* Or record that a future connector, a multi-user custom field, or a `PLOT_JIRA_JQL` override is the path that would reach it.
- **New: should `ownerOf` prefer the reader?** After the fix, Discovery with «Mine» on keeps `[mruepp, jan]` as the reader's, while the card's `owner` label still reads `mruepp`: `ownerOf` takes the first declared assignee and takes no reader (`ticket-lanes.ts:98-109`; probe: `ownerOf [m, jan] → mruepp`). That is a display mismatch, not an ownership defect. The plan should name it as out of scope or as a follow-up. Changing it means passing a reader into `rowOf`/`toWaitingTicket`, which is a larger change.
- **New: what does `accountTicketOwnership` answer for a blank assignee?** `'  '` becomes the spelling `jira:`, which nothing declares, so it is skipped. Keep that, and test it as "no information" beside the undeclared case.

## (e) Tests

- Domain unit, `packages/domain/test/ownership.test.ts`: the four assertions in the plan, plus `[undeclared, jan]` → `mine` and `[undeclared, undeclared]` → `unknown`. Each goes through `ownership(ownedTicket(...))`, the export every caller uses. This alone proves the fix for all three readers.
- Domain unit, `packages/domain/test/waiting-tickets.test.ts`: the plan's assertion, written with `inbox: []` and a declared reader, so it holds on main before and after PR #2814. Assert `tickets` contains the `[other, me]` row and `hidden` does not count it.
- Domain unit, `packages/domain/test/lanes-for-reader.test.ts`: one assertion that a Discovery open lane keeps `[other, me]` with `on: true` and `hiddenByOwner` false. This pins the «Mine on hides it» half of the Motivation at the tier where it is decided. Today it fails (probe: `rows = []`, `hiddenByOwner = true`).
- No board unit or browser test is needed. `mine-filter.test.ts:8` states that board file asserts the wrapping, not `ticketOwnership`, and no `.tsx` decides ownership.

## Amendments

1. In Motivation, state that `plot-host.sh:5429` projects at most one Jira assignee, so the defect is in the domain rule and no shipped connector reaches it today. Reword the Changelog line to describe the rule, not a board state no reader can reach.
2. Name `planOwnership` (`ownership.ts:135-141`) as the model for the fold rather than the `host-login` loop, and close the open question as `theirs`, citing it.
3. Write the `waiting-tickets.test.ts` assertion with `inbox: []`, so it holds before and after PR #2814 merges. Add one `lanes-for-reader.test.ts` assertion for the «Mine on» half.
4. In Notes, say this slice merges before #2811's `feature/mine-strict-ownership-rule` and `feature/waiting-hidden-split`, and that it shares only a test file with PR #2814.
5. Name `ownerOf`'s first-declared label (`ticket-lanes.ts:98-109`) as out of scope or as a follow-up, so a reviewer does not read the unchanged label as a missed caller.
