## Implementation brief — delivery-release-progress-per-plan (wave 3: Sprint scope)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-release-progress-per-plan.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-sprint-delivery-scope` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This is the last slice of the plan. It waits on `feature/delivery-my-sprint-scope` (#3538) and `feature/delivery-release-person-cards` (#3532). Both merged, so the slice is startable.

### What to build

The **My sprint** toggle now scopes the status card, You and Work items through `deliveryScope` (`packages/domain/src/rules/delivery-scope.ts`), and Release delivery ignores it: it shows every target release and every plan whatever the toggle says. This slice applies the same scope to the section, renames it and groups its plans by sprint. Build on what exists on `main`:

- **The scope arrives from `AgentList.tsx`.** `sprintScope` (about line 741) holds `kind` (`release` or `my-sprint`) and `sprints` (the owned and selected Active sprints under `my-sprint`). `placeMapping(mapping, fleet.slices, activeSprints)` (about line 1173) passes every Active sprint to `deliveryView` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`, `releaseBlocks` built near line 536). Pass the scope in, and decide nothing in the component. Write the section's title and grouping as domain facts that take the scope and its sprints and return the heading and the plan groups. Call `deliveryScope`'s result and write no second ownership test: `sprintIsMine` is the only one.
- **The title.** Toggle on, the section reads **Sprint delivery · <name>**, where `<name>` is the title of the selected sprint (`Pick<FleetSprint, 'title'>` is already on the sprint rows `deliveryView` takes). Where the reader selected several owned sprints, the section title is `Sprint delivery` with no name and each group carries its own sprint's name. Toggle off, the title stays **Release delivery**. The label now sits in `SECTION_META['release-delivery']` (`delivery-view.ts:43`) and is rendered as `section.label`; the section key `release-delivery` does not change, because `collapse.ts`, `DELIVERY_LAYOUT` and the browser tests select by it.
- **The plans.** Toggle on, the section lists the plans the scope's sprints name (their `members`), and no other plan. A plan named by two of the reader's sprints appears once under each sprint's group only where the reader owns several; with one owned sprint there is no grouping and the plans list flat.
- **The header per group.** `headerCounts` and `headerText` (`rules/release-plan-rows.ts`) already count over a block's plans, each plan once. Reuse them per sprint group and write no second count. A sprint group's header reads the same counts over its own plans.
- **Release scope is unchanged.** Toggle off, `releaseBlocks`, the header text and the person cards from `#3532` read exactly as they do today.
- **The person cards stay release scope only.** The plan says "release scope only". With **My sprint** on, the section shows no person cards: the sprint card above already shows the reader's sprint bar.
- **Start and the stored fold.** The opened-plan state (`openReleasePlans`, stored under `plot-board:agents:collapsed`) keys on the plan, so a plan listed under two groups opens in both. Keep that, and do not add a storage key.

The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**Plan 1 owns the scope rule; this slice applies it.** `deliveryScope` answers which sprints are in scope. Writing a second filter here would let the section and the cards disagree on what Mine means, which is the defect plan 1's scope slice removed. The round-2 panel settled it ("Writer's call").

**This slice is the only one that narrows and renames Release delivery.** Plan 1's scope slice scopes the status card, You and Work items only, and its brief tells its builder not to touch `data-release-line` or the Release delivery block. Everything the toggle does to this section lives here.

**Blocked stays reader-independent.** Scope picks which plans the section lists. It does not change how a slice is classified: two readers who own the same sprint see the same strip, the same counts and the same blocked number from one payload.

**A sprint with no Owner, or an Owner `People` does not declare, is in no reader's `my-sprint` scope and always in the `release` scope.** That is `sprintIsMine`'s answer through `deliveryScope`. A reader who owns no Active sprint has the toggle disabled and gets the release scope; the section then reads **Release delivery**. An empty `owned` list must never match an empty `ownerHandle`.

**Absent is not false.** A scoped sprint with a plan whose merge answer is unread keeps the "progress not read" strip of the plan rows. Do not turn it into "0 / n delivered".

**Rules carried over:** every title, group and count is a domain property with a unit test, and the `.tsx` only renders; a function you write is an arrow; the domain says Slice, never Wave; icons come from `glyphs.ts` only.

### Done when

The plan's *Sprint scope* item in `## Done When` is the specification: with **My sprint** on, the section's title and plans follow the reader's sprint scope, grouped by sprint where the reader owns several.

Lift these assertions, because a naive implementation passes without them:

- Toggle on with one owned sprint and one not: the title reads `Sprint delivery · <owned title>`, the section lists only the owned sprint's plans, and the other sprint's plans are gone. This catches a rename with no narrowing.
- Toggle on with two owned sprints: two groups, each with its sprint's name and its own header counts, and a plan named by both appears under both. This catches a flat list that hides the grouping, and a plan dropped from the second group by a global `seen` set.
- Toggle off: the title reads `Release delivery`, every release block and every plan show, and the person cards render. This catches a scope applied unconditionally.
- A sprint with no Owner, and a reader with no host login, give the release scope and the title `Release delivery`. This catches an empty handle matching an empty login.
- A reader who owns none of the Active sprints sees the section unchanged from the toggle-off case. The cards are not narrowed to Mine.
- The section key is still `release-delivery`: the stored-fold test (`["release-delivery"]` reads as open) and `delivery-scope-placement.test.ts` pass unchanged.
- Fleet and Tickets show the same rows with the toggle on and off.
- One browser test proves the toggle renames and narrows the section. Run it with `pnpm --filter @plot-pm/board exec vitest related --run --project parallel <file>`, not the whole board suite, and not while the operator's board is open on this machine.

Plus the repo gates. Commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and run no `pnpm run test:e2e` locally. Run `pnpm build:board` only to test locally and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. Add a changeset for `@plot-pm/board`, the description first and at least 20 characters, then the `plan: docs/plans/2026-11-16-delivery-release-progress-per-plan.md` line inside the comment block, with no `bumps:` entry because the slice changes no skill. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Sprint scope` in the plan.

### Scope guard

This branch owns the section's scope facts in `packages/domain/src/rules/` (a new file or `release-plan-rows.ts`) with their unit tests, the scope argument and the title in `delivery-view.ts`, the Release delivery block in `AgentList.tsx` (about lines 1510–1600) and its browser test. It reads `deliveryScope`, `sprintIsMine`, `releaseBlocks`, `headerCounts` and `releasePersonCards`, and changes none of their rules.

Other branches in flight: none in this plan. `feature/delivery-tab-footer` edits the footer and the not-placed block lower in `AgentList.tsx`; keep clear of both. Verify what is in flight at dispatch with `/plot-pulse`; the brief does not guess it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
