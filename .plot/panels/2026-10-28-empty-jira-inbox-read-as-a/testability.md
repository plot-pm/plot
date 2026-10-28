# Juror verdict: testability
Position: amend
Evidence: Read the plan, issue #2808, `packages/domain/src/rules/waiting-tickets.ts`, `rules/ownership.ts`, `rules/chip-row.ts`, `rules/lanes-for-reader.ts`, `adapters/tracker/tracker-shell.ts` (walk), `adapters/tracker/tracker-jira.ts` (inbox gate), `packages/fleet/src/shared/issue-refresh.ts` (inboxOutcomeOf), `packages/board/src/server/fleet.ts` (refreshIssues, readIssuesFromStore, waitingOf), `server/server-info.ts`, `app/lib/agent-rows/mine-filter.ts`, `waiting-view.ts`, `plot-host.sh` (`account` and Bitbucket `author`), and the tests `domain/test/waiting-tickets.test.ts`, `ownership.test.ts`, `chip-row.test.ts`, `board/test/unit/mine-filter.test.ts`. Ran: `vitest run` on domain `waiting-tickets`, `ownership` and `lanes-for-reader` tests (3 files, 112 passed), and on board `--project parallel` `mine-filter`, `waiting-view` and `unplanned-issues` tests (3 files, 64 passed). Ran two scratch probes against `waitingTickets` and `ownership` (in `scratchpad/juror-testability/`). Read-only `ls`/`grep` of the local ewz-kus-portal checkout's `.git/.plot/state/`.

## (a) Problem statement

1. **The cause of finding 1 is in the wrong arm. A slice-1 test as the plan describes it passes today.** Probe output, with the reader `jwloka` declaring `jira:jan.wloka@quatico.com` and three project rows (first assignee `markus.ruepp@quatico.com`):
   - `inbox = []` → `{"shown":0,"hidden":3,"n":[],"notice":null}`. This is already the behaviour the Changelog asks for.
   - `inbox = undefined` → `shown 3` and exactly the banner from the issue: *"The tracker names your tickets' assignee `markus.ruepp@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:markus.ruepp@quatico.com` to match."*

   `waiting-tickets.ts:201` gives `candidates = inbox !== undefined ? inbox : rows`, so an empty array gives `candidates.length === 0`. The `!matched && candidates.length > 0` guard at `:203` then skips the notice, and `:223-225` returns the empty union. The observed banner needs `inbox === undefined`. The board produces that on its fleet-less path. `refreshIssues` (`fleet.ts:1966`) never calls `issueListInbox`, and `fleet.ts:2097` calls `waitingOf(opts, rows, plans, ticketSource, said.value.complete)` with no inbox argument, so the default `undefined` at `fleet.ts:1922` applies. Only the store path (`fleet.ts:2262`, `index.inbox`) carries an inbox. On the fleet path, `inboxOutcomeOf` (`issue-refresh.ts:249-256`) writes `[]` for an answered empty read. The local ewz-kus-portal checkout holds no `issues.json` under `.git/.plot/state/index/` (only `bitbucket.json`, dated Oct 2). That fits a board with no fleet, but this checkout is older than the observation, so it does not prove it. The plan's slice 1 says the `inbox === undefined` arm "keeps its current behaviour", and that is the arm that fires. The existing test `waiting-tickets.test.ts:175` (*"the same Jira reader with no inbox answers the open rows and the same notice"*) pins the defect as a contract.
2. **Finding 2 (duplicates) can be narrowed now.** `waitingTickets` deduplicates only on the matched paths (`unionDedup`, `:189`, `:224`). The notice path (`:213`), the no-spelling path (`:197`), the `null` source path (`:178`) and the host-login no-login path (`:185`) pass `rows` through unchanged. Probe: rows `[A, B, A, B]` with `inbox = undefined` → `n: ["A","A","B","B"]`, `shown 4`. With `inbox = []` → `hidden 4` over 2 distinct tickets. The newest-first sort puts each pair side by side, which matches "twelve rows twice in sequence" and "40 in Jira, more rendered". The upstream source is not proved, but one candidate is visible: `walk` (`tracker-shell.ts:277-299`) concatenates pages and deduplicates page *tokens* (`seen.has(token)`), never issue *numbers*. A Jira page boundary that shifts between two calls repeats rows. The observed view was the notice path, which is the one path that shows them.
3. **The cause in finding 4 is misnamed.** `prOwnership` (`ownership.ts:103-109`) answers `unknown` only when the login or the author is empty. For any two non-empty values it answers `mine` or `theirs`. People spellings cannot move a PR row to `unknown`. Probe: with `hostUser: 'jwloka'`, a PR authored by `"Christian Kehl"` → `theirs`. The chip label is `Mine (${comparableLogin(reader)})` (`chip-row.ts:167`), so «Mine (Jan Wloka)» means the board's `hostUser` was the string `Jan Wloka`. On Bitbucket, `plot-host.sh account` exits 4 (`plot-host.sh:4008-4026`), so that value came from `PLOT_BUDGET_ACCOUNT`. With a non-empty login, the three Draft-plan rows can only be `unknown` if they are not `pr` rows. They would be `plan` or `other` rows through `ownedFromRow` (`mine-filter.ts:96-101`), where `personFieldOwnership` answers `unknown` for an undeclared free-text field (`ownership.ts:119-126`). The question to measure is *"which `OwnedRow` kind does a Draft plan row with an open plan PR become?"*. The plan instead asks *"which People spelling does Bitbucket need?"*.

## (b) Approach

- **Slice 1 as written does not fix the observed case.** Two fixes would close it, and both are testable at low tiers:
  - (i) In the domain, on a `tracker-account` source that declares a spelling, never take `raw` from project-wide `rows`. With `inbox === undefined`, answer no notice, or a notice that says the inbox was not read. This changes the test at `waiting-tickets.test.ts:175`, which is a contract change the plan must state.
  - (ii) In the board, have the fleet-less `refreshIssues` run `issueListInbox` (as `issue-refresh.ts:498-503` does) and pass the result to `waitingOf`.

  Option (i) alone still shows 40 project rows as *Waiting on you* with no inbox. Option (ii) alone leaves the domain arm free to give the same wrong advice whenever the inbox read is skipped or unaskable. The plan should do both, or name which one it does and why.
- **Slice 3 changes a contract that five tests pin**, and the plan does not name them: `chip-row.test.ts:141` (*keeps a row whose owner cannot be determined*), `mine-filter.test.ts:45` (*unknown stays visible*), the Discovery/Delivery agreement table at `mine-filter.test.ts:74-100` (`no assignee → true`, `null source → true`), and `ownership.test.ts:199-206` (*isMine keeps what it cannot classify*). Discovery's `lanesForReader` filters with the same `isMine` (`lanes-for-reader.ts:67`). There are two routes:
  - Redefine `isMine`. This changes Discovery too and breaks the ownership tests.
  - Add a stricter predicate for Delivery only. This breaks the agreement table on purpose.

  The plan must choose one and list the tests that change. The earlier plan `2026-09-24-the-board-shows-me-only-my-work` set the unknown-stays rule, and the plan's Notes do not list it.
- **The `N others · M unknown` count already has a domain home.** `chipRow().mine.hiddenCount` (`chip-row.ts:162-170`) counts `!isMine`, which is only `theirs`. Splitting it into `theirs` and `unknown` counts there satisfies *Every rendered state is a domain property*, with a domain unit test and no browser.
- **The Bitbucket-empty-login risk is already gated.** `mineChip` disables the chip when `comparableLogin` is `''` (`chip-row.ts:164-166`). Hiding `unknown` therefore cannot empty a Bitbucket board whose reader has no login. A test should pin that the chip stays disabled.

## (c) Slices

- **Slice 1:** the done-condition is checkable, but as worded it is met today. It needs the `undefined`-arm change and/or the fleet-less inbox read. Without either, it ships a test that passes before and after.
- **Slice 2:** "find the path" is not a checkable done-condition. Use instead: *no `WaitingTicket.number` appears twice in `tickets`, and `shown + hidden` counts distinct numbers, for duplicate `rows` on every arm. `walk` returns no duplicate issue number across pages.* Slice 2 merges independently of slice 1. If slice 1 merges first, the observed symptom hides, because the deduplicating union path then runs. The adapter's duplicates still corrupt `hidden` and the index, so slice 2 still has work. Order: 1, 2, 3 is fine, and 2 does not depend on 1.
- **Slice 3 bundles four deliverables:** the filter semantics, the three-state control, the *Unassigned* section, and the People docs plus the question-4 investigation. Each has its own done-condition and test tier. Split off at least the *Unassigned* section, which is a server/section change, and the question-4 measurement, which is a docs/ownership fix. The `feature/` prefix on a `Type: bug` plan is consistent with slice 3 being a contract change rather than a fix. It argues for moving slice 3 to its own plan, or for retyping it.
- **Changelog lines vs slices:**
  - Line 1 (*no tickets and no notice when the inbox is empty*): today this is true only on the fleet path. The fleet-less board never knows the inbox is empty.
  - Line 2 matches slice 1.
  - Line 3 names "count beside the toggle" and *Unassigned*. Nothing covers slice 2 (duplicates), and no line names the question-4 docs.

## (d) Open questions

- **Q1 (duplicate source):** partly answered above. The visible path is the non-union arms of `waitingTickets`. The likely producer is `walk` in `tracker-shell.ts`, which never deduplicates issue numbers. A stubbed-page adapter test settles it.
- **Q2 (Bitbucket author):** `author` is `.author.nickname` (`plot-host.sh:4835-4840`, 4971), measured as equal to the display name on Quatico. The question as posed does not decide the observed rows, because a non-empty author never reads `unknown` (see (a)3).
- **Q4 (which toggle):** answered. The `Only my work` checkbox was replaced by the `Mine (<identity>)` chip in #2080 (`AgentList.tsx:996-1003`). The control in the proposal is that chip, and its state comes from `chipRow()`.
- **New:** Does the fleet-less board read the Jira inbox at all? Today it does not (`fleet.ts:2097`).
- **New:** Which `OwnedRow` kind does a Draft plan row with an open plan PR become?
- **New:** Does slice 3 change Discovery's «Mine» too?

## (e) Tests

| Slice / line | Test that fails today, passes after | Tier |
|---|---|---|
| 1 | `waitingTickets(rows with others' assignees, undefined, jwloka+jira spelling, JIRA)` → `notice` names no other person's spelling (today: names `markus.ruepp`). Changes `waiting-tickets.test.ts:175`. | domain unit |
| 1 | `refreshIssues` with a fixture tracker (`tracker-fixture.ts` `inbox: []`), `Tracker: jira`, `Ticket prefixes` set → `entry.waiting.notice === null`, `tickets` empty (today: notice from project rows) | board unit |
| 1 | inbox non-empty, no match → `raw` taken from an inbox row (passes today; keep it as a guard) | domain unit |
| 2 | `waitingTickets([A,B,A,B], undefined, …)` on each of the arms at `:178`, `:185`, `:197`, `:213` → no repeated `number`; `inbox=[]` → `hidden 2`, not 4 | domain unit |
| 2 | `walk` over stubbed pages `[A,B]`, `[B,C]` → `[A,B,C]` | domain adapter unit |
| 3 | `chipRow` with rows mine/theirs/unknown and `on: true` → separate `theirs` and `unknown` counts; changes `chip-row.test.ts:141` | domain unit |
| 3 | `rowsForReader` / `ticketsForReader` on → unknown hidden unless the unknown control is on; changes `mine-filter.test.ts:45`, `:74-100` | board unit |
| 3 | an empty-assignee ticket lands in *Unassigned*, not *Waiting on you* (a section property in the domain) | domain unit, plus one browser test that the collapsed section renders |
| 3 | chip stays disabled for `hostUser: ''` (Bitbucket) → nothing hidden | domain unit (exists in spirit at `chip-row.test.ts:97`; extend it) |

## Amendments

1. Restate slice 1's cause. The observed banner comes from the `inbox === undefined` arm, which the fleet-less `refreshIssues` always reaches (`fleet.ts:2097`). Either read the inbox there or stop deriving `raw` from project rows in that arm, or both. State that `waiting-tickets.test.ts:175` changes.
2. Give slice 2 a checkable done-condition (no repeated number on any arm; `walk` deduplicates by number), and name `tracker-shell.ts:277-299` and the non-union arms as the first suspects.
3. Rewrite question 4. A non-empty PR author never reads `unknown` (`ownership.ts:103-109`). Measure which `OwnedRow` kind the three Draft-plan rows had. Record that «Mine (Jan Wloka)» implies `hostUser = "Jan Wloka"`.
4. In slice 3, choose between redefining `isMine` and adding a Delivery-only predicate. List the tests that must change (`chip-row.test.ts:141`, `mine-filter.test.ts:45` and `:74-100`, `ownership.test.ts:199-206`). Put the two counts in `chipRow().mine`. Add `2026-09-24-the-board-shows-me-only-my-work` to the Notes.
5. Close open question 4 (toggle): it is the `Mine (<identity>)` chip from #2080.
6. Split slice 3: the filter plus count; *Unassigned* as its own slice; the question-4 measurement plus People docs as its own slice. Consider moving the `feature/` slice to its own plan. Add a Changelog line for the duplicate fix.
