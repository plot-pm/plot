## Implementation brief — a-planned-ticket-shows-its-plan

- **Plan (canonical):** `docs/plans/2026-10-18-a-planned-ticket-shows-its-plan.md` on `main`
- **Approved:** 2026-10-18, Jan Wloka, plan-PR #2023 merged
- **Branch:** `bug/planned-ticket-phase` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention — PR review on GitHub

Sole slice of a single-wave plan. Nothing waits on it and it waits on nothing.

### What to build

A ticket in *Assigned to you* (the *Waiting on you* tickets list) shows the plan's phase in its status column instead of the tracker's `open`. The phase is a domain property computed from the plans that name the ticket through `Issue:`; the row component decides nothing.

The failure it fixes, measured 2026-10-18: 10 tickets under *Assigned to you*, 9 of them named by a plan (4 Approved with slices in flight, 5 Delivered), and all 10 read `open`. `waitingOf` (`packages/board/src/server/fleet.ts:1824`) drops planned rows through its `unplanned` filter (PR #1992), so a planned ticket then vanishes from the list and its progress is visible nowhere. The slice reverses that filter for *Waiting on you* only.

Pieces, in order:

1. `ticketPhase` in `packages/domain/src/rules/ticket-phase.ts` (new). Input: the plans naming one ticket (state, merged slice count, total slice count). Output: the label and an order key, or `null` when no plan names the ticket. Label table is in the plan. Two plans: the lowest `phaseOrder` (`entities/workflow.ts:57`) wins.
2. `waitingTickets` (`rules/waiting-tickets.ts`) takes a map from issue key to plans instead of a pre-filtered `rows`. It sets `WaitingTicket.status` to the phase word for a planned ticket and sorts unplanned first, then planned, each group newest first. No new field on the wire shape for the component: the existing status cell renders `status`.
3. Board: a sibling of `referencedIssues` (`fleet.ts:1483`) that returns each ticket's plans with state and slice counts, read through the `planMeta` call it already makes (`meta.issues`, `meta.phase`, `meta.waves`). `waitingOf` stops filtering and passes the map. Both callers (`fleet.ts:1994`, `:2109`) change.
4. Board artifact: the wire shape changes, so run `pnpm build:board` to test locally, then restore generated paths before pushing (`CLAUDE.md`, *On a conflict in board-server.mjs*; `scripts/check-no-bundle-diff.sh`).

Domain code is arrow functions with factual TSDoc only (`CLAUDE.md`, *The Domain Package*). The history goes in the commit message.

### The decisions the plan settles — do not re-derive them

**Read git, never a label.** The phase comes from the plan file's `State:` and its slices' merged PRs. No `plan:*` label is read: labels stay a one-way reflection (`entities/issue.ts:21-29`, `MANIFESTO.md:17`). Reading them would make a stale label a source of truth.

**`inboxOf` (`fleet.ts:1774`) keeps filtering by `referenced`.** The *Inbox* lists unplanned issues only. Only *Waiting on you* changes; a test must pin that the Inbox is unchanged.

**No second host call for the slice count.** Use the merged-PR reading the fleet already makes for the plan row (`entry.prs`). A plan whose reading is missing shows `in progress` with no count, never `0/0`. An absent reading is not a zero.

**A ticket named by no plan keeps the tracker state** (`open`) and sorts above the planned tickets.

### Open questions the plan leaves — settle them before you write code

The plan carries four unchecked questions. The plan is approved, so each has an assumption in its text. Take it unless you find evidence against it, record the choice in the PR body, and do not stop the slice for an answer:

- **Slice-count source.** Name it first. The candidates are the pulse bridged to `.plot/state/last-pulse.json` and the plan row's own tally. Prefer whichever the board already computes for the plan row, because a second tally can disagree with the row beside it. Say which you used.
- **Approved with no slice started.** Plan assumes `in progress` (so `in progress 0/N` when the reading exists).
- **Released plan.** Plan assumes a ticket named only by Released plans shows `released`.
- **Jira.** Plan asks whether the phase replaces Jira's own state. Scope to what the plan states for GitHub; if Jira tickets reach this path, keep the tracker state for them and report that as a finding rather than choosing silently.

### Done when

The plan has no `## Done when` section; the Changelog entry is the specification: `planning`, `design`, `in progress 3/6` and `delivered` appear in the status column; two plans give the less advanced phase; an unnamed ticket keeps the tracker state and sorts first.

Assertions that exist because a naive implementation would pass without them:

- A ticket named by a Draft plan still in an open plan PR reads `planning` — catches reading only plan files on the default branch.
- Two plans (Approved and Delivered) show `in progress`, not `delivered` — catches taking the last or the highest phase.
- A ticket with a missing merged-PR reading shows `in progress` with no `0/0` — catches treating absent as zero.
- The *Inbox* still omits a planned issue — catches the `waitingOf` change leaking into `inboxOf`.
- Unplanned rows sort ahead of planned rows even when a planned row is newer — catches sorting by age alone.
- One browser-free unit test per label, in `packages/domain/test/`. If the client needs a test at all, one test that the cell shows `status` (CLAUDE.md: a view state that needs a browser to assert is a domain property not yet extracted).

Plus: a changeset for `@plot-pm/board` (description first, `bumps:` block last; `./scripts/check-changeset-packages.sh`). For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Do not run `test:board` while the operator's board is open (it takes the board down).

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, remove shell elsewhere in the same change, or write the rule in the domain.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`). When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/ticket-phase.ts` (new), `packages/domain/src/rules/waiting-tickets.ts`, `packages/domain/test/`, the `waitingOf`/`referencedIssues` area of `packages/board/src/server/fleet.ts`, and the contract in `packages/board/src/contract/schema.ts` only if the wire shape needs it. Make no change to the plan format, the template, the helper scripts or `issues.json` (the plan's Board impact note). No other branch of this plan is in flight. `.plot/briefs/the-ending-ask-record-stays-bounded.md` is another plan's untracked brief: leave it alone.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
