## Implementation brief — delivery-fleet-rows-per-agent (wave 2: Plan runs)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-fleet-plan-runs` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the second slice of plan 4 of the six-plan Delivery-tab design. It waits on `feature/delivery-agent-roles` and `feature/delivery-tickets-section`; both are merged on `main` (`3c0d103cf`, `00476e3fe`). `feature/delivery-fleet-agent-rows` waits on this slice. Before you start, confirm both with `git log origin/main --oneline -- packages/domain/src/rules/agent-roles.ts packages/board/src/app/components/AgentList.tsx`; if `agent-roles.ts` is absent, stop and report.

### What to build

Design and verify runs show twice on `main` today. The role slice (`roleRuns`, `packages/domain/src/rules/agent-roles.ts:67`) already puts each running design or verify plan on the Fleet as an agent with its role chip (`id: agent:design:<plan>` or `agent:verify:<plan>`, rendered by `RoleRunRow.tsx`). The old rows also stay: the trailing "Plan runs" section of `AgentList.tsx` (`{(workingPlanRows.length > 0 || … ) && (<section …><h2>Plan runs</h2>`, about `:1544-1562`, its comment reads "until plan 4 moves them") renders a `PlanLevelRowView` per run from `verificationRows` and `specRows`. This slice removes those run rows, so each run shows once, in Fleet, with its role.

The plan names the block "Tickets and plan runs" and cites `AgentList.tsx:1499-1506`. Plan 6's slice has since split tickets into their own section, so what remains is the "Plan runs" section above. Measured on `main` at dispatch; re-read the file, because the line numbers move.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**The edit to this section belongs to this slice and to no other.** That is why the slice waits on `feature/delivery-tickets-section`: both edit the same region of `AgentList.tsx`, and the plan orders them rather than leaving a merge conflict. Do not touch the Tickets section.

**Design and verify keep a `null` start time.** `roleRuns` gives them none, because the payload (`DesignStatusSchema`, `VerificationStatusSchema`) carries none. Do not invent one from a log or a pid. The time-left slice shows "—" for `null`.

**No role gains a host read, and the Fleet agent row form is not changed here.** `agentRowCells` and the columns belong to `feature/delivery-fleet-agent-rows`. This slice moves rows between sections and changes no cell.

**Rules carried over from related work.** An absent reading is not an empty one: a `null` `fleet.design` or `fleet.verification` (file unreadable) yields no run and no banner, as `verificationRows` and `specRows` answer today. Read the exit code, not the emptiness, for any process question. An agent with an unread process still goes to `unplaced` (`agentGroup`, `delivery-placement.ts`), and plan 6's footer counts it.

### What the plan did not anticipate — decide it before you delete

`roleRuns` reads only `running` plans. The Plan runs section also renders **waiting** rows: a stopped or failed verify or spec run, with its `reason`, its `restart` command and its `log` path (`verificationRows(...).waiting`, `specRows(...).waiting`). Deleting the section deletes the only place a person reads that restart command. The plan's Done When says "the block holds no run row", and a run that has stopped is a run row.

Do this, in order:

1. Show a stopped or failed design or verify run as a Fleet row in the Blocked group, with its role chip, and keep its restart command and log path reachable from that row (the plan's Agent cell tooltip is the later slice's, so a plain text line in the row is enough here). The group and the Waits on column belong to `feature/delivery-fleet-agent-rows`; this slice only has to keep the information on screen.
2. If that needs a change to the agent row form or the placement rule that belongs to the next slice, stop and report instead of improvising. A restart command that disappears from the board is a regression a reviewer cannot see in the diff.

The halted lines (`haltedLine`, `specHaltedLine`) are not run rows. Keep them, in the Fleet section or where they are, and keep the `data-fleet-halted` attribute that tests select.

### Done when

The plan's Done When item for this slice is the specification: "a design or verify run shows as a Fleet row with its role, and the 'Tickets and plan runs' block holds no run row."

Lift these assertions, because a naive implementation passes without them:

- A fixture with one running design plan and one running verify plan shows exactly one row each, both in Fleet, and the Plan runs section holds no `PlanLevelRowView`. This catches removing the old rows without checking the Fleet rows still exist, and the reverse.
- A fixture with a stopped verify run and a stopped spec run still shows each one's restart command and log path somewhere in Fleet. This catches the lost-restart-command regression above.
- A fixture with no plan-level runs and no halted line renders no "Plan runs" heading and no empty `<ul>`. This catches an empty section left behind.
- `sectionCount`'s `planLevel` counts (`plan-level-row.tsx:131`) are not counted twice: one run adds one to the Working count, never two. This catches the header count reading both the registry-side run and the old plan-level row.
- The browser tests that select "Plan runs" move with the rows: `spec-run-rows.browser.test.ts:42-45`, `agents-tab.browser.test.ts:4760-4790` and `plan-link-click.browser.test.ts:65-127`. Move a decision to a domain unit test where the browser only proved it; keep one browser test proving the Fleet shows a design run and a verify run with their chips.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. `pnpm run typecheck` does not cover `packages/domain`: run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` for any domain file you change. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md` line inside the comment block; `scripts/check-changeset-packages.sh` checks the order and the package name. The slice changes no skill, so the changeset names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count. Never run board tests while an operator's board is open on this machine. Any function you write is an arrow; leave neighbouring declarations alone.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the "Plan runs" section of `packages/board/src/app/components/AgentList.tsx`, `packages/board/src/app/lib/agent-rows/plan-level-row.tsx` and its callers (`verificationRows`, `specRows` in `spec-row.ts`, `sectionCount`), the readings that carry a stopped run into Fleet, and the tests named above.

It does not own the Fleet groups, columns, Acting on, Doing now, Waits on, Time left, Tokens or the switches (`feature/delivery-fleet-agent-rows`, `feature/delivery-fleet-time-tokens`, `feature/delivery-fleet-header-switches`), `ROW_COLUMNS`, `agentRowCells`, or the Tickets section. At dispatch `git ls-remote origin 'feature/delivery-*'` lists only `feature/delivery-machine-line`; verify it, do not assume.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
