## Implementation brief — tickets-show-what-the-sprint-delivers-and-found (wave 1: Tickets of the scope)

- **Plan (canonical):** `docs/plans/2026-11-20-tickets-show-what-the-sprint-delivers-and-found.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/tickets-show-what-the-sprint-delivers-and-found` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Plan 7 of 7 in the sprint "Delivery UI Polish", the last one. All four slices it waits on are merged: `feature/mine-means-mine-or-my-plan` (#3590), `feature/delivery-tuples-in-every-row` (plan 1), `feature/folded-sections-summarise-visually` (#3629) and `feature/delivery-row-menu-column` (#3622). Slice 1, `feature/scope-ticket-rows-in-the-payload` (#3588), is merged too. Nothing waits on this slice.

### What to build

Today the Tickets section lists only the tickets no plan names (`ticketsSection`, `packages/domain/src/rules/tickets-section.ts`). A reader cannot see which tickets the sprint delivers, or which findings fleetd opened while it delivered them. This slice adds two groups after the "no plan" group, folded by default: **Delivered by the sprint** (the tickets the scope's plans name in `Issue:`, one row per ticket and scope plan) and **Found during the sprint** (open review findings on the scope's PRs, and open verification findings a scope plan's `## Verification` names). The association of ticket to group, plan or PR, kind, state text, ⋯ items, counts and incomplete-read sentence is one domain rule, `scopeTickets`, with `ticketIsMine` beside it. The plan is canonical and long; this brief records what not to re-derive. The design spec is outside the repository: `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md`, section *Tickets of the scope*.

Plan line numbers are stale after the sprint's earlier slices. Find code by symbol, not by the plan's `file:line`.

### Drift found at dispatch — read before you start

1. **`isRefutedIssueTitle` does not exist.** Panel round 3 told slice 1 to add it (plan Notes, first builder note), and #3588 merged without it. Slice 1 feeds `planTicketRowsOf` (`packages/board/src/server/fleet.ts`) a `refutedIssues` set that `recordRefutedIssues` fills from the last **board** build's cards (`board.ts`). The fleet payload and `/api/board` are separate requests, so a fleet payload built before any board build holds no refuted keys. Add `isRefutedIssueTitle(title)` in `packages/domain/src/rules/verification.ts` over the title `Refuted claim of ${slug}: ` (`verification.ts:155`), keep rows by it in `planTicketRowsOf` like `isReviewIssueTitle`, and use the card's `refutedIssues` only for the association. This is within this slice's scope because the Found group's verification rows depend on it; record it in the plan's Notes when you do it.
2. **`ticketsForReader` still reads the lenient rule.** The plan's last Note (operator decision, 2026-11-20: "use isMineStrict for both, keep it consistent") says plan 5's slice changes `ticketsForReader` (`packages/board/src/app/lib/agent-rows/mine-filter.ts`) to `isMineStrict` in the strict mode. On `main` it still filters with `ticketMineOwnership(…) !== 'theirs'` for every mode but `all`, and its TSDoc says it "always uses the lenient rule". Do not guess: the scope groups read `isMineStrict` in strict mode as the plan says; make the "no plan" group agree in this slice (small, one function and its tests) and say so in the PR body, or stop and report if it turns out to touch other callers than the Tickets section. Do not leave the three groups disagreeing.
3. **`EXTRA_SECTION_KEYS` is `['tickets', 'not-placed']` and `COLLAPSED_BY_DEFAULT` is `['free', 'not-placed']`** (`packages/board/src/app/lib/agent-rows/collapse.ts`). Add `tickets-delivered` and `tickets-found` to both. The once-only migration of a new default key into a stored fold set exists (#3587); do not write a second one. `agent-list.test.ts` pins `COLLAPSED_BY_DEFAULT`; update it.

### Settled decisions — do not re-derive them

- **The row set is `planTicketRows`, not `Fleet.issues` and not `Fleet.waiting.tickets`.** `Fleet.issues` leaves out every ticket a plan names and stops at `ISSUE_LIMIT = 50`; `waiting.tickets` holds only the reader's selection and hides unassigned rows, and fleetd opens its findings with no assignee. Slice 1 built `planTicketRows` (open and closed rows, uncapped), `ticketPlans: Record<issueKey, TicketPlan[]>`, `waiting.unassignedKeys` / `assignedToOthersKeys` and the card's `refutedIssues`. This slice only reads them. Rejected: a client-side filter over `issues`, which drops a finding beyond row 50 and every delivered ticket.
- **Absence is not a state.** A delivered ticket that `planTicketRows` does not hold (closed before the 14-day window, or absent from an incomplete read) shows its key and its plan only. The row prints no "closed" word and no closed styling. A naive implementation treats "not in the open set" as closed; the unit case "delivered ticket `planTicketRows` does not hold" catches it. Same for the unread tracker: while `issueAnswer` is `failed`, `unsupported` or `unasked`, each chip shows the unread form, never `0`, and each group still shows the plans' key + plan rows (keys come from `Card.issues` and need no tracker).
- **The state cell is `ticketPhase` over the ONE `TicketPlan` of the row's plan,** from `ticketPlans`. `ticketPhase` over all plans of a ticket returns the least advanced plan's word, which would put one plan's tuple beside another plan's state when two scope plans name one ticket. The unit case with two scope plans in two states catches it. No `.tsx` file composes the word.
- **One row per (ticket, scope plan).** A plan outside the scope adds no row. In `my-sprint` scope the scope is the sprints `deliveryScope` returns; Mine narrows the groups and never widens them to plans in no active sprint.
- **A finding leaves the "no plan" group, and one owner does the arithmetic.** `scopeTickets`/`ticketsSection` owns all three adjusted counts, including the hidden sentence; `splitTicketRows` (`waiting-view.ts`) takes the finding keys with its own unit test. No filter in `AgentList.tsx`. `unassigned` becomes `unassignedKeys` minus the finding keys; `hidden` is both key lists minus the finding keys. A finding of a PR outside the scope stays in the "no plan" group and its count. Rejected: subtracting on the client from the counts alone, because it cannot know which key was counted.
- **Review findings match by title alone** (`findOpenReviewIssue(issues, pr)` over the domain `Issue[]`; `IssueRowSchema` has no labels). Do not add a label field to the row.
- **Mine modes.** `off` shows every row. `mine` is `mineOwnership` over the ticket arm and the plan arm. `strict` is `isMineStrict` over the ticket's assignees, for the scope groups and (per drift item 2) the "no plan" group. The plan of a finding is the plan of the PR's slice, or the plan whose `## Verification` names it. A key-only delivered ticket carries no assignees, so it is the reader's only through its plan. The unit cells in the plan (assigned to another / plan mine; assigned to me / plan another's; unassigned finding / plan mine; key-only / plan mine; each group over {release, my-sprint} × {off, mine, strict}) are the specification.
- **Both-kinds ticket.** A ticket that is both delivered and a finding uses `plan-named` for Create plan in Found too. A finding that is also unplanned shows only in Found.
- **⋯ items come from `scopeTickets`, not from the `.tsx`.** Three row kinds with the fixed items Open on host, Create plan, Create story, each with `enabled` and `reason`, through plan 5's `rowMenuOf`: delivered with a row; delivered key-only (Open on host enabled, Create plan disabled `plan-named`, Create story disabled "the board holds no row for this ticket"); found (plus a link to the PR or plan it was found on). `plan-named` is a new `PlanItReason` arm beside `planItReason`. `TicketHref` returns `undefined` with no address (`PlanTicketKeys.tsx`): pass the address per key into `scopeTickets` and disable Open on host with a reason when none resolves. A dead enabled link is the failure this catches.
- **Hints and empty groups.** Name each new group's empty hint as a `scopeTickets` output. An empty group stays visible as its label and "— none" (no hidden UI); a group that Mine empties reads "— none · N hidden by Mine". An incomplete read (`complete: false`) puts the grey line "The tracker read is incomplete; this list may miss tickets." under the rows, from the output field `incomplete: string | null`.
- **Unread notice keeps no Retry.** It shows the age of the last good rows through `issueNote` from `issueAgeSeconds`, and the failure alone where that field is `null`.
- **Folded summary chips.** The Tickets summary from plan 3 (`ticketsSection`) leaves a place for `◎ N delivered by the sprint` and `⚑ N found`: zero shows grey, an unread count shows the unread form. Plan 3 left the slot; build only the two chips.
- **When `ticketPlansOf` answers `null`** (`fleet.ts`), the server ships `ticketPlans: {}` with `issueAnswer: failed`. Check that slice 1 did this; if not, it is a one-line fix here.
- **Rules carried over:** absent is not false; a `null` tickets reading is "unread", not `0`; new words and decisions live in domain or view modules, never in `.tsx`. A view state that cannot be asserted without a browser is a property not yet extracted. New domain code is arrow functions with factual TSDoc (the board's old functions stay declarations; a function you only pass through stays as it is).

### Done when

The plan has no `## Done when` section; the *Approach* bullets of slice 2 and the *Board tests* bullet are the specification. Assertions that exist because a naive implementation would pass without them:

- Delivered ticket not in `planTicketRows`: key + plan, no "closed". Catches absence read as closed.
- Ticket named by two scope plans in two states: two rows, each with its own plan's `ticketPhase`. Catches `ticketPhase` over all plans.
- Unassigned review finding: not in `N more unassigned`, and in Found. A finding on a PR outside the scope: still in the "no plan" group and its count. Catches a client-side subtraction and a scope leak.
- Review finding beyond the 50-row inbox cut reaches Found. Catches a read over `Fleet.issues`.
- `my-sprint` scope with a plan outside the sprints `deliveryScope` returns: no row, whatever Mine says. Catches Mine widening the scope.
- Each unread state (`failed`, `unsupported`, `unasked`): chip in unread form, key + plan rows present, no `0`.
- `incomplete` sentence per group; Mine-emptied group reads "— none · N hidden by Mine".
- Key-only row: Create story disabled with its reason; Open on host disabled with a reason when no address resolves.
- `isRefutedIssueTitle` cases, a fleet payload built with no board build in the cache still keeps a `Refuted claim of …` row, and `COLLAPSED_BY_DEFAULT` pins the two new keys.
- Browser tests in `packages/board/test/integration/tickets-section.browser.test.ts`, served from a catalogue state in `packages/board/test/catalogue/index.ts` (no board started): one proves both groups render folded with their label and "— none" when empty; a second opens both groups and sees one row each. Raise `EXPECTED_TESTS` in `stubbed-tests-start-no-board.test.ts` by the `it(` count as a plain addition after you merge `main` (read the current value then; other slices move it) and leave `EXPECTED_FILES` unchanged unless you add a file.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a board changeset with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`), naming this plan on a `plan:` line inside the block. Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if that changes, `scripts/check-shell-lines.sh` refuses growth, so pay for it in the same change. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Record drift items 1 and 2 in the plan's Notes. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `scopeTickets` and `ticketIsMine` (new files under `packages/domain/src/rules/`, exported through the domain index), `isRefutedIssueTitle` in `verification.ts`, `planTicketRowsOf` in `packages/board/src/server/fleet.ts` (the one-line title keep only), `tickets-section.ts` (`plan-named` arm, counts), `splitTicketRows` in `waiting-view.ts`, `ticketsForReader` in `mine-filter.ts` (drift item 2 only), `collapse.ts`, `TicketsSection.tsx` and its render in `AgentList.tsx`, the Tickets summary chips, and the tests above.

Leave alone: `deliveryHeader`, `section-empty.ts`, the other sections' summaries and filters, and the payload fields slice 1 built beyond the fix in drift item 1.

In flight, to verify with `git branch -r` before you start: at dispatch only `feature/delivery-you-rows-verb-first` is a remote branch of the sprint (touches the You section rows). Expect conflicts, if any, in `AgentList.tsx` and the count gate; keep both sides.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
