## Implementation brief — delivery-tab-header-and-my-sprint (wave 3: Fleet card)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-fleet-card` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-section-header`, which merged as #3484, so it is startable now. Nothing waits on it inside this plan. Plan 4 later moves the fleet switches into the Fleet section header and reads this card's read-only mode, so keep that mode a prop of the existing switch components rather than a copy of them.

### What to build

The Delivery tab has no place at its top that answers "is the fleet working, stuck or idle". The only answer is the Fleet section far down the page, whose body holds the switches (`AgentList.tsx:1424-1436`, the `#fleet-controls` span). This slice adds the **fleet card** to the tab header: a state (idle, working or blocked), the counts of free, working and blocked agents, the fleet switches shown read-only, and a link down to `#fleet-controls`.

Build on what exists. The three counts already exist: `agentGroup` (`packages/domain/src/rules/delivery-placement.ts`, near line 262) puts every agent in `working`, `blocked` or `free`, and the merged Fleet section header summarises those groups through `summarise` and `SectionCount` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:170-185`). The card reads the same placement output and builds no second count. The switches are `AutoDispatchSwitch`, `AutoSwitch` (`name` = `autoReview`, `autoVerify`, `autoDesign`) and `ParallelAgentsStepper` in `packages/board/src/app/components/FleetControls.tsx`; the Fleet body renders them with `fleetControlsOf(fleet)` and `switchesOf(fleet)` (`AgentList.tsx:1431-1435`). Each is a client component that echoes optimistically and posts to `/api/fleet-controls`. The card renders them in a read-only mode. The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**Read-only means no write path, not a disabled look.** Each switch holds local state and calls `postControls`. A card that passes `disabled` to a checkbox still mounts the component that can post. Add a `readOnly` prop to the three components so they render the value and never call `postControls`, and so a click does nothing. The plan says the card "renders the same switch components as the Fleet header (`FleetControls.tsx`) in a read-only mode, so the switch state has one source" — a second set of read-only boxes fed from the same payload would be the second source the plan refuses. Do not move the switches out of the Fleet body: that is plan 4, and the link to `#fleet-controls` needs the anchor to stay where it is.

**The card does not change with the My sprint toggle.** The design lists the Fleet card with Tickets as unscoped: "the fleet is one fleet" (design, *The "My sprint" Toggle*). The card therefore reads the unfiltered agent placement, and so does the Fleet section. Check that the card's counts equal the Fleet section header's counts on a payload with a sprint filter on.

**Domain first.** The state and its three counts are one domain function with a unit test, and the component only renders what it returns (CLAUDE.md, "Every rendered state is a domain property"). Write it as an arrow. Name it within the domain's terminology: an Agent is the actor, and `Worker` stays on the process states.

**The state's precedence is not fixed by the plan or the design.** The design says "idle, working or blocked" and does not say what a fleet with both working and blocked agents reads. The recommendation: `blocked` when any agent is blocked, else `working` when any is working, else `idle`, because a blocked agent needs a reader and a reader scanning the header should not see "working" over it. If you choose differently, say so in the PR body and assert the chosen order in the unit test, so it is a recorded decision and not an accident. A fleet with no agents reads `idle` with three zeros; an unread agent list (`agentGroup` returns `null` where `process` is `undefined`) is not a zero — keep that case out of the counts as the Fleet header does, and do not turn it into a false "idle".

**Rules carried over:** absent is not false, and a count that depends on an unread reading is not `0`. The card adds no server work and no payload field. The supervisor alert (`FleetAlert`) stays in the Fleet section; the card does not repeat it.

### Done when

The plan's Done When item for this slice is the specification: "the fleet card shows the state, the three counts and the switches read-only, and links to `#fleet-controls`." Plus the plan's last item: every count, marker and disabled state has a unit test, and browser tests prove only what is seen.

Lift these assertions, because a naive implementation passes without them:

- A payload with working and blocked agents together reads `blocked`, and the order is asserted. This catches an implementation that tests `working` first by habit.
- A payload with agents all `free` reads `idle` with free = N, and an empty payload reads `idle` with three zeros.
- The card's three counts equal the Fleet section header's three counts for the same payload, including with a sprint filter on. This catches a card that counts from the filtered rows.
- A click on a card switch posts nothing. Assert it in a component or browser test by counting requests to `/api/fleet-controls`, since a visually disabled checkbox proves only the look.
- The card's switch values equal the Fleet body's for the same payload (one source).
- The link reaches `#fleet-controls` (`scrollToAnchor('fleet-controls')`, as the group-held links do at `AgentList.tsx:1459`).
- A 320 px viewport has no horizontal scroll and both themes read (plan, *Constraints*). Check both by looking at the rendered tab after `pnpm build:board`, not by reading the diff. Icons come from `glyphs.ts` only.

Plus the repo's gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite, do not run `pnpm run test:e2e` locally, and do not run board tests while the operator's board is open on this machine. Run `pnpm build:board` only to look at the result in a browser, and restore any generated bundle path before you push: `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. Add a changeset for the package `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md` line inside the comment block; this slice changes no skill, so it names no `bumps:` entry. The slice touches no `.sh` file under `skills/`, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work still moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the fleet card: a new card component and its domain function under `packages/board/src/app/` and `packages/domain/src/rules/` (names are the builder's), the `readOnly` prop on `AutoDispatchSwitch`, `AutoSwitch` and `ParallelAgentsStepper` in `packages/board/src/app/components/FleetControls.tsx`, the card's mount point in the tab header in `AgentList.tsx`, and the unit and browser tests of those. It reads `delivery-placement.ts` and `delivery-view.ts` and changes them only where a count the card needs is missing.

On 2026-11-17 no other `feature/delivery-*` branch is pushed (`git ls-remote origin 'refs/heads/feature/delivery-*'` returns nothing), and `feature/sprint-owner-field` merged as #3490. The slices that will touch `AgentList.tsx`'s header region (`feature/delivery-tab-todo-list`, `feature/delivery-sprint-card`, `feature/delivery-release-card`) all wait on slices that are not merged, so a collision at merge time is not possible today. Put the card behind its own component so those later slices add siblings and do not edit it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
