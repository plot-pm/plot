## Implementation brief — empty-jira-inbox-read-as-a (wave 1: Inbox)

- **Plan (canonical):** docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2809 merged
- **Branch:** `bug/an-absent-inbox-guesses-no-spelling` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (one full review per PR)

This wave is first and nothing waits on it. Waves `bug/ticket-rows-appear-once` and `bug/draft-rows-obey-mine` touch separate files and merge in any order.

### What to build

On the Delivery board of ewz-kus-portal (`Tracker: jira`, reader jwloka, Jira `myself` jan.wloka@quatico.com), the reader's inbox holds 0 issues, yet the banner reads *The tracker names your tickets' assignee `markus.ruepp@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:markus.ruepp@quatico.com` to match.* Following that advice would drop the spelling from both people (`packages/domain/src/entities/person.ts:99-101`).

Cause: the banner reproduces only with `inbox: undefined`. `refreshIssues` in `packages/board/src/server/fleet.ts` (`:1966`) calls `waitingOf(opts, rows, plans, ticketSource, said.value.complete)` at `:2098` with no inbox, so `waitingTickets` (`packages/domain/src/rules/waiting-tickets.ts`) falls back to all open project rows (`candidates = inbox !== undefined ? inbox : rows`) and takes the first assignee as the reader's spelling. Only fleetd reads the inbox (`packages/fleet/src/shared/issue-refresh.ts:501`, `tracker.issueListInbox`). The arm for "no `jira:` spelling declared" (`declaresAnyAccountSpelling` false) has the same defect: `inbox !== undefined ? inbox : rows`.

Build:

1. The no-fleet `refreshIssues` reads the reader's inbox through the tracker connector (`issueListInbox`, as fleetd does; the CLI form is `issue-list --state inbox`) and passes the result to `waitingOf` as the inbox. One extra tracker call per refresh, on the same timer. Charge it to `entry.issueRequests` and the gate the way fleetd's `inboxOutcomeOf` does. A refused or rate-limited inbox read leaves the inbox absent and does not fail the open read.
2. `waitingTickets` distinguishes an inbox that answered (including `[]`) from an absent one. With an absent inbox on a project-scoped read, the tracker-account arm and the no-declared-spelling arm have no candidates: 0 tickets, no spelling notice, and a reason the view can name (*the inbox was not read*). They never take a spelling from project-wide rows.
3. The spelling notice fires only when the inbox is non-empty, none of its rows match the reader, and the spelling comes from an inbox row. It never suggests a spelling that `People` declares for another person (resolve the suggested spelling with `resolvePerson`; if its handle is not the reader's, no notice).
4. The rule lives in the domain. Assert each arm in `packages/domain/test/waiting-tickets.test.ts` without a browser. Replace the expectation at about `:175`, which pins the wrong advice as current behaviour.

### Decisions the plan settles — do not re-derive them

- **The fallback to project rows is the defect, not a convenience.** Project-wide rows say whose tickets exist, not whose inbox is the reader's. An empty answered inbox (`inbox: []`) already gives 0 tickets and no notice (`waiting-tickets.ts:201-203`); four independent panel probes confirmed it. Do not "fix" that arm.
- **Fixing it in the board's read, not only the rule.** The rule fix alone leaves a no-fleet board showing nothing for a reader who has tickets. Both halves ship in this branch.
- **`unknown` rows stay visible** (`2026-09-24-the-board-shows-me-only-my-work.md:123`). Hiding them behind a count, and an *Unassigned* section, were decided out of scope for a separate feature plan.
- **The offline path** (`entry.waiting = await waitingOf(..., index.inbox)` near `:2262`) already passes the index's inbox; leave it.
- **Absent is not empty.** An absent inbox and `inbox: []` are different answers; use `undefined` versus an array, and do not collapse them with `?? []` or a truthiness test.
- **Bitbucket PR author spelling is not a defect** (nickname, matched as a plain spelling; no new `People` syntax). Do not touch it.

### Done when

The plan lists no `## Done when`; the specification is the Changelog's first two lines and the Slices entry for this wave:

- A board with no fleet reads the reader's Jira inbox, so *Waiting on you* shows the reader's own tickets instead of the project's.
- With no inbox reading, *Waiting on you* never guesses the reader's spelling from project-wide tickets, and the notice never suggests a spelling `People` gives another person.

Assertions a naive implementation passes without:

- absent inbox + project rows whose first assignee is a colleague → 0 tickets, no notice (catches keeping the fallback);
- absent inbox with no declared `jira:` spelling → same (catches fixing only one arm);
- non-empty inbox, no match, suggested spelling already declared for another handle → no notice (catches the `markus.ruepp` banner);
- `inbox: []` → 0 tickets, no notice, distinct from absent (catches `?? []` collapse);
- a `refreshIssues` test with a stub tracker proving the inbox read happens and its rows reach `waitingOf`; and a refused inbox read leaving the open read answered.

Plus: add a changeset (`'@plot-pm/board'` or `plot` as the package rule requires; description first, `bumps:` block last, with `plan: docs/plans/2026-10-28-empty-jira-inbox-read-as-a.md`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI; a failure there returns as a correction. Do not run `test:e2e` locally, and do not run board tests while the operator's board is open.

`scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change.

Arrow functions for any function you write (`export const f = (…) => …`). TSDoc states what an export does, not its history; reasoning goes in the commit message.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves). Never `gh pr create`. Append `→ #<number>` to this branch's line under `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/domain/src/rules/waiting-tickets.ts`, `packages/domain/test/waiting-tickets.test.ts`, the `refreshIssues` / `waitingOf` call path in `packages/board/src/server/fleet.ts` and its board test, and the changeset.

Other branches in flight on this plan:

- `bug/ticket-rows-appear-once` holds `unionDedup`/render dedup in `waiting-tickets.ts`, `foldIssueRows` and the index write in `packages/fleet`. Expect a small overlap in `waiting-tickets.ts`; keep your edit to the arms, not to `render`.
- `bug/draft-rows-obey-mine` holds `AgentList.tsx` and `DraftPlanSchema`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
