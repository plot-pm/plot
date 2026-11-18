## Implementation brief — delivery-release-progress-per-plan (wave 1: Plan rows)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-release-progress-per-plan.md on main
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-release-plan-rows` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-slice-states` (#3513), `feature/delivery-work-items-groups` (#3512) and `feature/sprint-owner-field` (#3490). All three merged, so it is startable now. `feature/delivery-release-person-cards` waits on it and edits the same module, so keep the section's structure in one place those cards can extend.

### What to build

Release delivery today lists every merged slice of every plan in Testing: about 40 rows where nothing needs anyone (measured 2026-11-16). This slice replaces that list with one collapsed row per plan. Build on what exists on `main`:

- **`deliveredBlocks` and `releaseLines`** (`packages/board/src/app/lib/agent-rows/delivery-view.ts`, built near the end of `deliveryView`) become the plan rows and the section header. `releaseLines` is `${slicesDelivered} of ${slicesTotal} slices delivered · ${held} held at gates · ${blocked} blocked`, where `blocked` already reads `countSliceStates` over `mapping.wholeReadings`. The new header reads the same counts and adds at-gates, plans in Testing and plans in Development: "<delivered> of <total> slices delivered · <n> at gates · <n> blocked · <n> plans in Testing · <n> in Development".
- **The strip and the counts** come from `packages/domain/src/rules/slice-states.ts`: `SLICE_STATES`, `sliceStateOf`, `countSliceStates`, `countSliceStatesOver`. Build no second classification. A strip block is one slice in one of the five states, so a plan's five counts add up to its `total`.
- **Delivered** is `sliceMerge` in `rules/deliverable.ts`, the walk under `sliceProgress`. "1 / 5 delivered" must equal `sliceProgress`'s "N of M slices merged".
- **Owner** is `ownerHandle` of the sprint that names the plan (`schema.ts`, `fleet.ts:8332`), or "—".
- **Start** reads the row's server-computed `startability` through `isStartable` (`row-identity.ts`). The control is today's `dispatch` button (`AgentList.tsx`, the Start control). **Not-started slices** leave Work items through `isUnbegun` (`row-identity.ts:77`) but stay on the payload.
- **Collapse.** Remove `release-delivery` from `COLLAPSED_BY_DEFAULT` (`collapse.ts`) and narrow `KNOWN_KEYS` to the design's three collapsibles: a plan row, the Free agents line and a "… n more" line. Store an opened plan row under the existing `plot-board:agents:collapsed` key.

The design is canonical: `docs/superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md`, *Release Delivery*. The plan is canonical for this slice. This brief is orientation.

### The decisions the plan settles — do not re-derive them

**The section stays open; only a plan row collapses.** A stored fold of Release delivery must fall away. A unit test reads a stored `["release-delivery"]` as open. Leaving `KNOWN_KEYS` over `DELIVERY_LAYOUT` keeps the old fold alive for every reader who ever folded it.

**An unread pulse is "progress not read", never "0 / 5".** Where `sliceProgress` answers `undefined`, or `countSliceStatesOver` returns `undefined` for a partial pulse, the strip shows no blocks. A zero would read as "nothing delivered".

**A deferred-only slice counts in no state and not in the total.** `slice-states.ts` already does this; do not recount.

**The opened list maps five states to three headings, and an in-flight slice appears exactly once, elsewhere.** Delivered → **Done**. At a gate, being built (a Queued slice included) and blocked → **In flight**, where the slice links to its row in Work items or You › Blocks delivery and is not repeated. Not started → **To do**, with what it waits for. A Done slice and a To do slice have no row elsewhere. Every In flight slice has exactly one.

**The Done line reads the PR index and adds no host call.** MERGED rows are terminal (*A Decision Reads The Index*). Where no MERGED row names the branch, the store is missing or reads `complete: false`, or `mergedAt` is empty, the line is "✓ merged · <slice>" with no number and no date. A slice completed by a named commit shows the commit's short hash and no date: a date would need a new `Refs` operation and a git spawn per plan, which the plan dropped. On Bitbucket `mergedAt` is the host's `updated_on` (`bitbucket-pr-row.ts:49`), shown as the host gave it. The index never says no: an absent row is "ask nothing, show the bare line".

**A cross-plan wait reaches To do through the slice verdict the pulse computes.** The line names the earlier slice from the row's `blockedBy` (`schema.ts`). Assert the cross-plan case in a unit test.

**Per release, one block.** Where the active sprints name different `Release:` values, one block per release. Where none names one, list every plan approved for delivery. A plan in two sprints counts once; `countSliceStatesOver` already dedupes keys.

**Rules carried over:** absent is not false (an unread slice is in none of the five states, and `unread` is counted apart); the index supplies `MERGED`, never `none`; every strip segment, heading, waits-for value, Start eligibility and header count is a domain property with a unit test, so the `.tsx` only renders.

### Done when

The plan's *Plan rows* item in `## Done When` is the specification. Lift these assertions, because a naive implementation passes without them:

- A release with 40 merged slices over 8 plans yields 8 rows, in a section that is open for a reader whose stored fold names `release-delivery`. This catches a `KNOWN_KEYS` left unnarrowed.
- The strip's five states sum to the plan's slice count, and "1 / 5 delivered" equals `sliceProgress` on the same pulse, for a plan with a deferred-only slice and with a merge-subject branch. This catches a second merge rule.
- An unread pulse shows "progress not read", never "0 / 5".
- Every slice of an opened plan appears under exactly one of Done, In flight and To do. A Queued slice is In flight with a link, not repeated. This catches a Queued slice falling to To do.
- The Done line carries PR and date from a MERGED row, the bare "✓ merged · <slice>" where the store is `complete: false`, and a short hash for a named commit. No host call is made: assert it with the index fixture alone.
- A To do slice whose row reads startable carries Start, a slice waiting on a slice in another plan included. A slice with no branch and no agent is not a Work items row.
- Two sprints naming one plan count it once in the release. Two `Release:` values show two blocks. No release names a plan: every plan approved for delivery is listed.
- The tests that pin the old shape change with it: `delivery-view.test.ts`, `delivery-readings.test.ts` (`deliveredBlocks`, `releaseLines`) and the `expandSection` tests (`AgentList.tsx`).

Plus the repo gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run `pnpm build:board` only to test locally and commit no bundle: `scripts/check-no-bundle-diff.sh` refuses one. Add a changeset for `plot` or `@plot-pm/board` with the description first and the `bumps:` block last. Domain code is arrows with factual TSDoc and no history, and says Slice, never Wave. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Plan rows` in the plan.

### Scope guard

This branch owns the new plan-row and section-header facts in `packages/domain/src/rules/` with their unit tests, the Release delivery part of `delivery-view.ts`, the Release delivery render in `AgentList.tsx`, `collapse.ts`, the `isUnbegun` placement change, and the PR number and date added to the payload for Done slices (a few kilobytes for about 40 slices).

In flight, verified at dispatch: `feature/delivery-tab-footer` (`delivery-view.ts`, `AgentList.tsx`) and `feature/delivery-you-person-comment` are open. Keep edits in `delivery-view.ts` to the Release delivery block so a rebase stays mechanical. `slice-states.ts` and `delivery-placement.ts` belong to the merged slice-states work: read them, and change `delivery-placement.ts` only if the not-started placement requires it. Person cards (`feature/delivery-release-person-cards`) and the sprint scope (`feature/delivery-sprint-delivery-scope`) are later slices: build neither.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
