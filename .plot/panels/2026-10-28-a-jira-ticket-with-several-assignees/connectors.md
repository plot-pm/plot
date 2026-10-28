# Juror verdict: connectors (Jira and GitHub tracker owner)

Position: amend

Evidence: Read the plan, issue #2819, `packages/domain/src/rules/ownership.ts`, `waiting-tickets.ts`, `ticket-lanes.ts`, `entities/person.ts`, `adapters/tracker/tracker-listers.ts`, `adapters/tracker/tracker-shell.ts`, `skills/plot/scripts/plot-host.sh` (issue-list arms, :5290-5500), `packages/board/src/server/fleet.ts:1900-1945`, and the existing tests in `ownership.test.ts`, `waiting-tickets.test.ts`, `lanes-for-reader.test.ts`, `ticket-lanes.test.ts`. Ran: (1) a throwaway vitest probe against the domain functions at this tree (copied into `packages/domain/test/`, run, moved out again; the worktree is clean); (2) one read-only `plot-host.sh issue-list --limit 50` in the `ewz-kus-portal` checkout (Jira, `EWZKUS`).

## (a) Problem statement

- The domain defect is real. Probe results: `tracker-account` `[max, jan]` (both declared) answers `theirs`; `[jan, max]` answers `mine`; `[undeclared, max]` answers `theirs`; `host-login` `[eins78, jwloka]` answers `mine`. `waitingTickets(rows, undefined, …, JIRA)` with `[max, jan]` gives 0 tickets and 1 hidden. Cited lines are correct: the early return is at `ownership.ts:161-162` inside the function at `:153`; the contradicted comment is `:176`; `accountMatches` is `waiting-tickets.ts:83-93`; the `'mine'` filter is `:223`.
- **The shipped Jira connector cannot produce the input.** `plot-host.sh:5429` projects `assignees: ([.fields.assignee.emailAddress // .fields.assignee.accountId] | map(select(. != null)))`. That is the single Jira `assignee` field, so every Jira row carries 0 or 1 assignee. Measured on `ewz-kus-portal` today: 50 open rows, 41 with 0 assignees, 9 with 1 (all email spellings), 0 with 2 or more. `tracker-account` is declared only for `jira` (`tracker-listers.ts:20`). So no reader can see the board effect the Motivation and Changelog describe. The defect is latent: a domain contract violation with no reachable trigger through any current connector.
- The trackers that do deliver several assignees all use `host-login`: `github-issues` (`tracker-listers.ts:21`) and the git-host lists for `github` and `bitbucket` (`:30-31`); GitHub rows come from `assignees:[.assignees[]?.login]` (`plot-host.sh:5481`). That arm already checks every assignee (`ownership.ts:188-195`), and `lanes-for-reader.test.ts:123` pins the reader as second assignee. GitHub is not affected.
- Assignee spelling: Jira rows carry `emailAddress`, falling back to `accountId` where Jira hides the email; never the display name. The `jira:` spelling the directory needs is therefore an email or an account id. The plan does not mention this; it matters for the test fixtures (use emails, as `ownership.test.ts:275` does).
- "No test covers a `tracker-account` ticket with several assignees" is not accurate. `waiting-tickets.test.ts:200` and `lanes-for-reader.test.ts:136` both cover several `tracker-account` assignees, with the undeclared one first. What no test covers is two **declared** spellings, one of them someone else.
- "«Mine» off: *Waiting on you* still drops the ticket" holds only when the inbox is absent or misses the row. With an inbox (`assignee = currentUser()`, `plot-host.sh:5350`) the row arrives through `unionDedup(inbox, mine)` (`:224`), and the probe shows 1 ticket and 0 hidden.

## (b) Approach

- The "any assignee → mine; else any declared other → theirs; else unknown" rule is right and matches `ticketOwnership`'s `host-login` arm and `planOwnership` (`:135-141`). It fixes the cause, not a symptom, and it holds for every tracker because the `host-login` arm already behaves this way.
- No contract breaks. Every reader goes through `ownership()`: `waitingTickets` (`:188`, `:223`), the Discovery lanes (`lanes-for-reader.ts:76`), and the board's `mine-filter.ts:184`. A single-assignee row answers the same before and after, so no Jira reader today sees a change.
- **A duplicate rule remains.** `accountMatches` (`waiting-tickets.ts:83-93`) re-implements the same loop with `.handle ===` in place of `samePerson`. The fix leaves two copies of "does a tracker-account assignee resolve to the reader", and their disagreement is the bug class this plan fixes. Export one predicate from `ownership.ts` (or call `ownership(...) === 'mine'`) and use it in both places.
- **`ownerOf` stays order-dependent** (`ticket-lanes.ts:98-109`): it names the first declared assignee. After the fix, a `[max, jan]` row is `mine` but its card owner reads `eins78`. On GitHub this already happens today with undeclared logins (`['eins78', 'jwloka']` → owner `eins78`, ownership `mine`), and GitHub rows really do have several assignees. The plan should state whether a `mine` row names the reader as owner, or leave it and say so.
- Layering and "every rendered state is a domain property" hold: the change is in `packages/domain/src/rules/`, and the rendered values derive from it.

## (c) Slices

- One slice is the right cut, and it is independently mergeable. It is small enough to ship as a bug fix.
- Rename the slice and title to the actual scope ("tracker-account ownership checks every assignee"). The current title asserts a Jira behaviour no Jira read produces.
- The `accountMatches` consolidation belongs in the same slice; it is the same rule.

## (d) Open questions

- The plan's question: keep `[undeclared, declared-other]` as `theirs`. Evidence: `personFieldOwnership` treats an undeclared free-text spelling as `unknown` because it may be the reader. A tracker account differs: the reader's own account is matched only through a declared `jira:` spelling (`waitingTickets` posts a notice naming the missing spelling, `:214-219`). So an undeclared Jira account is not the reader's declared self, and `theirs` is consistent. Agree with the plan.
- New: should the Jira connector read several assignees at all? Jira Cloud has one `assignee`; multi-person assignment lives in instance-specific custom user-picker fields that `plot-host.sh` does not read. If no such read is planned, the plan should say the fix is for the contract and future `tracker-account` sources, not for Jira today.
- New: should `ownerOf` prefer the reader when the row is `mine`?
- New: does the Changelog line belong in a release note at all, given no user-visible change today? A note like "the ownership rule checks every tracker-account assignee" states current behaviour without promising a visible fix.

## (e) Tests

- Domain unit, `ownership.test.ts`: the four cases in the plan, using email spellings (`jira:jan.wloka@quatico.com`), plus a single-assignee regression (unchanged answer).
- Domain unit, `waiting-tickets.test.ts`: `[other-declared, reader]` with `inbox === undefined` → shown 1, hidden 0. This is the only configuration where today's code drops it; with an inbox the row is already shown.
- Domain unit, `lanes-for-reader.test.ts`: one row `['max.albrecht@quatico.com', 'jan.wloka@quatico.com']` with both declared and «Mine» on → kept. Discovery lanes are a second reader of the same rule.
- If `accountMatches` is consolidated: a test that the two answers agree for the same row set.
- No board or browser test is needed; the board only renders the domain's answer.

## Amendments

1. State that the defect is latent: `plot-host.sh:5429` emits at most one Jira assignee (measured 0 of 50 `EWZKUS` rows with 2 or more). Rewrite the Motivation's board effects and the Changelog line to match.
2. Correct "No test covers…" to "no test covers two declared `tracker-account` spellings"; cite `waiting-tickets.test.ts:200` and `lanes-for-reader.test.ts:136`.
3. Qualify the *Waiting on you* effect: it applies only when no inbox read supplied the row (`waiting-tickets.ts:224`).
4. Replace `accountMatches` (`waiting-tickets.ts:83-93`) with the fixed rule from `ownership.ts`, so one predicate answers "is this tracker-account assignee the reader".
5. Add an open question, or a decision, on `ownerOf` naming the first declared assignee on a `mine` row (`ticket-lanes.ts:107-108`); it already shows on GitHub multi-assignee issues.
6. Use email-shaped `jira:` spellings in the new fixtures, matching what the connector emits.
