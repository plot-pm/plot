## Implementation brief — delivery-tab-header-and-my-sprint (wave 4: Slice states)

- **Plan (canonical):** docs/plans/2026-11-16-delivery-tab-header-and-my-sprint.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Branch:** `feature/delivery-slice-states` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

This slice waits on `feature/delivery-you-groups`, which merged as #3500, so it is startable now. Two slices wait on it: `feature/delivery-sprint-card` (reads the counts per sprint) and `feature/delivery-release-card` (reads them per release). Plan 5's slice strip reads this classification too and builds no second one, so the exported names and shapes are the contract those slices code against.

### What to build

The Delivery tab has no single answer to "how far is this plan, release or sprint". Its only count is the Release delivery line, `${slicesDelivered} of ${slicesTotal} slices delivered · ${held} held at gates · ${blocked} blocked` (`packages/board/src/app/lib/agent-rows/delivery-view.ts:419-421`), and its "blocked" is `isStuckReason` over the You items, which is reader-relative (Mine and ownership decide whether an item reaches You) and includes `loose`, which is not a slice. This slice adds one domain classification that gives each slice exactly one of five states — **delivered, blocked, at a gate, being built, not started** — and counts them per plan, per release and per sprint. The release card, the sprint card and plan 5's strip draw from it.

Build on what exists:

- **delivered** is the merge answer `slicesOf` already walks (`packages/domain/src/rules/deliverable.ts:~215`): a slice is merged where `slice.verdict === 'complete'` and it holds a non-deferred branch. Export that per-slice answer from `deliverable.ts` and have `slicesOf` call it, so `sliceProgress` and the new rule read one function. Write no second merge rule.
- **blocked** is plan 2's table. `youCaseOfItem`-style access does not exist yet: `youCase` in `packages/domain/src/rules/delivery-placement.ts` is private and takes `(item, input, live, stopped)`; `placeDelivery` applies `item.ownership !== 'theirs'` after it. Export the ownership-free part (the item's case, or `null`) and have `placeDelivery` call it, so the placement and the classification cannot disagree. A slice is blocked where that case's group is `blocks-delivery` (`YOU_CASES[...].group`, via `youCaseOf`).
- **at a gate**, **being built** and **not started** read the item's own facts: `heldBy`, `stage === 'pr'`, `stage === 'building'`, a claim, and `isUnbegun` (`packages/board/src/app/lib/agent-rows/row-identity.ts:77`). `rowItem` (`delivery-readings.ts:168`) already derives `stage` and `heldBy` per slice item. The slice ids are `slice:<plan>:<wave>` (`sliceItemId`, `delivery-readings.ts:90`).

The rule runs in the client over the payload the tab already holds, through a domain function with a unit test. It adds no server work and no payload field. The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**The order is fixed and it is what makes the five states total.** delivered, then blocked, then at a gate, then being built, then not started; the first that matches wins. A naive implementation tests each state independently and double-counts a slice with an open PR and a `PLOT-BLOCKED` marker. The five counts must add up to the total for every payload.

**Blocked is reader-independent.** Read the Blocks delivery case from the item alone, before ownership and before the Mine filter. A reader-relative count would make one release read differently per viewer, and the release counts every team member's sprints (round-2 panel). Do not call `placeDelivery` and count its You items: that applies `ownership !== 'theirs'` and the reader's Mine mode, which is exactly the bug.

**A Queued slice reads being built.** Plan 3's Work items › Queued is a branch or a claim and no live agent (`workGroup`: `stage === 'building'`, `live === 0`). The five states do not wait on plan 3; the fixed order covers it.

**A deferred-only slice counts in no state and not in the total**, as `sliceProgress` excludes it (`totalSlices` skips `branches.length === 0` after filtering `deferred`). A slice that names no branch at all is a malformed plan and `slicesOf` refuses it separately; keep that case out of the counts the way the walk does.

**"blocked" has one meaning from this merge on.** The Release delivery line's blocked count changes from `isStuckReason` to the five-state Blocked count. The set differs: `isStuckReason` holds `blocked-marker`, `fleet-stuck`, `merge-conflict`, `agent-died`, `loose`, and Blocks delivery now also holds `plan-approval`, `spike-approval`, `release-approval`, `test-delivered-plan` and `review-pr`, while `loose` sits in Unblock. Test the line's new number, and say in the PR body that it moves. Plan 5's plan-rows slice later replaces the line; do not redesign it here.

**Rules carried over:** absent is not false. A slice whose reading is absent (`stage` undefined, the scan never held its rows) is not "not started" — `placeDelivery` lists it `unread`. Count it in none of the five states, and keep the "five counts add up to the total" assertion true by excluding it from the total too, or by naming it as a sixth `unread` figure beside the five; decide and assert it. An absent merge answer (`slicesOf` returns `null` on a partial pulse) is `undefined`, never `0 of 0`. The index and the pulse are answers; do not persist a state.

### Done when

The plan's Done When item for this slice is the specification: "each slice gets exactly one of the five states, a Queued slice reads being built, and the five counts add up to the total, asserted in unit tests per plan, per release and per sprint; two readers with different identities get the same counts from one payload; the Release delivery line's blocked count is the five-state count." Plus the plan's last item: every count has a unit test.

Lift these assertions, because a naive implementation passes without them:

- One payload read by two readers (`mine` and `theirs` ownership of the same slice) gives identical counts. This catches a classification built on `placeDelivery`'s You items.
- A slice with an open PR and a `PLOT-BLOCKED` marker reads blocked, not at a gate; one with an open PR and a held default branch reads at a gate. This catches the wrong order.
- A Queued slice (a claim, no live agent) reads being built, and a slice with no branch, no claim and no agent reads not started. This catches a Queued slice falling through to not started.
- The five counts equal the total for a plan with a deferred-only slice, and the deferred slice appears in no state.
- `delivered` equals `sliceProgress`'s numerator on the same pulse, for a plan with a merge-subject branch and with a partial pulse. This catches a second merge rule.
- The per-release and per-sprint counts equal the sum of the per-plan counts over the plans each names. State in the test how a plan reaches a release or a sprint (the sprint file's items and `Release:`), and keep a plan in two sprints from counting twice in a release.
- The Release delivery line prints the five-state Blocked number.

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` key run in CI, and a failure there comes back as a correction. A domain function belongs in `packages/domain`, written as an arrow, with factual TSDoc and no history. Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for `plot`/`@plot-pm/board` with the description first and the `bumps:` block last. The slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Slice states` in the plan.

### Scope guard

This branch owns the new classification module in `packages/domain/src/rules/`, the export in `deliverable.ts`, the export in `delivery-placement.ts` (the ownership-free case), their unit tests, and the Release delivery line in `delivery-view.ts`. It adds no component and no payload field.

In flight on the same files, verified at dispatch: `feature/delivery-you-loose-prs` (`delivery-placement.ts`, the `loose` case), `feature/delivery-fleet-agent-rows` and `feature/delivery-tab-footer` (`delivery-view.ts`, `AgentList.tsx`) are open branches. Keep the `delivery-placement.ts` edit to the one extraction, so a rebase stays mechanical. `feature/sprint-owner-field` owns the sprint record and the ownership rule; read a sprint's plans from the existing sprint data and do not add a field to it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
