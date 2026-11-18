## Implementation brief — delivery-fleet-rows-per-agent (wave 5: Header switches)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-fleet-header-switches` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last slice of plan 4 of the six-plan Delivery-tab design. It waits on `feature/delivery-fleet-time-tokens`, merged on `main` as PR #3516 (`d5a3957ef`). Nothing waits on it. Before you start, confirm the merge: `git log origin/main --oneline -- packages/domain/src/rules/agent-run-tokens.ts packages/board/src/server/agent-readings.ts` must list `d5a3957ef`, and `lastRunIndex` must exist in the first file; if not, stop and report.

### What to build

The Fleet section has its switch strip and its counts in a body row under the heading (`packages/board/src/app/components/AgentList.tsx`, the `section.key === 'fleet'` block, about `:1494-1511`): `WorkingCounts`, then `<span id="fleet-controls" data-fleet-control-column>` holding `AutoDispatchSwitch`, three `AutoSwitch` (review, verify, design) and `ParallelAgentsStepper`, then `FleetAlert`. The section heading (`<h2 data-delivery-section>`, about `:1445-1470`) already carries a counts summary (`section.summary`, `data-summary-count`) and an empty `<span data-section-controls className="ml-auto" />`, which plan 1's `feature/delivery-section-header` laid down for this slice. Measured on the running board on 2026-11-16: the switches sit in the section body and the heading has no tokens figure. This slice changes three things:

1. **Switches into the header.** Render the existing strip inside the Fleet heading's `data-section-controls` slot, so the header reads "<n> working · <n> blocked · <n> free · <tokens> output tokens today" with the dispatch, review, verify and design switches and the parallel-agents stepper right-aligned on the same line. Keep `id="fleet-controls"` on the element that wraps the strip: `scrollToAnchor('fleet-controls')` (the "held" links in group headings, about `:1549`) and the summary anchors resolve through it. Remove the strip from the section body. The body then holds no switch. `FleetControls.tsx` components are reused as they are; build no new switch. The tab-header Fleet card (plan 1, `feature/delivery-fleet-card`) renders the same components read-only; do not change that card.
2. **Counts asserted.** The three counts come from `agentGroup` groups through plan 1's summary. This slice adds a unit test that, over a fixture with design and verify runs as agents (they are, since `feature/delivery-fleet-plan-runs`), the working, blocked and free counts equal the number of agents in each group, and the three sum to the placed agents. It builds no second count.
3. **Output tokens today.** The header adds one figure: the output tokens of today's finished runs, labelled "output tokens today, finished runs". It aggregates the per-agent token fact the time-and-tokens slice built, over the same record (`.plot/state/slice-spend.jsonl`), and reads no transcript.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The switches live in the header and nowhere else.** The plan says so, and Done When asserts that the section body holds no switch. Leaving a copy in the body "for narrow screens" breaks it.

**The switches write through `/api/fleet-controls`, as they do today (`fleet-settings-store.ts`).** Done When says they write `.plot/state/`; the plan's panel replaced an earlier wording that said they write config keys through controllers. Do not add a controller call, a new endpoint or a new store.

**Tokens are output tokens only.** `packages/domain/src/rules/slice-tokens.ts` refuses a single summed figure, so the header sums `outputTokens` and nothing else, and the label says so. The other three counters (`inputTokens`, `cacheCreationTokens`, `cacheReadTokens`) go in the figure's tooltip, each on its own line, with no total. A header that adds the four is the defect that file was written to stop.

**Finished runs only, labelled as such.** A running agent has no output-token reading and no transcript is read (Jan Wloka, 2026-11-16). The figure misses running agents and runs ended at the bound; the label is how the header says so.

**`lastRunIndex` is not the figure.** It keeps one value per branch and role: the newest run. "Today" needs every finished run line dated today, so a day with two runs of one branch would count one. Add a second function beside it in `packages/domain/src/rules/agent-run-tokens.ts` that walks the same lines with the same rule (a run line's own figure is its cumulative counters minus the previous line of the same session, floored at zero by `nonNegativeDifference`; the first line of a session is its own figure; a seal line and an unparseable line add nothing) and sums the lines whose `at` (`slice-spend.ts`, `at: z.string().min(1)`) falls on today. Reuse `sumModels` and `nonNegativeDifference`; do not copy their arithmetic. A line whose `at` does not parse as a date counts for no day.

**One parse per `/api/fleet` build, one `stat` to decide it.** The time-and-tokens slice parses the record at most once per build and only when the record's stat changed (`packages/board/src/server/agent-readings.ts`, `lastRunCache`, `lastRunsFor`, over `stat-cache.ts`). The today figure takes the lines from that same cached parse. Do not add a second read of the record, and do not parse it in the client. Measured: `lines()` in `board.ts` re-parses the whole record on every call, and `/api/fleet` polls every 4 s per viewer; a second parse doubles the cost the plan bounds.

**The day boundary is the board's local day.** The plan names no zone. Use the server's local date, pass "now" and the boundary in as readings so the rule stays pure, and say in the figure's tooltip which day it covers. A builder's call within the domain's rules, recorded in the PR body.

**An absent reading is not zero.** A missing or unparseable record gives `null` and the header shows "—" for the figure, not "0 output tokens today". A readable record with no run line today gives 0. This is the rule the estate keeps relearning (absent is not false), and the tests below pin it.

**The header is a domain fact.** The count line, the figure's text, its tooltip and its "—" case are built in the domain and unit-tested; the component prints them. Measured: 42 of this repo's 43 browser tests came to start a full board server because a decision lived in a `.tsx`.

**Fleet stays unscoped.** The **My sprint** toggle does not change the header, the counts or the figure.

### Done when

The plan's Done When item for this slice is the specification: the header shows the working, blocked and free counts and today's finished-run output tokens; the switches and the stepper show in the Fleet header's controls slot and write `.plot/state/` through `/api/fleet-controls`, as they do today; the section body holds no switch; and the `#fleet-controls` anchor still exists.

Lift these assertions, because a naive implementation passes without them:

- Two finished runs of one branch today, plus one run yesterday, give the sum of the two today runs' output tokens and nothing from yesterday. This catches a figure built from `lastRunIndex`, which holds one run per branch.
- A session whose cumulative counters rise across two run lines counts the difference once, not the cumulative figure twice. This catches a sum over raw counters.
- A fixture where `cacheReadTokens` is far larger than `outputTokens` gives a figure equal to `outputTokens`, with the other counters in the tooltip. This catches a summed total.
- An unreadable record shows "—"; a readable record with no run today shows 0. This catches `null` rendered as zero.
- Counts: a fixture with three working, one blocked and two free agents, including a design run and a verify run, gives "3 working · 1 blocked · 2 free"; an agent with an unread process is in none of the three. This catches a count taken from the rows or from the agents in `unplaced`.
- The Fleet section body contains no element matching a switch or the stepper, and exactly one element has `id="fleet-controls"`, inside the Fleet heading. This catches a strip copied into the header and left in the body, and a lost anchor.
- `scrollToAnchor('fleet-controls')` from a group's "held" link still reaches the strip. This catches an anchor moved to an element the scroll cannot find.
- Toggling a header switch posts to `/api/fleet-controls` with the same body as before the move. This catches a rewired switch.
- The Fleet card on the tab header still renders the same components read-only. This catches a change to a component that both places share.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. `pnpm run typecheck` does not cover `packages/domain`: run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` for any domain file you change. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Never run board tests while an operator's board is open on this machine. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md` line inside the comment block; `scripts/check-changeset-packages.sh` checks the order and the package name. The slice changes no skill, so the changeset names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. Any function you write is an arrow, and `packages/domain` takes TSDoc that states what an export does and returns, not the history of the decision; leave neighbouring declarations alone.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. This is the plan's last slice: when it merges, `/plot-deliver delivery-fleet-rows-per-agent` closes the plan.

### Scope guard

This branch owns the Fleet heading and the Fleet body block in `packages/board/src/app/components/AgentList.tsx`, the strip's placement (not the components) from `FleetControls.tsx`, the header figure and its tooltip in `packages/domain/src/rules/agent-run-tokens.ts` and the rule that builds the header line, the plumbing of the cached spend parse into the payload (`packages/board/src/server/agent-readings.ts`, `fleet.ts`, `packages/board/src/contract/schema.ts`), and the tests that select the Fleet header or the strip.

It does not own Time left, Tokens cells or the `Worker bound` read (`feature/delivery-fleet-time-tokens`, merged), the groups, Acting on, Doing now or Waits on (`feature/delivery-fleet-agent-rows`, merged), roles (`feature/delivery-agent-roles`, merged), design and verify runs (`feature/delivery-fleet-plan-runs`, merged), the section-header pattern and the summary's counts (plan 1, `feature/delivery-section-header`), the tab-header Fleet card (`feature/delivery-fleet-card`), `ROW_COLUMNS`, the item rows, or the Tickets, Machine and footer sections. Measured at dispatch on 2026-11-18, `git ls-remote --heads origin 'feature/delivery-*'` lists `feature/delivery-slice-states`, `feature/delivery-tab-footer`, `feature/delivery-work-items-progress` and `feature/delivery-you-loose-prs`: `feature/delivery-tab-footer` and the work-items and You slices edit other sections of `AgentList.tsx`, not Fleet, and `feature/delivery-slice-states` may touch `delivery-placement.ts`. Verify it, do not assume, and report a collision with `AgentList.tsx`, `fleet.ts` or `schema.ts` rather than resolving it by guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
