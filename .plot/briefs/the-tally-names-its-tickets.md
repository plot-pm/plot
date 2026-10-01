## Implementation brief — waiting-on-you-counts-tickets-as-tickets (wave 1: The tally names its tickets)

- **Plan (canonical):** `docs/plans/2026-10-01-waiting-on-you-counts-tickets-as-tickets.md` on `main`
- **Issue:** #1146
- **Approved:** 2026-10-01, jwloka, in-session
- **Branch:** `bug/the-tally-names-its-tickets` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention (PR review, CI green)

One slice; nothing waits on it.

### What to build

1. **`sectionTally` counts each kind under its own name.** Its fourth argument becomes `{ tickets, drafts, agents }` instead of one number. It returns `{ plans, slices, branches, tickets, agents }`: `plans` = top-level lines of groups that carry a plan (today's `planLines`) plus `drafts`; `slices` = lines reached by expanding those heads (today's `sliceLines`), for plan-carrying groups only; `branches` = rows of the plan-less group (`plan === ''`); `tickets` and `agents` = their counts.
2. **`tallyLabel(tally)`** in `sections.ts`, a pure arrow function returning the header text: only plan lines with `plans === slices` gives `(N)` as today (`QUIET (0)` stays `(0)`); otherwise each non-zero figure with its unit, in the order plans, slices, branches, tickets, stopped agents, singular at 1; **the slice figure prints only where it differs from the plan figure**; a section with no plan lines prints its one kind with its unit (`(15 tickets)`, `(1 stopped agent)`, `(2 branches)`).
3. **`unfilteredNote({ tickets, drafts, agents }, filterActive)`**: ` · tickets, draft plans and stopped agents are not sprint-filtered`, naming only the kinds present; an empty string when the filter is off or none is present. `data-sprint-unfiltered` keeps its number.
4. **The call site** (`AgentList.tsx:1157-1165`) passes `{ tickets: issues.length, drafts: drafts.length, agents: broken.length }` and renders `tallyLabel(tallyOf)`; the suffix at `:1178-1183` renders `unfilteredNote`. WORKING keeps its single agent count.
5. **The doc comment** at `sections.ts:410-412` states the invariant (collapsed visible lines equal `plans + branches + tickets + agents`) instead of "count toward BOTH figures".

### The sites, verified on `origin/main` 2026-10-01

| Site | Line | What is there |
|---|---|---|
| `packages/board/src/app/lib/agent-rows/sections.ts` | 410-412 | the "count toward BOTH figures" paragraph |
| `sections.ts` | 422 | `export function sectionTally(` |
| `AgentList.tsx` | 467 | `brokenRows` |
| `AgentList.tsx` | 1033 | `countOf` |
| `AgentList.tsx` | 1157-1165 | the `sectionTally(rows, key, slices, issues.length + drafts.length)` call and the label |
| `AgentList.tsx` | 1178 | `unfilteredCount` |
| `AgentList.tsx` | 1186 | `countOf + issues.length > 0 ? shownLabel : emptyHint` |
| `AgentList.tsx` | 1277 | the heading button's `flex items-center gap-2` |
| `test/unit/agent-list.test.ts` | 411, 3855, 3864, 3881, 3898, 3920, 3927, 3929 | the eight call sites passing a number (`:3887` is the title of *folds issue rows into the visible count*, asserted at `:3898`) |
| `test/integration/a-plan-less-row-is-not-a-plan.browser.test.ts` | 108 | asserts `(3 plans · 4 slices)` |
| `test/integration/unplanned-issues.browser.test.ts` | 328 | *counts issue rows in the section tally* |
| `test/integration/sprint-exempt.browser.test.ts` | 214-218 | survives unchanged |

### Tests (from the plan)

Unit tests in `agent-list.test.ts`, each asserting the label string: `(3 plans · 6 slices · 15 tickets)`; `(15 tickets)`; `(1 stopped agent)`; `(1 branch · 2 tickets)`; NOT STARTED with one plan head over two slices plus two plan-less rows: `(1 plan · 2 slices · 2 branches)`; `(2 plans · 1 ticket)`; a draft plan with no branch adds to plans, not slices; QUIET `(0)`; an ungrouped section with equal plans and slices and nothing else: `(N)`; `unfilteredNote` off when the filter is off, names only present kinds, carries no number.

Rewritten: the eight unit call sites above (line 411 asserts `.branches` 2 and `.plans` 0 for the plan-less bucket; line 3898 asserts the named figures); `unplanned-issues.browser.test.ts:328` asserts `(1 branch · 2 tickets)` and **the invariant against the rendered section**: it counts the section's rendered top-level rows (one branch row, two ticket rows) and asserts the count equals the sum of the header's figures, 1 + 2 = 3; `a-plan-less-row-is-not-a-plan.browser.test.ts:108` asserts `(1 plan · 2 slices · 2 branches)`.

Unchanged: `sprint-exempt.browser.test.ts:214-218`. **`EXPECTED_TESTS` stays at its `main` value**: the invariant is an assertion inside an existing test, not a new test.

### Panel caveats a worker trips on

- **Do not write the invariant as a unit test.** A unit test has only `sectionTally`'s own line count to compare with, which compares the function with itself (round 2). It belongs in the browser test, counted from rendered rows.
- **DONE and QUIET change too**: `sectionTally` serves every branch section, so a plan-less merged PR row in DONE now reads under `branches`. On this estate at `34200acb` DONE and QUIET held no rows, so their headers read `(0)` before and after.
- **A section of only a stopped agent** printed `(0)` above one row today (read from code, not reproduced); after this slice it prints `(1 stopped agent)`.
- **Browser tests load the built artifact.** Run `pnpm build:board` first.

### Done when

`tallyLabel`, `sectionTally` and `unfilteredNote` are unit-tested for the cases above; a board with 3 plans, 6 slices and 15 tickets reads `(3 plans · 6 slices · 15 tickets)`; no header counts a ticket, a stopped agent or a plan-less branch as a plan or a slice; with the filter on, the note carries no number; the rewritten browser test asserts the invariant; `pnpm run test:board` and `pnpm run typecheck` pass and `EXPECTED_TESTS` is unchanged.

### Gates

`nvm use` (Node 24), then `pnpm build:board`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`. **Do not run `pnpm run test:e2e`.**

### Rules that bite this slice

- "Every rendered state is a domain property": the wording is decided in `tallyLabel`, never in `.tsx`.
- New functions are arrow functions; rewriting `sectionTally`'s body makes it yours, so it becomes an arrow too.
- A `'@plot-pm/board': patch` changeset, description first.
- Rebuild `skills/plot/scripts/board/board-server.mjs` and commit it; on a conflict in it, take either side and rebuild.
- Never touch the running boards on :7777.
- Use `trash`, never `rm`. Never `git stash`.

### Bookkeeping

- The claim ref `bug/the-tally-names-its-tickets` exists on `origin` at `origin/main` (pushed 2026-10-01). Fetch it; do not recreate it. Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work still moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to the slice heading's annotation in the plan, in the heading form `(Branch: bug/the-tally-names-its-tickets, PR: #<number>)`. Commit that edit on `main` through a detached scratch worktree, not the shared main checkout.

### Scope guard

This branch owns `packages/board/src/app/lib/agent-rows/sections.ts`, the tally call site and suffix in `packages/board/src/app/components/AgentList.tsx` (`:1157-1187`), the eight `sectionTally` call sites in `test/unit/agent-list.test.ts`, `test/integration/unplanned-issues.browser.test.ts:328`, `test/integration/a-plan-less-row-is-not-a-plan.browser.test.ts:108`, a changeset, and the rebuilt `board-server.mjs`.

Branches in flight, verified against `origin` on 2026-10-01:

- **`bug/a-closed-sprint-stops-filtering`** (claimed, no commits yet) rewrites the `sprintFilter` reads in `AgentList.tsx`, **including `unfilteredCount` at `:1178`**, the line this slice replaces with `unfilteredNote`. Whichever merges second rebases: keep that branch's derived selection as the `filterActive` input to `unfilteredNote`, and keep this branch's note wording. It also raises `EXPECTED_TESTS` to 538; this slice adds no test, so take whatever value `main` holds after the rebase.
- **`bug/the-merge-subject-is-one-rule`** touches none of these files.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
