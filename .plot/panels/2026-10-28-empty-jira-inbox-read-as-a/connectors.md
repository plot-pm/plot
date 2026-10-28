# Juror verdict: connectors

Position: amend

Evidence: I read the plan, issue #2808 (`gh issue view`), `waiting-tickets.ts`, `ownership.ts`, `person.ts`, `fold-issue-rows.ts`, `tracker-shell.ts` (walk), `tracker-jira.ts`, `issue-refresh.ts` (refreshIssueIndex, inboxOutcomeOf), `fleet.ts` (waitingOf, refreshIssues, offlineIssueRowsInto, readIssuesFromStore, idea-PR rows), `server-info.ts` (identity), `mine-filter.ts`, `waiting-view.ts`, `AgentList.tsx`, `DraftPlanSchema`, and the Jira and Bitbucket arms of `plot-host.sh`. I ran these: (1) an esbuild-bundled node probe over the worktree's domain sources (`waitingTickets`, `parsePersonDirectory`, `ownership`, `foldIssueRows`) with the real ewz-kus-portal `People` line from `origin/develop:AGENTS.md:74`; (2) `plot-host.sh account` in the ewz-kus-portal checkout (exit 4); (3) `plot-host.sh pr-list --state open` in ewz-kus-portal (read-only); (4) `git diff --name-only origin/develop...origin/idea/<slug>` for the three idea branches; (5) two read-only Jira searches through the Atlassian connector (`resolution = EMPTY AND project IN (EWZKUS) ORDER BY created DESC`, pages 1 and 2); (6) a read of the local PR index `ewz-kus-portal/.git/.plot/state/index/bitbucket.json`. I wrote nothing to Jira, Bitbucket or GitHub.

## (a) Problem statement

**Finding 1, and it changes slice 1: the current code already handles an empty inbox correctly. The banner comes from `inbox === undefined`, not from `inbox === []`.** The probe used the real `People` line, reader `jwloka`, and a `jira:` tracker-account source:

```
hostUser="jwloka" inbox=undefined -> tickets=3 hidden=0 notice="The tracker names your tickets' assignee `markus.ruepp@quatico.com`; `People` declares `jira:jan.wloka@quatico.com` for jwloka — add `jira:markus.ruepp@quatico.com` to match."
hostUser="jwloka" inbox=[]        -> tickets=0 hidden=3 notice=null
```

`waiting-tickets.ts:201` sets `candidates = inbox !== undefined ? inbox : rows`. With `[]`, `candidates.length > 0` at `:203` is false, so no notice appears and the `mine` union at `:223-225` returns 0 rows. The plan's Motivation 1 says an empty inbox "falls back to all open rows". That is wrong. The fallback runs only when no inbox reached the function. The probe reproduced the issue's banner word for word only with `inbox: undefined`.

**Where `inbox` arrives undefined.** There are three paths:

- **Board with no fleet (the likeliest one):** `refreshIssues` calls `waitingOf(opts, rows, plans, ticketSource, said.value.complete)` at `fleet.ts:2096` and passes no sixth argument, so `inbox` takes its default `undefined` (`fleet.ts:1922`). That function never calls `issueListInbox`. Only fleetd's `refreshIssueIndex` makes the inbox read (`issue-refresh.ts:501`). A board running while fleetd is down therefore always shows the project-wide fallback and the misleading notice.
- **Board with a fleet:** `readIssuesFromStore` passes `index.inbox` (`fleet.ts:2262`). That field is absent where the inbox read was unsupported, or where it was skipped because the closed read failed (`issue-refresh.ts:495-501`, `inboxSkipped`). An index written before the inbox field existed also lacks it.
- An answered empty inbox writes `inbox: []` (`inboxOutcomeOf`, `issue-refresh.ts:249-256`), and the schema keeps it (`issue-index.ts:171`). That path is correct.

**Slice 1 as written fixes nothing and keeps the bug.** It says "the arm where the inbox query did not run (`inbox === undefined`) keep[s] [its] current behaviour". That arm is the bug.

**Finding 2: the notice suggests a spelling that `People` already gives to someone else.** `jira:markus.ruepp@quatico.com` is declared for `mruepp` in `origin/develop:AGENTS.md:74`. `parsePersonDirectory` drops a spelling that two handles claim (`person.ts:99-101`). Following the banner's advice would therefore unresolve mruepp as well as fail to resolve jwloka. Neither the plan nor the issue says this.

**Finding 3: the issue's "40 open tickets" is not what the read sees.** The board's open read is `resolution = EMPTY AND project IN (EWZKUS) ORDER BY created DESC` (`plot-host.sh:5337`). Jira answers `totalCount: 202` for it. Of the first 100 rows, 79 have no assignee, 9 belong to christian.kehl, 4 to markus.ruepp, 2 to andreas.milz, and the rest are mixed. So the open walk spans 3 pages of 100 (`ISSUE_PAGE_ROWS`, `issue-index.ts:20`). The duplicate investigation (slice 2) has to cover a multi-page walk, not a single page. The "16 unassigned" the issue counts are what got through the 50-row cap, not the whole set.

**Motivation 4's cause is misnamed. The author resolves.** See (d) Q2.

## (b) Approach

- **Slice 1 must fix the caller, not only the rule.** Make `refreshIssues` make the inbox read whenever the tracker supports one (`tracker.issueListInbox`, the same call as `issue-refresh.ts:501`) and pass it to `waitingOf`. A refused inbox read keeps the earlier one, as `inboxOutcomeOf` does. Otherwise a board with no fleet keeps the bug. This also matches *A Decision Reads The Index*: on a fleet board the inbox arrives from the index, and on a board with no fleet it arrives from the board's own read, which the board already makes for the open set.
- **In the domain:** on a `tracker-account` source with `inbox === undefined`, `waitingTickets` should never take `raw` from the project-wide `rows`. Those rows are by construction not the reader's once `Ticket prefixes` drops the person clause (`plot-host.sh:5290-5291`). The honest output is a notice saying the reader's own tickets were not read, plus `hidden` = all rows. It must not name another person's account.
- **Guard the suggestion:** emit no `add <prefix><raw>` advice where `declaresSpelling(prefix + raw, directory)` is already true. Name the handle that holds the spelling instead.
- The rule stays in the domain, so the layering rule and *Every rendered state is a domain property* hold. No connector change is needed for slice 1 beyond the board's extra call to an existing port operation.

## (c) Slices

- Slice 1 should carry two changes on one branch: the domain arm for `inbox === undefined` plus the suggestion guard, and the board caller in `fleet.ts:refreshIssues`. Both are needed for the banner to disappear on a board with no fleet, so splitting them gives a slice that passes its own test and still shows the banner.
- Slice 2 is correctly a separate investigation, but its scope is wrong. See (d) Q1.
- Slice 3 holds two different things: a behaviour change («Mine» hides `unknown`, plus the count control) and a defect (Draft plan rows bypass «Mine» entirely; see (d) Q2). The defect is a bug and fits this Type: bug plan. The control is a feature. I would split the `feature/` branch off into its own plan, or at least into its own slice after a `bug/` slice for the Draft bypass.

## (d) Open questions

**Q1 — where can a row be emitted twice?** I could not reproduce the exact twelve duplicates without the ewz board's live index (this machine has no `issues.json` for ewz-kus-portal, only `bitbucket.json` dated 2026-10-02). I traced every concatenation or merge on the ticket path. **No hop between the Jira page and the rendered list enforces one row per key, except `unionDedup`, which only runs on the `mine` branch.**

| hop | file:line | dedups by `number`? |
|---|---|---|
| Jira pages concatenated | `tracker-shell.ts:285-293` (`issues.push(...page.value.issues)`) | no |
| full read written to the index | `issue-refresh.ts:520` (`rows: result.value.issues.map(issueIndexRowOf)`) | no |
| changed-since fold | `fold-issue-rows.ts:38-41` pushes every held key into `order` unconditionally | **preserves a duplicate already held** (probe: held `[1,2,1]` + `[3]` → `[1,2,1,3]`) |
| board's own read | `fleet.ts:2077` (`rows = said.value.issues.map(...)`) | no |
| `inboxOf` → `entry.issues` | `fleet.ts:1866-1898` | no |
| `waitingTickets.render`, fallback arms `:178`, `:185`, `:197`, `:213` | `waiting-tickets.ts:156-175` | **no** (probe: rows `[1,2,1]` → tickets `[2,1,1]`) |
| client union (*show every ticket*) | `waiting-view.ts:33-40` | keeps duplicates inside `issues` |

The rendered list in the issue was the notice fallback (`:213`), which renders `rows` as given. A duplicate in the index rows therefore reaches the screen untouched, and once in the index the changed fold keeps it until the next full read (`dueForFullRead`, `issue-refresh.ts:283-292`). Jira's own pagination looked clean: page 2's cursor is a keyset over `created`+key (the token decodes to `created … ORDER_DESC … EWZKUS … 3378`), and page 2 starts at EWZKUS-3355 with no overlap I could see. I did not fetch page 3. The keys the issue names (3897…3849) are the NEWEST tickets, the ones the changed read (`updated >= -Nm`) returns. That points at the index's held rows plus the changed fold, or at a full read concatenated against a held set, rather than at Jira. **Recommendation:** enforce the invariant where the rows are written and where they are read. `walk` (or `issueIndexRowOf`'s caller) folds through `foldIssueRows`, and `foldIssueRows` dedups `held` too (`if (!byKey.has(...)) order.push`). `waitingTickets` dedups `rows` once at entry. Then add a domain test with a held index containing a duplicate key plus a changed row, asserting one row per key in `foldChangedIssueRows` and in `waitingTickets(...).tickets`. Ask the reporter for a copy of ewz's `.git/.plot/state/index/issues.json` before slice 2 starts. A `jq '[.rows[].number] | group_by(.) | map(select(length>1))'` over it answers Q1 in one line.

**Q2 — what identifier does the Bitbucket PR author arrive as?** It arrives as `.author.nickname` (`plot-host.sh:4971`, `:4978`, `:4983`; the comment at `:4835-4839` says so). Measured today with `plot-host.sh pr-list --state open` in ewz-kus-portal, #3509, #3526 and #3527 all carry `"author":"Christian Kehl"`. Quatico nicknames usually equal the display name, but not always: the local PR index holds `jwloka` (53 PRs) beside `Christian Kehl` and `Markus Ruepp`, so a nickname can be a login-like word. `resolvePerson` lowercases and trims (`person.ts:30`, `:43-49`), and `ckehl = Christian Kehl, …` declares `christian kehl`. **The author resolves.** The probe gives `ownership({kind:'pr', author:'Christian Kehl'}, {hostUser:'jwloka', …})` = `theirs`. No new `People` syntax is needed: a Bitbucket author is a plain, unprefixed spelling equal to the nickname. The docs should say exactly that, and that the nickname, not the display name, is what to declare.

The `unknown` therefore comes from somewhere else. There are two candidates, and the plan should name both:

1. **The reader has no host login on Bitbucket.** `plot-host.sh account` exits 4 there (measured: *"bitbucket names no signed-in user without an API request"*, `plot-host.sh:4003-4025`) unless `PLOT_BUDGET_ACCOUNT` is set. `identity()` then yields `hostUser: ''` (`server-info.ts:206-219`), and every `pr` row is `unknown` (`ownership.ts:103-106`). The probe gives `hostUser=""` → `unknown`. The banner's "for jwloka" shows that hostUser was `jwloka` on the reporter's board, so `PLOT_BUDGET_ACCOUNT` was probably set there. But every other Bitbucket reader hits this, and slice 3's "Mine hides `unknown`" would hide EVERY PR row for them. That is the "silently empties the board" failure the plan says it guards against. Slice 3 must state what «Mine» does when `comparableLogin(reader) === ''`.
2. **Draft plan rows never pass through «Mine».** `draftRows` (`AgentList.tsx:514`) is rendered at `:1176` with no `rowsForReader`. `DraftPlanSchema` (`schema.ts:4180-4189`) carries no author, PR or assignee, so no ownership rule can read it. A Draft row appears only where no `fleet.rows` row has the plan slug (`working-agents.ts:133-136`). The three idea branches' plan files do match their branch suffixes (`docs/plans/2026-08-12-ewzkus-3744-mfv-versandart-matrix.md` and so on), so with a complete PR map they would join as idea-PR rows (`fleet.ts:6670`, `pr` arm wins). Whichever happened on the reporter's board, the Draft path is a «Mine» hole.

**New questions the plan should carry:**

- Q5: On a Bitbucket reader with no `PLOT_BUDGET_ACCOUNT`, what does «Mine» show once `unknown` is hidden? Should the board require or offer the login (for example, a `People`-declared handle the reader picks) before it hides anything?
- Q6: Does the board with no fleet make the inbox read itself (slice 1), and what does it spend? One more Jira request per issue poll, counted into `entry.issueRequests`.
- Q7: Should the notice ever name a spelling that `People` already gives to another handle? I propose no.

Q3 and Q4 (the *Unassigned* section, the *Only my work* toggle) are the board lens's to answer.

## (e) Tests

- Slice 1, domain unit (`waiting-tickets.test.ts`): (i) `inbox: []` → 0 tickets, `notice: null`. This already passes, so pin it. (ii) `inbox: undefined`, tracker-account, `People` with `jira:` spellings, rows assigned to another declared person → no notice naming that person's account, and `hidden` = rows. (iii) The notice never suggests a spelling `declaresSpelling` already holds for another handle. Board unit: `refreshIssues` with a tracker fixture whose `issueListInbox` answers `[]` → `entry.waiting.notice === null` and `tickets.length === 0`. `tracker-fixture.ts:151` already supports this.
- Slice 2, domain unit: `foldIssueRows` with a duplicated `held` key returns one row per key; `foldChangedIssueRows` likewise; `waitingTickets` with duplicated `rows` renders each key once on every arm, the fallback arms at `:178`, `:185`, `:197`, `:213` included. Domain unit for `walk` through a fake `runProcess` returning two pages with one overlapping key → one row.
- Slice 3, domain unit: an ownership count property (mine/theirs/unknown) over branch, Draft and ticket rows. The Draft-row case needs the schema to carry an owner field first. A case with `hostUser: ''` asserts the chosen behaviour from Q5. One browser test that the count control renders the domain's number.

## Amendments

1. Rewrite Motivation 1: an empty inbox already yields zero. The banner comes from `inbox === undefined`, and `fleet.ts:2096` (board with no fleet) never passes one. Cite the probe.
2. Slice 1: add the inbox read to `refreshIssues`. Change the `inbox === undefined` tracker-account arm so it never takes `raw` from project-wide rows. Add the guard against suggesting a spelling `People` already gives to another handle.
3. Motivation 2 and slice 2: replace "40 open tickets" with the measured 202-row, 3-page open read. List the non-deduping hops above. Make one-row-per-key an invariant at index write (walk / `foldIssueRows`) and at `waitingTickets` entry. Ask for ewz's `issues.json` first.
4. Motivation 4: the Bitbucket author is the `nickname` ("Christian Kehl"), and it resolves to `ckehl` (`theirs`). Name the real causes: an empty `hostUser` on Bitbucket (`plot-host.sh account` exit 4), and Draft rows that bypass «Mine» (`AgentList.tsx:514`, `:1176`; `DraftPlanSchema` has no owner field). Document the `People` rule as "declare the Bitbucket nickname as a plain spelling".
5. Split slice 3: a `bug/` slice for the Draft-row bypass, and the feature (count control, *Unassigned*) as its own plan or a later slice. Add Q5–Q7.
