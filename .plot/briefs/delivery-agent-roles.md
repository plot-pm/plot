## Implementation brief — delivery-fleet-rows-per-agent (wave 1: Agent roles)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-agent-roles` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the first slice of plan 4 of the six-plan Delivery-tab design. It waits on `feature/delivery-section-header` (plan 1). Plan 3's By column (`feature/delivery-work-items-groups`) and this plan's `feature/delivery-fleet-plan-runs` wait on it. Before you start, confirm `feature/delivery-section-header` is merged: `git log origin/main --oneline -- packages/board/src/app/lib/agent-rows/delivery-view.ts` must show its summary change. If it is not merged, stop and report.

### What to build

Today every agent row reads as a `loop` agent unless its registry entry names a role (`agent.role ?? 'loop'`, `packages/board/src/app/lib/agent-rows/delivery-readings.ts:302`). `AgentRole` (`packages/domain/src/rules/delivery-placement.ts:92`) lists six roles, and no code gives the reviewer, the fixer, design or verify an agent of its own. Measured on `main` on 2026-11-17: `git grep "role: '"` finds registry writes only for `idea` (`packages/board/src/server/idea.ts:825`, `story-plan.ts:286`) and `brief`; reviewers, fixers and the design and verify runs show on the board as flags on PR rows or as the "Tickets and plan runs" block, not as agents.

This slice does three things. It widens `AgentRole` to eight roles by adding `design` and `verify`. It adds one domain reading per role, mapped to an agent placement reading, from the sources in the plan's role table. It adds the role chip as one domain fact and one component, which plan 3's By column reuses. It does not change the Fleet rows, groups or columns: `agentRowCells` keeps building its current seven cells (`kind` cell = the role), and the new agents appear through the existing placement.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**Each role reads a file the board or fleetd already writes. No role gains a host read.** The table in the plan's Approach names them: registry entry (`loop`, `idea`, `brief`), `.plot/state/review-in-flight.json` (`reviewer`, entries typed by `ReviewRunEntry` in `packages/domain/src/rules/review-run.ts`), the `inFlight` mark in `.plot/state/fixer-attempts/<pr>.json` (`fixer`), `fleet.design` on the payload from `auto-design-in-flight.json` (`design`), and the verification status from `auto-verify-in-flight.json` (`verify`). A reading that needs a `gh` or `bb` call is out of scope. Do not add one.

**The approver has no reading, so it shows no row.** The plan measured `f0dfed71a`: no runner and no state file for an approver on `main`. Do not invent a reading to fill the eighth chip. `approver` stays in the union for the existing type; the plan's Done When asserts that it produces no row, and Notes names it. A naive implementation maps every role in the union to a row and passes a test over only the seven others.

**The board does not read the reviewer's or the fixer's runs as agents today, so this slice adds the reads.** Measured: `packages/board/src/server/fleet.ts:6614-6623` reads `.plot/state/fixer-attempts/<pr>.json` through `fixerAttemptsFile` and `fixerInFlight`, but only to set a PR row's `fixing` flag (`schema.ts:3326`) for the rows asked. No board code reads `review-in-flight.json` (`git grep review-in-flight -- packages/board/src` finds nothing). Reuse the existing adapters and rules (`fixerAttemptsFile`, `fixerInFlight`, `ReviewRunEntry`). Read each state file once per scan, as the plan's Cost note requires, and add no per-agent subprocess.

**A role's start time is a fact of its reading, and design and verify have none.** Loop, idea and brief take `AgentEntry.startedAt`; the reviewer takes the entry's `startedAt`; the fixer takes `inFlight.startedAt` (`packages/domain/src/entities/fixer-attempts.ts:41`). Design and verify carry none on the payload (`DesignStatusSchema`, `VerificationStatusSchema`), so their start time is `null`. Do not guess one from a log or a pid. The time-left slice consumes this fact and shows "—" for `null`.

**The domain imports `zod` and nothing else.** `REVIEW_BOUND_MS` lives in `packages/fleet/src/shared/auto-review.ts:64`. Do not import it into the domain; the plan's time-left rule takes bounds as readings, and that is a later slice. This slice needs no bound.

**The role chip is a domain fact.** CLAUDE.md, "Every rendered state is a domain property": the chip's label, its colour key and its accessible name are computed in the domain and asserted in a unit test, and one component renders them. Chip colours come from the board's existing palette (plan, "Left to the Builder"). A second chip component, or a colour decided in `.tsx`, is the defect this decision prevents, because plan 3 reuses the component.

**Terminology.** An Agent is the actor and a Worker is the process (CLAUDE.md, "The Domain Package"). A reviewer or a fixer is an Agent with a role. A new domain fact for the reading says what the agent is, not what a process is doing. No new code says `Wave` where it means `Slice`. Write every function you add as an arrow, and leave neighbouring declarations alone. A TSDoc block states what an export does and returns, not the history of the decision.

**Rules carried over from related work.** An absent reading is not an empty one: a missing, unparseable or other-version state file yields no agent for that role, never a fabricated one and never an error that blanks the Fleet section. Read the exit code, not the emptiness, for any process question. `agentGroup` still sends an agent with an unread process to `unplaced` (`delivery-placement.ts:262`); that rule stays, and plan 6's footer counts those agents.

### Done when

The plan's Done When item for this slice is the specification: "each role with a local reading (loop, fixer, reviewer, idea, brief, design, verify) maps to it and shows its chip, and the approver, with no reading, shows no row and is named in Notes, asserted in unit tests."

Lift these assertions, because a naive implementation passes without them:

- One fixture with a live entry per source (registry `idea`, registry `brief`, a review run, a fixer `inFlight` mark, a design run, a verify run, a plain registry agent) yields one agent per source with the right role and no others. This catches a role read from the wrong file or a role dropped.
- A registry entry with `role: 'approver'`, or an approver in the union with no reading, produces no row. This catches the eighth-chip shortcut.
- A review run entry whose pid is dead and whose start lies past `REVIEW_START_GRACE_MS` produces no reviewer agent; `reviewRunLive` (`review-run.ts`) is the existing answer. This catches a stale run read as live.
- A fixer-attempts file with no `inFlight` mark produces no fixer agent. This catches reading the attempt record as a run.
- A missing, unparseable or other-version state file for each role produces no agent for that role, and the other roles still show. This catches one bad file blanking the section.
- Design and verify agents carry a `null` start time. This catches an invented one.
- The chip's label, colour key and accessible name are unit-tested for all eight roles. One browser test proves a chip shows on a Fleet row; it proves the page shows it, and the colours themselves are unit-tested.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally. `pnpm run typecheck` does not cover `packages/domain`: run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` for the domain files. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-fleet-rows-per-agent.md` line inside the comment block; `scripts/check-changeset-packages.sh` checks the order and the package name. The slice changes no skill, so the changeset names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count; if you find you need one, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the role set and its readings: `packages/domain/src/rules/delivery-placement.ts` (`AgentRole`), the new domain rule or entity for the per-role reading and the chip fact, `packages/board/src/app/lib/agent-rows/delivery-readings.ts` (the agent mapping at `:299-309`), the server read that puts the reviewer, fixer, design and verify runs on the payload (`packages/board/src/server/fleet.ts` and `packages/board/src/contract/schema.ts`), the one chip component under `packages/board/src/app/components/`, and the unit and browser tests of those.

It does not own the Fleet groups, columns, Acting on, Doing now, Waits on, time left, Tokens or the switches (slices 3 to 5 of this plan), and it does not remove the design and verify runs from the "Tickets and plan runs" block (`AgentList.tsx:537-552, 1499-1506`), which is `feature/delivery-fleet-plan-runs`. Until that slice merges, a design or verify run shows in both places; that is expected and the plan orders it. Leave `ROW_COLUMNS` and `agentRowCells` as they are.

Other branches of the six plans in flight are named in `git ls-remote origin 'feature/delivery-*'` at dispatch; verify it, do not assume. `feature/delivery-section-header` holds `delivery-view.ts`, `glyphs.ts` and the heading markup in `AgentList.tsx`, and must be merged first, so those files are yours to read and not to change here. `feature/delivery-tickets-section` (plan 6) edits the "Tickets and plan runs" block and waits on nothing of yours.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
