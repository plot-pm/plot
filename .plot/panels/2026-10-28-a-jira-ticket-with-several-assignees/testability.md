# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2819, issue #2811, `packages/domain/src/rules/ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts:98-109`, `entities/person.ts:43-59,115`, `adapters/tracker/tracker-listers.ts:20`, `skills/plot/scripts/plot-host.sh:5334,5350,5429`, `packages/board/src/app/lib/agent-rows/mine-filter.ts:184`, and the tests `ownership.test.ts:247-300`, `waiting-tickets.test.ts:1-60,191-230`, `lanes-for-reader.test.ts:108-139`, `ticket-lanes.test.ts:47-81`. Ran (1) `vitest run` on `ownership`, `waiting-tickets`, `lanes-for-reader`, `ticket-lanes` in the worktree: 4 files, 140 tests pass on main; (2) a probe that calls `ownership` and `waitingTickets` from main and from a scratch copy of `src/` with the planned fix applied (the `host-login` arm's `sawTheirs` shape); (3) the five ticket-ownership test files (`ownership`, `waiting-tickets`, `lanes-for-reader`, `ticket-lanes`, `waiting`) against the fixed copy: 5 files, 151 tests pass. Scratch: `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-2819-testability/`.

## (a) Problem statement

- `ownership.ts:153` is `accountTicketOwnership`, and lines 158-163 return at the first declared assignee. Correct. `ownership.ts:176` reads *"Every assignee is checked; any match is `mine`."* Correct. `waiting-tickets.ts:223` filters on `=== 'mine'` and `:83-93` (`accountMatches`) checks every assignee. Correct.
- Probe output on main, reader `jwloka`, directory `jira:jan@q.com=jwloka, jira:m@q.com=mruepp, jira:o@q.com=other`:

  | assignees | main | fixed |
  |---|---|---|
  | `[mruepp, jan]` | theirs | mine |
  | `[jan, mruepp]` | mine | mine |
  | `[mruepp, other]` | theirs | theirs |
  | `[undeclared, mruepp]` | theirs | theirs |
  | `[mruepp, undeclared]` | theirs | theirs |
  | `[undeclared, jan]` | mine | mine |
  | `[undeclared]` | unknown | unknown |

  Only `[mruepp, jan]` changes. The defect is real in the domain function.
- **The claim "No test covers a `tracker-account` ticket with several assignees" is false as written.** `waiting-tickets.test.ts:200-207` and `lanes-for-reader.test.ts:134-139` both use a `tracker-account` ticket with two assignees. Both put an *undeclared* assignee first, so the early return never fires. The accurate claim: no test puts a *declared other person* before the reader.
- **The production reach is not stated, and it is narrower than the Changelog says.** The only `tracker-account` lister is Jira (`tracker-listers.ts:20`). The Jira read builds `assignees` from the single `assignee` field: `[.fields.assignee.emailAddress // .fields.assignee.accountId] | map(select(. != null))` (`plot-host.sh:5429`). That array holds at most one entry, so no Jira ticket can reach the board with two assignees today. The Changelog line *"A Jira ticket assigned to several people … shows as the reader's own"* describes a state the adapter cannot produce. The fix is still right — the rule contradicts its own contract, and a second `tracker-account` source or a multi-user field would expose it — but the plan should say the defect is latent.
- Also missing from the Effect list: Discovery. `lanes-for-reader.ts` keeps a ticket through `isMine(ownedTicket(...))` (the parity block at `lanes-for-reader.test.ts:108-117` says so), so «Mine» in Discovery hides the same ticket. Same cause, same fix; only the description is incomplete.
- Minor: "Panel round 1 on #2811" — #2811 is an issue; the panel ran on its plan PR #2812 (`idea/mine-hides-rows-with-no-known`).

## (b) Approach

- The fix removes the cause (the early `return 'theirs'`), not a symptom. Applying it to a copy and running the five ownership-related test files gave 151 of 151 green, so **no existing test pins the order-dependent behaviour**. I checked by grep that no board test uses a `tracker-account` source with a `jira:` directory except `a-plot-issue-write-reaches-the-index.test.ts`, which tests the index write and not ownership.
- Waiting on you: with the fix, `waitingTickets` over `[mruepp, jan]` + `[mruepp]` moves from shown 0 / hidden 2 to shown 1 / hidden 1 when `inbox` is `undefined` or `[]`. With an `inbox` that holds the ticket, main already answers shown 1 / hidden 1, because `unionDedup` (`waiting-tickets.ts:99-108,224`) adds every inbox row whatever its ownership. Since the Jira inbox read is `assignee = currentUser()` (`plot-host.sh:5350`), the live Waiting-on-you effect only appears for a ticket outside the reader's inbox read.
- `accountMatches` (`waiting-tickets.ts:83-93`) is a second implementation of "any assignee is the reader" next to `accountTicketOwnership`. After the fix they agree; the plan could note it, but merging them is out of scope.
- `waiting-tickets.ts:71` defines a local `ownedTicket` that shadows the exported one at `ownership.ts:210`. Unrelated to this defect; out of scope.
- Layering and "every rendered state is a domain property": the change lives in `packages/domain/src/rules/`, and the board reads it through `ownedTicket` (`mine-filter.ts:184`). Nothing in a component decides. No index read is involved.
- Doc comment: `ownership.ts:148` already says "any assignee" for `mine`. Only the `theirs` sentence (`:149`) needs "every declared assignee resolves to someone else".

## (c) Slices

One branch, one slice, correctly cut. Nothing should ship first. No board, script or plan-format change.

## (d) Open questions

- *Should `[undeclared, declared-other]` stay `theirs`?* Evidence: main and the fixed copy both answer `theirs` (probe rows 4 and 5), and the `host-login` arm answers `theirs` for any non-reader assignee with no declaration needed (`ownership.ts:188-195`). Keeping `theirs` changes nothing beyond the issue. **Answer: keep it**, and pin it as the plan proposes. If #2811 later hides `unknown`, the alternative would hide the same rows anyway.
- New question: `ownerOf` (`ticket-lanes.ts:98-109`) labels a row with the *first declared* assignee. A `[mruepp, jan]` ticket therefore shows owner `mruepp` while «Mine» keeps it as the reader's. Is that label acceptable, or should `ownerOf` prefer the reader? This plan can leave it, but it should name it.
- New question: does any planned tracker (or a Jira multi-user custom field) produce several `tracker-account` assignees? If none does, the Changelog belongs under a latent-defect wording.

## (e) Tests — what makes the slice done

Domain unit tier, all in `packages/domain`. Red/green status is from the probe against main:

1. `ownership.test.ts`, describe *"a ticket is owned by its assignees, resolved by source"* (`:247`):
   - `[mruepp, jan]`, both declared → `mine`. **Red on main, green with the fix — the only assertion that proves the fix.**
   - `[jan, mruepp]` → `mine`. Green on main; pins order-independence.
   - `[mruepp, other]` → `theirs`. Green on main; pins that the loop still reaches `theirs`.
   - `[undeclared, mruepp]` → `theirs`. Green on main; pins the open-question answer. Add `[mruepp, undeclared]` → `theirs` as well; it guards against a fix that lets a trailing undeclared assignee demote `theirs` to `unknown`.
   - `[undeclared, undeclared]` → `unknown` is already covered in spirit; one line keeps the third branch pinned.
2. `waiting-tickets.test.ts`: the reader second, `inbox` **`undefined`** (or a non-empty inbox without that ticket), rows `[mruepp, jan]` and `[mruepp]`, `JIRA` source → `shown` 1, `hidden` 1, ticket number listed. **The plan must state the inbox condition**: with an inbox that holds the ticket the assertion passes on main and proves nothing.
3. `lanes-for-reader.test.ts:134`: add the `tracker-account` twin of the host-login case at `:124` — `['mruepp-account', 'jan-account']` with both declared, `keeps === deliveryKeeps === true`. Red on main. This pins Discovery, which the plan's Effect list omits.
4. No board-unit or browser test is needed: `mine-filter.ts:184` passes through to `ownedTicket`, and `packages/board/test/unit/mine-filter.test.ts` already proves the pass-through.

Done means: the three red assertions (1a, 2, 3) fail on `main` and pass on the branch, and the five ownership-related test files stay green.

## Amendments

1. Replace "No test covers a `tracker-account` ticket with several assignees" with "No test puts a declared other person before the reader on a `tracker-account` ticket; `waiting-tickets.test.ts:200` and `lanes-for-reader.test.ts:134` put an undeclared assignee first."
2. State that the Jira adapter emits at most one assignee (`plot-host.sh:5429`), so the defect is latent on main; reword the Changelog accordingly, or drop "assigned to several people" from the user-facing line.
3. Add Discovery («Mine» in `lanesForReader`) to the Effect list, and add the `tracker-account` parity case next to `lanes-for-reader.test.ts:124`.
4. In the Waiting-on-you assertion, specify `inbox` undefined (or an inbox without the ticket), and say why.
5. Mark `[mruepp, jan]` as the assertion that is red on main; add `[mruepp, undeclared]` → `theirs`.
6. Answer the open question as "keep `theirs`", and add the `ownerOf` label question.
7. Cite #2812 (the plan PR) instead of "panel round 1 on #2811".
