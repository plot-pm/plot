## Implementation brief — a-long-ticket-title-hides-the (wave 1: Fix)

- **Plan (canonical):** `docs/plans/2026-10-17-a-long-ticket-title-hides-the.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1975 merged
- **Branch:** `bug/a-long-ticket-title-hides-the` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

The plan has one wave and one branch. Nothing waits on it and it waits on nothing.

### What to build

Issue #1960, observed 2026-10-17 on the operator's board (built from `cd44b52a9`), *Waiting on you* with 9 tickets assigned to the reader. Two defects:

1. **The title takes the plan name's width.** Rows for #1849, #1848 and #1830 show the plan slug (`jira-inbox-and-iss…`, `bitbucket-…`, `r…`). Six rows (#1952, #1951, #1950, #1867, #1856, #1837) show only the plan icon, and they are the rows with the longest titles. A fix is right only if those six rows show a readable plan name beside a title long enough to overflow.
2. **The `Assigned to you · 9` sub-header does not render.** `/api/fleet` returns `waiting: {shown: 9, hidden: 22, complete: true, notice: null, source: {service: github, match: host-login}}`, and the served bundle contains the `data-waiting-heading` row. The screenshot shows the `22 open tickets are not assigned to you` control row and no heading above the ticket rows.

Where the code stands on `main` today (verified 2026-10-17 after fast-forward; line numbers moved by 2 from the plan's):

- The heading renders at `packages/board/src/app/components/AgentList.tsx:2466` under `key === 'waiting-on-you' && fleet.issueAnswer === 'answered' && issues.length > 0`, with its text from `waitingBlock.heading` (`:2472`).
- `issues` is `filteredIssues` (`:1156`), which is `waitingBlock.tickets` (`:700`). `waitingBlock` is `waitingView(fleet.waiting, fleet.issues, showEveryTicket, (tickets) => ticketsForReader(tickets, reader, fleet.waiting?.source ?? null, mineOnly))` (`:697`).
- The rows come from `issues.map(...)` into `IssueRowView` (`:2513`), defined at `packages/board/src/app/lib/agent-rows/rows.tsx:2749`. The row's grid is `TupleRowView` over `tupleFromIssue`; the title and plan-name columns are decided there and in the `beside` slot, not in `AgentList.tsx`.
- The domain side is `packages/board/src/app/lib/agent-rows/waiting-view.ts:74` (`waitingView`). Existing tests: `packages/board/test/unit/waiting-view.test.ts`, `packages/domain/test/waiting-tickets.test.ts`, `packages/domain/test/waiting.test.ts`, `packages/board/test/integration/question-renders-waiting-on-you.browser.test.ts`.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**Trace the heading before changing code.** The plan does not name the cause. The condition and the rendered rows both read `issues`, so a plain count mismatch inside one render is not possible. Candidates that survive reading the code: `waitingBlock.heading` is an empty string for this payload (the cell renders but shows nothing, so the row exists and looks absent); a sort or grouping upstream moves the `<li data-waiting-heading>` out of view; or the `cd44b52a9` bundle predates the heading commit (#1879) and the served-bundle check in the plan was against a newer build. Reproduce with the payload quoted above first; the board does not reload its bundle, so verify the served page and not the file.

**The fix for the heading goes in the domain if the cause is a value.** *Every rendered state is a domain property* (CLAUDE.md, The Layering Rule): a heading that is wrong or empty is a `waitingView` value, asserted in a unit test. A browser test then proves the heading is seen, not that it is decided.

**The title truncates, the plan name does not.** Title: `min-w-0` and `truncate`. Plan name: a fixed minimum width and `shrink-0`, keeping its own truncation for slugs longer than that minimum. The reverse (shrinking the plan name) is the present behaviour and is the defect.

**The minimum width is an open question the implementer answers.** Measure it on the narrowest supported board width and record the number in the commit message, so `git log -S` finds it. A guess here reads as preference and gets re-litigated.

**Arrow functions.** Any function you write or rewrite is an arrow, in the board too (CLAUDE.md, The Domain Package). Do not convert neighbouring declarations.

### Done when

The plan's `## Done when` is not a separate section; its `### Approach` step 4 is the specification: one browser test feeds the production payload above and asserts the sub-header text `Assigned to you · 9` and a visible plan name on a row whose title is long enough to overflow. Assertions that exist because a naive implementation passes without them:

- **The overflowing row must be one of the six that lost its name.** A fixture with short titles passes with or without the fix. Use a title long enough to overflow at the narrowest width; the assertion catches a fix that only works on short titles.
- **Assert the plan name's rendered text and its visibility, not its presence in the DOM.** The six broken rows have the element and no readable text; a presence check passes on the bug.
- **Assert the heading against the unit-tested domain value.** The unit test fixes the heading string for `{shown: 9, hidden: 22, complete: true}`; the browser test proves the same string is on screen. If the cause was in the domain, the unit test must fail before the fix.
- **Verify a failing test by reverting your source in place**, then restore from git, not from your own copy.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `test:e2e` locally. Board browser tests start a board server: do not run them while the operator's board is open on the same ports.

The slice touches `packages/board` only. If it touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base, so growth is paid for in the same change. No `.sh` change is expected.

A changeset is required: package `@plot-pm/board`, description first, `bumps:` block last, with `plan: docs/plans/2026-10-17-a-long-ticket-title-hides-the.md` in the same block. Run `./scripts/check-changeset-packages.sh` locally. Do not commit a rebuilt `board-server.mjs`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/app/components/AgentList.tsx`, `packages/board/src/app/lib/agent-rows/` (`rows.tsx`, `waiting-view.ts`), the matching tests under `packages/board/test/` and `packages/domain/test/`, and one changeset. The domain's waiting rules (`packages/domain/src`) only if the heading cause is a domain value.

Other branches in flight on the same files: `a-planned-issue-shows-its-plan` (approved 2026-10-17, commit `6a2d88652`) shows a planned issue's plan state and link on the same ticket row. It likely touches `IssueRowView` and `tupleFromIssue`. Check `git log origin/main -- packages/board/src/app/lib/agent-rows/rows.tsx` and `/plot-pulse` before editing the row, and rebase rather than merge if it lands first.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
