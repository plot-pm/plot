## Implementation brief — tickets-show-what-the-sprint-delivers-and-found (wave 1: Payload)

- **Plan (canonical):** `docs/plans/2026-11-20-tickets-show-what-the-sprint-delivers-and-found.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/scope-ticket-rows-in-the-payload` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

The plan's first slice, in the sprint "Delivery UI Polish" (plan 7 of 7). It waits on nothing and changes no UI. `feature/tickets-show-what-the-sprint-delivers-and-found` (wave 2) waits on it, plus four slices of other plans, and reads every field this slice ships.

### What to build

The Tickets section lists only the tickets no plan names. To show what the scope delivers and what the fleet found, the client needs rows that neither of today's row sets holds: `Fleet.issues` drops every ticket a plan names and stops at `ISSUE_LIMIT = 50`, and `Fleet.waiting.tickets` holds only the reader's selection and hides unassigned rows, while fleetd opens its review findings with no assignee. This slice adds the server-side payload fields, built from data the server already holds, and one domain predicate. It adds no tracker call.

- `planTicketRows` on the fleet payload (schema default `[]`, no `ISSUE_LIMIT` cut), built from `entry.issueSets` (open `rows` and `closed.rows`). It keeps a row whose key a plan's `Issue:` field names (`ticketPlansOver`), whose title `isReviewIssueTitle` accepts, or whose key a card's `refutedIssues` names. Each row carries its state (open or closed), and the field carries the open set's `complete` flag.
- `isReviewIssueTitle(title)` exported from `packages/domain/src/rules/review-issue.ts`, sharing `TITLE_PREFIX` and the ` on PR #<n>` suffix with `findOpenReviewIssue`. Unit cases: `findings on PR #1` and `findings on PR #12` match; a `plot-review:` title of another form does not; a title with no PR number does not.
- `ticketPlans: Record<issueKey, TicketPlan[]>` on the fleet payload (schema default `{}`), from the map `ticketPlansOf(opts, entry)` returns on the same pass.
- `unassignedKeys` and `assignedToOthersKeys` on `FleetWaitingSchema` (schema default `[]` each), from the same `hiddenRows` that `waitingTickets` counts for `unassigned` and `hidden`.
- `refutedIssues` on the card (schema default `[]`), filled where `card.verification` is, from the same `refutedClaims(delivered.text)` call, and `[]` elsewhere.

Each field has a server test, named in the plan. The plan is canonical; this brief records what you must not re-derive.

### Settled decisions — do not re-derive them

- **The rows come from `entry.issueSets`, not from `Fleet.issues` or `Fleet.waiting.tickets`.** `inboxOf` leaves out every planned ticket and cuts at `ISSUE_LIMIT`; `waitingTickets` shows only the reader's selection. Neither can hold a delivered ticket or an unassigned finding. The same sets already serve `ticketLaneData` to the Discovery tab, so no new query runs.
- **The closed rows are the last `ISSUE_INDEX_CLOSED_DAYS` (14) days, and an ordinary issue pass caps them** (see the comment above `closedCache` near `fleet.ts:2016`, which separates this from `GET /api/issues/closed`'s 1000). A ticket closed earlier, or beyond that cap, is absent from `planTicketRows`. Absent is not closed: do not add a state for it here, and do not widen the read to fetch it. Wave 2 renders such a row key-only, with no "closed" word. This was the plan's panel round 1 finding: the spec's premise "no payload holds closed tickets" was false, and the alternative of rendering every delivered ticket key-only was rejected.
- **`ticketPlans` ships the server's `TicketPlan` records, because the client has no other source.** `ticketPlansOver` is private to `fleet.ts` and a card's `sliceSummary` holds no merged count (`schema.ts`). Compute nothing new: expose the map the pass already builds. An unread pulse carries `merged: null`, not `0`.
- **The hidden keys are needed because a count cannot be reduced by a key it does not name.** `waiting.unassigned` counts every hidden open unassigned row, and a fleetd review finding is one. Wave 2 subtracts the scope's finding keys from these lists, so they must come from the same `hiddenRows` the counts read. Two lists that disagree with the counts would make the header wrong by the difference.
- **`refutedIssues` is a new payload field and not a new data source** (operator decision, 2026-11-20). `refutedClaims(delivered.text)` runs only where `reads.delivered` holds, so a Released plan with an open refuted-claim issue yields `[]`. That is a known limit named in the plan, not a defect for this slice. Do not read `.plot/state/verify/<slug>.json`, and do not add a plan-text read for Released plans.
- **No label field on the issue row.** The board matches a review finding by its title alone (operator decision, 2026-11-20). `IssueRowSchema` gains no label.

Rules carried over: the index never says no, so absence from a set is never a state; a new function you write is an arrow with factual TSDoc, and a function you only pass through stays as it is (CLAUDE.md, *The Domain Package*); every payload field has a schema default so an older payload still parses.

### Done when

The plan's slice line and the Slice 1 bullets are the specification. Assertions that exist because a naive implementation would pass without them:

- A server test that a ticket a plan names reaches `planTicketRows` with its title, and that a closed one in the closed set reaches it as closed. Catches a build from open rows only.
- A server test that a review finding beyond the 50-row inbox cut reaches `planTicketRows`. Catches a field that reuses `inboxOf`.
- A server test that a Approved plan's ticket with one of two slices merged carries `{ state: 'approved', total: 2, merged: 1 }`, and that an unread pulse carries `merged: null`. Catches a `0` for an unread count.
- A server test that an unassigned review finding beyond the shown rows reaches `unassignedKeys`. Catches keys built from the shown rows.
- A server test that a Delivered plan with one `Claim-1 refuted — … — #1712` line yields `["1712"]`, and that a plan with no `## Verification` section yields `[]`.
- Unit cases for `isReviewIssueTitle` as listed above.
- A schema parse test that a payload without the five new fields still parses to the defaults, if the contract tests have a pattern for it.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for the board with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses growth: remove shell elsewhere in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override. This slice should touch no shell.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/review-issue.ts` and its test, the fleet payload and its builders in `packages/board/src/server/fleet.ts`, the card field in `packages/board/src/server/board.ts`, the new fields in `packages/board/src/contract/schema.ts` (`FleetWaitingSchema`, the fleet payload, the card), the hidden-key outputs of `packages/domain/src/rules/waiting-tickets.ts`, and the server tests in `packages/board/test/unit/`.

Leave to wave 2: `scopeTickets`, `ticketIsMine`, `TicketsSection.tsx`, `tickets-section.ts`, the fold keys and every `.tsx` file. No client code reads the new fields in this slice.

In flight on origin, verified at dispatch on 2026-11-20: only `feature/delivery-tuple-vocabulary` of the sprint's slices has a ref; the other Delivery UI Polish slices have none yet, and the plans of the sprint (tuples, folds, row menu, Mine) touch `AgentList.tsx`, `DeliveryRows.tsx`, `collapse.ts` and `ownership.ts`, which this slice does not. A conflict is possible only in `schema.ts` if another slice adds payload fields: keep both sets.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
