# Juror verdict: owner of ownership.ts — accountTicketOwnership and waitingTickets over the plan's cases and mixed readers

Position: amend

Evidence: Read the plan, issue #2819, `packages/domain/src/rules/ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts:98-109` (`ownerOf`), `lanes-for-reader.ts:60-80`, `entities/person.ts`, `packages/board/src/app/lib/agent-rows/mine-filter.ts:170-186`, `packages/board/src/server/fleet.ts:1901-1926`, `packages/domain/test/ownership.test.ts:247-310`, `packages/domain/test/waiting-tickets.test.ts:59-215`, `packages/domain/vitest.config.ts:61-72`. Ran: an esbuild-bundled node probe (`scratchpad/juror-2819-domain-rules/probe.ts`) that calls the real `ownership`, `waitingTickets` and `ownerOf` on 14 assignee/reader cases, beside a copy of the plan's proposed loop; and `vitest run test/ownership.test.ts test/waiting-tickets.test.ts test/lanes-for-reader.test.ts` (3 files, 112 tests, all pass on the subject tree).

## (a) Problem statement

- Every cited line holds. `ownership.ts:153` is `accountTicketOwnership`; `:158-163` returns at the first declared assignee; `:176` is the doc line *"Every assignee is checked; any match is `mine`."* `waiting-tickets.ts:83-93` is `accountMatches` (every assignee); `:223` filters `=== 'mine'`.
- Reproduced (ran). Directory `jwloka = Jan Wloka, jira:jan@q.com; mruepp = jira:mruepp@q.com; eins78 = jira:max@q.com`, reader `hostUser: jwloka`, source `jira:`:

  | case | current | proposed |
  |---|---|---|
  | `[mruepp, jan]` | theirs | **mine** |
  | `[jan, mruepp]` | mine | mine |
  | `[mruepp, max]` | theirs | theirs |
  | `[undeclared, mruepp]` | theirs | theirs |
  | `[undeclared]` | unknown | unknown |
  | `[mruepp, undeclared]` | theirs | theirs |
  | `[blank, jan]` | mine | mine |
  | `[mruepp, " JAN@Q.COM "]` | theirs | **mine** |

- **The *Waiting on you* effect is conditional, and the plan states it unconditionally.** Probe (ran) with rows `1=[mruepp, jan]`, `2=[jan, mruepp]`, `3=[mruepp]`: with `inbox` absent the answer is `tickets [2], shown 1, hidden 2` — ticket 1 is dropped as the plan says. With an inbox read holding tickets 1 and 2 the answer is `tickets [2, 1], shown 2, hidden 1` — ticket 1 is shown through `unionDedup(inbox, mine)` (`waiting-tickets.ts:224`). So the drop happens only where no inbox read ran (`fleet.ts:1922`, `inbox = undefined`) or where the inbox missed the row. The Motivation should say so; as written it overstates the visible effect for a Jira repository that has an inbox read.
- *"No test covers a `tracker-account` ticket with several assignees"* is not quite right: `waiting-tickets.test.ts:200` covers `['somebody-undeclared', 'jan.wloka@quatico.com']`. What no test covers is a ticket with a **declared other person ahead of the reader** — the only order that fails. Narrow the sentence to that.
- A missing cause in the same rule family: `ownerOf` (`ticket-lanes.ts:107-108`) also takes the **first** declared assignee. See (b).

## (b) Approach

- The rule "any assignee resolves to the reader → mine; else any declared assignee resolves to someone else → theirs; else unknown" fixes the cause and is complete for the `tracker-account` arm. Across the 14 probe cases it changes exactly the two rows where a declared other precedes the reader (cases 1 and 13 above, and case 8 below) and no other answer.
- **The better precedent is `planOwnership` (`ownership.ts:135-141`), not the `host-login` loop.** The `host-login` arm counts an undeclared non-matching login as `theirs` (`:193`, `sawTheirs = true` on any non-blank); the `tracker-account` arm must count it as no information. `planOwnership` has exactly the proposed semantics — map each field to a reading, `includes('mine')` → mine, `includes('theirs')` → theirs, else unknown — and its doc comment already says it in the words the plan wants. Citing the `host-login` arm as "the model" invites someone to copy `sawTheirs = true` for undeclared assignees, which would turn `[undeclared]` from `unknown` into `theirs` and hide every row whose Jira account nobody declared.
- Mixed host-login / tracker-account readers (ran):
  - `hostUser: "Jan Wloka"` (a declared display spelling, no `@`): current `theirs`, proposed `mine`. Correct — `comparableLogin` accepts it and `resolvePerson` maps it to `jwloka`.
  - `hostUser: jan@q.com` (email): `unknown` both before and after (`comparableLogin` returns `''`, `ownership.ts:94`). Unchanged.
  - `hostUser: ''`, `gitEmail` set: `unknown` both. Unchanged; `gitEmail` is never compared.
  - Reader login `jwloka` where the Jira spelling is declared under a different handle (`jan = jira:jan@q.com`, no `jwloka` entry): `theirs` both before and after — the reader's own ticket hides under «Mine». Pre-existing and a configuration error, not this plan's defect; worth a new question (d).
  - `jira:jan@q.com` claimed by two handles: `parsePersonDirectory` drops it (`person.ts:99-101`), so it reads undeclared and the ticket is `theirs` by `mruepp`. Correct by the directory's contract.
  - An unprefixed host-login-shaped assignee in a Jira source (`[mruepp, jwloka]`): `theirs` both, because `jira:jwloka` is undeclared. Correct for the `tracker-account` contract.
- **New rendered inconsistency the fix exposes.** After the fix, ticket 1 `[mruepp, jan]` is `mine`, but `ownerOf` names `mruepp` as its owner (probe: `waiting ... ["1","mruepp"]`; the Discovery card uses the same `ownerOf`, `ticket-lanes.ts:121`). With «Mine» on, the reader then sees their own ticket labelled with someone else's handle. Today that row is hidden, so the label is never seen; the plan makes it visible. `ownerOf` takes no reader, so fixing it needs either a reader parameter (prefer the reader's handle when any assignee resolves to them) or a decision that the owner column names the first declared assignee by design. Under "Every rendered state is a domain property" this is a domain decision, and it belongs in this plan as an open question or a stated non-goal.
- Layering and index rules: the change stays inside `packages/domain/src/rules/ownership.ts`; all three readers (`waitingTickets`, `lanesForReader` via `ownedTicket`, the board's `mine-filter.ts:185`) go through `ownership`, so one fix reaches all of them. No index or port is touched.
- Board readers: the plan names «Mine» and *Waiting on you*; the Discovery lanes (`lanes-for-reader.ts:77`) are a third reader that changes the same way. Add it to the Changelog/Motivation so the release note is complete.

## (c) Slices

- One slice, one branch, independently mergeable: correct cut. Nothing needs to ship first.
- If the plan takes the `ownerOf` question into scope, it can stay in the same slice (same rule family, same tests) or become a second slice; it should not be left implicit.

## (d) Open questions

- *Should an undeclared assignee next to a declared other keep the ticket `theirs`?* Yes. It matches `planOwnership` and `personFieldOwnership` (`ownership.ts:119-141`), where a declared other makes a field set `theirs` and an undeclared field adds nothing. Answering `unknown` instead would make the `tracker-account` arm the only one in which an undeclared value vetoes a declared answer. Probe cases 4 and 6 are `theirs` both before and after, so keeping it changes no behaviour.
- New: which assignee does the owner column name when the reader is one of several? (`ownerOf`, `ticket-lanes.ts:107`.)
- New, not for this plan: a reader whose host login is not the handle under which their `jira:` spelling is declared reads their own ticket as `theirs`. Should `waitingTickets`' notice (`waiting-tickets.ts:203-220`) also cover the «Mine» filter, or is this left to configuration?

## (e) Tests

- Domain unit, `packages/domain/test/ownership.test.ts`, inside the existing `describe('a ticket is owned by its assignees, resolved by source')` block (`:247`): the plan's four cases, plus `[" JAN@Q.COM "]` after a declared other (normalisation across the loop), plus `[undeclared]` stays `unknown` (guards against copying `sawTheirs`).
- Domain unit, `packages/domain/test/waiting-tickets.test.ts`: the reader-second ticket in `rows` with `inbox` **undefined** appears in `tickets` and is not in `hidden`. The inbox-given variant passes today and proves nothing; do not use it as the regression test.
- Domain unit, `packages/domain/test/lanes-for-reader.test.ts`: one assertion that the reader-second ticket survives `lanesForReader(..., on: true)`.
- Coverage: `src/!(adapters)/**` holds 100 % branches (`vitest.config.ts:71`). The proposed loop has four branches (continue, mine, theirs flag, final ternary); the plan's tests plus the existing `unknown` case (`ownership.test.ts:302-307`) cover them.
- No browser test is needed; the board's `mine-filter.test.ts` asserts the wrapping, not the rule (`:8`).

## Amendments

1. In Motivation, state that *Waiting on you* drops the ticket only where no inbox read ran or the inbox missed it (`waiting-tickets.ts:224`, `fleet.ts:1922`), and name the Discovery lanes (`lanes-for-reader.ts:77`) as a third affected reader.
2. Narrow "No test covers a `tracker-account` ticket with several assignees" to "no test puts a declared other person ahead of the reader"; `waiting-tickets.test.ts:200` covers several assignees.
3. Name `planOwnership` (`ownership.ts:135-141`) as the model instead of the `host-login` loop, and state that an undeclared assignee never sets `theirs`.
4. Add an open question (or a stated non-goal) for `ownerOf` naming the first declared assignee, which becomes visible on a `mine` row once the fix lands.
5. Make the *Waiting on you* regression test run with `inbox` undefined, and add `[undeclared]` → `unknown` and a case-normalised reader-second assertion to the ownership tests.
6. Close the existing open question as "keep `theirs`", citing `planOwnership`.
