## Implementation brief — a-plan-less-row-is-not-a-nameless-plan (slice: A row with no plan is not a plan)

- **Plan (canonical):** `docs/plans/2026-09-24-a-plan-less-row-is-not-a-nameless-plan.md` on `main`
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Issue:** #973
- **Branch:** `bug/a-row-with-no-plan-is-not-a-plan` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** PR

The plan has one slice. Nothing waits on this branch, and it waits on nothing. The sibling plan `the-fleet-sees-a-plan-on-its-own-branch` (#972, branch `bug/the-scan-reads-a-branch-s-own-plans`) makes this population smaller and does not fix this defect. See the scope guard.

**READ THE PLAN FIRST.** A panel amended it (`unanimous amend`). The first draft put the defect in the grouping key and offered three destinations. The panel moved the lever to the render site and the tally, and found that the estate already names the destination. Do not re-open either point.

### What to build

**The observed failure, Plot 2.20.0:** two pushed branches with no plan and no PR rendered as `NOT STARTED (1 plan · 2 slices)` under a `PLAN (2)` head with no name. The section hint is *"approved — nobody has taken it"*, and neither row has a phase.

There are three separate wrongs, and each has its own site on `main` today (line numbers verified 2026-09-24):

1. **Placement.** The rows come from the loose-branch loop in `packages/board/src/server/fleet.ts`. The loop builds each row with `plan: ''` and `phase: null` (`:7153`, `:7166`) and classifies it at `:7103` through `classify('wip', 'eligible', …)`. `classifyGroup` (`:4027`) returns `not-started` at the age gate, `:5033`, before it reaches the `abandoned` arm at `:5039-5086`. That arm already exists for this population.
2. **The nameless head.** `packages/board/src/app/components/AgentList.tsx:1301-1366`. In NOT STARTED (`countsPlans`), every group renders as a `PlanRow`, and no `Boolean(group.plan)` guard applies. `planHeads` and `showPlanHeading` (`sections.ts:371`) both apply that guard.
3. **The tally.** `sectionTally` in `packages/board/src/app/lib/agent-rows/sections.ts:415-440`. `countsPlans = section === 'not-started'`, so each group counts as 1. `groupByPlan` (`:195-200`) puts every `plan: ''` row into one group, so N branches count as one plan.

The plan's fix has three parts: (1) a row with no plan does not enter NOT STARTED, (2) plan-less rows are labelled *no plan* where they appear, and (3) a plan-less bucket is not a plan in the tally. The plan is canonical. This brief is orientation only.

### Settled decisions — do not re-derive them

**The destination is WAITING ON YOU as `abandoned`. It is not an open question.** `fleet.ts:5039-5046` names this population: real commits, no local activity, no open PR. The arm sends it to a person to revive or drop, and it routes through the domain: `quietNote` / `quietNeedsPerson` (`fleet.ts:5064`, `:5080` → `packages/domain/src/rules/quiet.ts:169`, `:202`). `plot-reconcile-scan.sh` section 19 (*"Unclaimed work … a person decides"*) gives the same answer independently. Do not add a new section, a new row kind, or a new rule. `RowKindSchema`'s docstring refuses a new kind on purpose (`fleet.ts:7139-7142`).

**The lever is the render site and the tally, not `groupByPlan`.** The draft named the grouping key, and the panel rejected it. Keying on `row.plan` is correct for real plans, and the plan says so explicitly under *What this does NOT do*. The model is `0de436190` (2026-08-16), *"a group with no plan has nothing to head, and no count to hide in"*. That commit applied the rule to the sibling arm and not to NOT STARTED.

**The tally needs no separate rule.** `sectionTally` reads the same predicates the component renders with, and its comment says so (*"read here so the count cannot disagree with the render"*). Change the render predicate and the tally predicate together, in the same shape. Do not add a second counting rule.

**Do not hide the rows.** A pushed branch that nobody planned is worth seeing. The defect is where it renders and how it is labelled, not whether it renders.

#### The plan's one open question: the age gate at `fleet.ts:5033`

The plan says this is the slice's first decision, and that the slice records the argument in the plan. This brief does not settle it. These are readings from `main` to start from:

- **`classifyGroup` cannot tell "no plan" from "unknown phase".** Its `planPhase` parameter defaults to `''`, and its docstring (`:4049-4061`) says that *"an unknown phase must answer exactly as before rather than guess"*. The loose-branch call passes `''` in that position. A condition inside `classifyGroup` keyed on `planPhase === ''` therefore also moves planned rows that reach it without a phase. That breaks the plan's fourth done-when: *a real plan's grouping is unchanged*.
- **Only the loose-branch loop knows that the row has no plan.** It builds the row with `plan: ''`. So the loop at `:7103-7115` is where the fact exists. The age gate in `classifyGroup` is shared with every planned `wip` branch, and its comment (*"WORKING IS ABOUT AGENTS … an agent may take it"*) is correct for those branches.
- **The gate's reason does not apply to a plan-less branch.** "An agent may take it" requires a plan to dispatch from, and a plan-less branch has none. The comment at `:7060-7064` still argues that a recent commit asks nothing of the reader. Answer that argument in the plan, and do not leave it silently contradicted.
- **The other plan-less paths do not reach NOT STARTED.** A plan-less branch with an open PR goes through `:6822`. A draft PR is `waiting-on-you`, and the open-PR arm (`:4439-4509`) returns only `waiting-on-you` or `waiting-on-machine`. `idea/*` branches carry `phase: 'Discovery'` (`:6882`) and are outside the subject. The loose-branch loop passes `localDirty=false, localAhead=0`, so the local-activity arms (`:5374-5393`) cannot fire for it. **So the population in NOT STARTED is the PR-less loose branch with a recent tip.** Confirm this with a test rather than by reading.

Whichever option you pick, write the decision and its reason into the plan's *Open Questions* entry, tick it, and commit that with the code.

#### Rules carried over

- **Absent is not false.** `phase: null` means "no plan to read", not "approved". `planPhase: ''` means "unknown", not "no plan". Do not conflate them in either direction.
- **The board client casts the fleet and does not parse it.** Zod defaults do not apply client-side. If you add a field to a row, the renderer receives `undefined` until the server emits it.
- **Every rendered state is a domain property** (CLAUDE.md, *The Layering Rule*). The placement already routes through `rules/quiet.ts`. Do not decide a section in `.tsx`.
- **New functions are arrows**, in board files and tests as well. Leave existing declarations as they are.

### Done when

The plan's `## Done when` list is the specification. These are the assertions that a naive fix passes without, and what each one catches:

- **Two plan-less rows, not one.** Build a fixture with **two** plan-less branches. A fixture with one plan-less branch passes even when the `''` group still exists, because a group of one never shows the merge. The plan's closing note says the live estate has zero such rows in NOT STARTED, so the fixture is the only reproduction.
- **A recent tip.** The fixture's `ageMinutes` must be at or below `quietMinutes`. An old tip already reaches the `abandoned` arm, and the test then passes before the change.
- **A real plan in the same fixture.** Add a real plan with two slices in NOT STARTED beside the plan-less rows, and assert that its head, its fold, and its tally contribution do not change. This is the regression the plan names.
- **`agent-list.test.ts:393-407` changes on purpose.** It pins *"keeps unplanned rows together under one nameless group"*. Its comment says that the renderer must not head that group. Decide whether the grouping stays (the plan says `groupByPlan` stays for real plans) and rewrite the test so that it asserts what now holds. Do not delete it.
- **The tally.** Add a `sectionTally` unit test (next to `:3828`) that asserts two plan-less branches never read as `1 plan`, in every section where they can now appear.
- **A browser test** on the two-branch fixture asserts that no `data-plan-group=""` head renders and that the section header matches the rows. Build the artifact first, because the browser tests load the built artifact and a stale one fails with a misleading result.

Plus the repo's gates:

```bash
nvm use                      # Node 24 — pnpm crashes on 26
pnpm install
pnpm test
pnpm run typecheck
pnpm run test:board          # rebuilds board-server.mjs and runs its tests
```

Do **not** run `pnpm run test:e2e`. It is CI's gate, not a local one.

Commit the rebuilt `skills/plot/scripts/board/board-server.mjs`. Add a changeset with `'@plot-pm/board': patch` (plus `'plot': patch` if you touch a skill or script), description first, and `plan: docs/plans/2026-09-24-a-plan-less-row-is-not-a-nameless-plan.md` in the trailing comment block.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work is still moving). Do not use `gh pr create`.
- When the PR exists, append `(Branch: bug/a-row-with-no-plan-is-not-a-plan, PR: #N)` inside the wave heading in the plan's `## Slices` section. A trailing `→ #N` on a heading-style plan does not parse.

### Scope guard

This branch owns:

- `packages/board/src/server/fleet.ts`: the loose-branch loop (`~:7060-7170`) and, only if the decision requires it, the age gate at `:5033`
- `packages/board/src/app/components/AgentList.tsx`: the NOT STARTED group render (`~:1301-1366`)
- `packages/board/src/app/lib/agent-rows/sections.ts`: `sectionTally`, and `groupByPlan` / `showPlanHeading` only as the render requires
- `packages/board/test/unit/agent-list.test.ts`, a new or extended test under `packages/board/test/integration/*.browser.test.ts`, and fleet classification tests
- the plan file (the open-question answer and the PR annotation), a changeset, and the rebuilt board artifact

It does **not** own `packages/domain/src/rules/quiet.ts`. The rule already answers this population correctly. If the fix seems to need a change there, report it and do not change it.

**Branches in flight, verified 2026-09-24:** no open PRs on the host. No remote branch that changed since 2026-09-20 touches `fleet.ts`, `sections.ts`, `AgentList.tsx`, `agent-list.test.ts` or `quiet.ts`. No local worktree has uncommitted changes to them. `bug/the-scan-reads-a-branch-s-own-plans` (#972) is approved and not started. It works in the scan's plan enumeration, not in section classification. If it lands first, fewer rows arrive here plan-less, and the fixture still reproduces the defect.

**Out of scope, by the plan's own list:** reshaping WAITING ON YOU (#967), fixing #972, and changing `groupByPlan` for real plans.

If you find something the plan did not anticipate, report it. Do not improvise outside this scope.
