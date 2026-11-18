## Implementation brief — delivery-release-progress-per-plan (wave 2: Person cards)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-release-progress-per-plan.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-release-person-cards` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-release-plan-rows` (#3525), which merged, so it is startable now. `feature/delivery-sprint-delivery-scope` waits on this slice and edits the same Release delivery module, so keep the person cards in their own facts and their own render component.

### What to build

Release delivery now shows one collapsed row per plan under a header, but it names no person. In release scope, a reader cannot see whose sprint holds the progress. This slice adds one small card per sprint owner, each with one progress bar per sprint that owner owns, and one card labelled "no owner" for the sprints that carry no Owner. Build on what exists on `main`:

- **The release's sprints.** `releaseBlocks` (`packages/domain/src/rules/release-plan-rows.ts`) takes `SprintPlans` (`release`, `members`) and groups plans by target release. `deliveryView` (`packages/board/src/app/lib/agent-rows/delivery-view.ts`, near the end) maps the payload's sprints into it and already receives `ownerHandle` on each sprint (`Pick<FleetSprint, 'release' | 'ownerHandle' | 'members'>`). The cards need the sprint's slug and title too, so widen that `Pick` and `SprintPlans`, not the payload.
- **The bar per sprint** is `sprintCards` in `packages/domain/src/rules/sprint-card.ts`: it builds `bar` from `countSliceStatesOver(slicesByPlan, keys, readings, input)` over the sprint's counted members (a deferred member and a member the board did not find are left out), and answers `bar: null` with `readingMissing: true` where any named plan has no merge answer. Reuse that count and that rule for each sprint in the release. Build no second classification and no second bar. `sprintCards` filters to the sprints the reader owns (`sprintIsMine`); the person cards do not, so extract the per-sprint part into a function both call and leave `sprintCards`'s output unchanged.
- **The people** are the Owners of the sprints that name that release. Group sprints by the resolved person: `resolvePerson(ownerHandle, directory)` and `samePerson` (`packages/domain/src/entities/person.ts`), the way `sprintIsMine` does, so `jwloka` and `Jan Wloka` written in two sprints give one card. A sprint with an empty Owner goes on the one "no owner" card. A sprint whose Owner the `People` directory does not declare (`declaresSpelling` false) is shown under its handle as written, not dropped and not merged into "no owner". A person with no Active sprint in the release has no card.
- **Release scope only.** The cards belong to the release block, one set per target release. Where no sprint names a release, the block lists every approved plan and holds no sprint, so it shows no cards. The **My sprint** scope and its rename are the next slice's; build neither.

The design is canonical: `docs/superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md`, *Release Delivery* and *Calls Made After Review* ("A sprint has an owner"). The plan is canonical for this slice. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**One card per sprint owner, with a bar per sprint. Not one per team member.** The plan's round-2 panel asked this and answered it: a plan file carries no owner, so the design's people are sprint owners. A card per member would need an owner on every plan, which does not exist.

**Sprints with no Owner count toward the release and show on one "no owner" card.** The release's totals and the plan rows do not change for a missing Owner. Dropping an ownerless sprint would make the cards add up to less than the header.

**An unread merge answer is "not read", never an empty bar.** Where `countSliceStatesOver` answers `undefined`, the sprint's bar is `null` and the card says the reading is missing. A bar of zeros reads as "nothing delivered". `sprintCards` already does this; the extraction must keep it, and a unit test asserts it for a sprint in a release.

**A plan named by two sprints counts once per sprint's own bar and once in the release.** `countSliceStatesOver` dedupes keys inside one call; do not sum the sprint bars to make the release total, take the release's from the plan rows.

**The bar's segments are the five states of `SLICE_STATES`**, in that order, as the sprint card draws them. A slice's state comes from `slice-states.ts`; a deferred-only slice counts in neither the segments nor the total.

**Rules carried over:** absent is not false (a missing Owner is "no owner", not a person; an unread plan is `undefined`, not zero); an undeclared handle belongs to nobody for ownership, so it must not be matched to a reader or merged with another handle; every card, bar segment and label is a domain property with a unit test, so the `.tsx` only renders.

### Done when

The plan's *Person cards* item in `## Done When` is the specification. Lift these assertions, because a naive implementation passes without them:

- A release with three sprints, two owned by one person written as two spellings the directory resolves to one person, and one with no Owner, yields two cards: the person's, with two bars, and "no owner", with one. This catches grouping on the raw handle.
- A sprint with no Owner is on the "no owner" card and its slices stay in the release's header counts. This catches an ownerless sprint dropped.
- A sprint naming a plan whose merge answer is unread has `bar: null` and the missing-reading text, and the other bars on its card still draw. This catches one unread plan blanking the card.
- Two sprints naming one plan: each sprint's bar counts it, and the release's header counts it once.
- A release no sprint names shows no cards. A person with no Active sprint in the release has no card.
- `sprintCards`'s existing tests pass unchanged: the extraction moves no behaviour for the Sprint card.
- The card shows in the section for a reader who owns none of the sprints: the cards are not narrowed to Mine.

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run `pnpm build:board` only to test locally and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. Add a changeset for `plot` or `@plot-pm/board` with the description first and the `bumps:` block last. Domain code is arrows with factual TSDoc and no history, and says Slice, never Wave. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Person cards` in the plan.

### Scope guard

This branch owns the new person-card facts in `packages/domain/src/rules/` (a new file, or `release-plan-rows.ts`) with their unit tests, the extraction of the per-sprint bar out of `sprintCards` in `sprint-card.ts`, the widened sprint fields in `delivery-view.ts`, and a new person-cards component that `AgentList.tsx` mounts inside the release block. Keep edits in `delivery-view.ts` and `AgentList.tsx` to the Release delivery block so a rebase stays mechanical.

Later and out of scope: `feature/delivery-sprint-delivery-scope` (the **My sprint** rename and sprint grouping of this section) waits on this slice. `feature/delivery-my-sprint-scope` is plan 1's and scopes the status card, You and Work items, not this section. Verify what is in flight at dispatch with `/plot-pulse`; the brief does not guess it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
