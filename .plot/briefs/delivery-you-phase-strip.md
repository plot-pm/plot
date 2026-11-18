## Implementation brief — delivery-you-blocks-or-feeds (wave 4: Phase strip)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-you-phase-strip` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the fourth of five slices. It waits on `feature/delivery-you-plan-rows`, which has merged (#3520), and so on `-loose-prs` (#3511) and `-groups` (#3500). One slice waits on this one: `-person-comment`. Slices run in heading order so that no two edit `AgentList.tsx` at once.

### What to build

The You header names no count of its own today. The section header's `summary` line prints one count per group (`Blocks delivery 3`, `Input to the fleet 1`, `Unblock 2`: `summarise` in `packages/board/src/app/lib/agent-rows/delivery-view.ts`), and no line counts the reader's tickets or shows where their work sits in the workflow. Measured on the running board on 2026-11-16: 30 ticket rows pushed the draft plans that need the developer out of view, and the Tickets section now holds those rows, so You needs only a count that links there.

This slice changes two things in the You header:

1. **Counts.** The header reads "<n> block delivery · <n> inputs the fleet waits for · <n> to clean up · <n> tickets to triage". Each group count links to its group (`groupAnchor`), and the ticket count links to the Tickets section (`TICKETS_ANCHOR` in `TicketsSection.tsx`). The words "to clean up" are Jan Wloka's decision of 2026-11-16 and match the Unblock marker's `words`.
2. **Phase strip.** A strip in the header, named from the `Workflow phases` config key: `Discovery n ─▶ Design n ─▶ Development n` in this repository. Each count links to its items. The strip names three phases:
   - the phase that holds `story:*`, which counts the reader's tickets with no plan and the stories no plan answers;
   - the phase that holds `plan:draft` and `plan:design`, which counts the reader's plans in Draft or Design;
   - the phase that holds `plan:approved`, which counts the reader's approved plans.

   It reads the board payload the client already polls and adds no fetch and no route.

Where the code is now. Re-read before you edit, because line numbers drift:

- `packages/domain/src/rules/workflow-phases.ts`: `PhaseMap`, `DEFAULT_PHASE_MAP`, `parsePhaseMap`, `phaseColumns`, `phaseOfPlan`. The server parses the key in `packages/board/src/server/board.ts` (around `:1631`) and a refused value falls back to the default map with `Board.phaseMapRefusal` set.
- `packages/board/src/contract/schema.ts`: `Board.storyLanes` (`:1591`) and `phaseMapRefusal` (`:1519`). Check whether the parsed map reaches the client. If it does not, name the smallest addition to the existing payload and say so in the PR. A new fetch or route is out of scope.
- `packages/domain/src/rules/ticket-lanes.ts` (`ticketLanes`, `:185`) and `splitTicketRows` for the ticket reading.
- `packages/board/src/app/components/AgentList.tsx`: the section heading with `data-section-summary` and `data-summary-link`. `section.summary` and `SectionCount` are the pattern to extend.
- `packages/board/src/app/lib/agent-rows/delivery-view.ts`: `summarise`, `SectionCount`, `groupAnchor`.

The plan is canonical. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The strip names its phases from the phase map, never from literals.** A strip with `Discovery`, `Design` and `Development` typed in would show the wrong names in a repository whose `Workflow phases` key renames them, and would show the default names where the map is refused. The names come from `DEFAULT_PHASE_MAP` or the parsed map. A phase map that names no phase for a member shows that count with no name.

**The strip counts the reader's items, and "the reader's" is the You rule.** An item counts where its ownership is not `'theirs'`, in every Mine mode. This is the rule the groups slice settled: a loose branch with `'unknown'` ownership, and every PR where the host login is not read, would vanish if the strip required `'mine'`. Do not write a second ownership test; use the one `delivery-placement.ts` exports.

**The counts are domain properties.** Every header count, strip count and link target is computed in `packages/domain` and unit tested. The component renders the answer and decides nothing. This holds the repo's rule that a view state which cannot be asserted without a browser is a domain property not yet extracted.

**The ticket count links to a section that exists.** The groups slice waited on `feature/delivery-tickets-section` for this reason, and `TICKETS_ANCHOR` is on `main`. Where the Tickets section renders no body (issue answer `failed` or `unsupported`), the count has no number to give: show the absence, not `0`. Absent is not zero.

**A group with no rows keeps its count of 0 and links nowhere**, because its heading and body are not rendered (`summarise` already does this). A strip phase with a count of 0 links nowhere for the same reason.

**No new fetch and no new route.** The strip reads the payload the client polls. The design owns this decision and the plan repeats it.

### Done when

The plan's Done When item for this slice is the specification: the You header counts each group, "to clean up" and the tickets to triage, each count linking to its target; the phase strip names its phases from the phase map and counts each, asserted in a unit test with this repository's map and with the default map.

Lift these assertions, because a naive implementation passes without them:

- **A unit test with this repository's map** (`Discovery = story:*; Design = plan:draft, plan:design; Development = plan:approved`, plus Testing and Released) reads `Discovery n ─▶ Design n ─▶ Development n`, and **one with a renamed map** reads the renamed names. This catches names typed as literals.
- **A unit test with the default map** gives the same three phases. This catches a rule that works only where the key is declared.
- **A map that names no phase for a member** shows that count with no name. This catches a crash or a dropped count.
- **The ticket count with the issue answer `failed`** shows the absence and not `0`. This catches absent standing for zero.
- **An item whose ownership is `'unknown'` counts in the strip and in the group count; an item whose ownership is `'theirs'` counts in neither.** This catches a `'mine'`-only test.
- **Each count's link target exists:** a group count with rows links to `groupAnchor(key)`, one without links nowhere, and the ticket count links to `TICKETS_ANCHOR`.
- One browser test shows the header line and the strip with a link scrolling to its target. Unit tests prove the counts, and the browser test proves the header renders from them.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. Run `pnpm build:board` only to look at the result, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Look at the rendered You header in both themes and at 320 px, where the counts and the strip wrap. Add a changeset for the package `@plot-pm/board`, with the description first (at least 20 characters), then the `plan: docs/plans/2026-11-16-delivery-you-blocks-or-feeds.md` line inside the comment block, with no `bumps:` entry, because this slice changes no skill. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. If you need one, pay for the growth in the same change. A function you write is an arrow, and the unit is the function: leave neighbouring declarations alone.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the You header counts, the phase strip, their domain rules, and their unit and browser tests.

It does not own: the You groups and markers (merged), the closed-PR reading and loose buttons (merged), the one-row plan form, open-question rule and column set (merged), or `personComment` and `PR_INDEX_VERSION` (`-person-comment`). Do not change `plot-plan-meta.sh`. Do not add a fetch or a route.

In flight, diffed against `origin/main` at brief time: `feature/delivery-slice-states` touches `delivery-view.ts` and `delivery-placement.ts`, and `feature/delivery-tab-footer` touches `AgentList.tsx`. Both are other plans' slices. Run `git diff --name-only origin/main...origin/<branch>` again at dispatch before you edit those files, and expect a textual merge rather than a semantic one: `summarise` and the You group tables are the likely overlap with `delivery-slice-states`, which reads the case and marker the groups slice exported.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
