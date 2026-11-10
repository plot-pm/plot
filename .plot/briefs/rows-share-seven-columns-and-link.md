## Implementation brief — rows-share-seven-columns-and-link

- **Plan (canonical):** docs/plans/2026-11-08-rows-share-seven-columns-and-link.md on main
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3249 merged
- **Branch:** `feature/rows-share-seven-columns-and-link` (base: `main`)
- **Ends as:** one PR to `main`, opened with `plot-open-pr.sh`
- **Review of the code:** per repo convention (`Auto-review: true`; `plot/review` is required on `main`)

This slice is the only slice of the plan. It waited on `feature/delivery-tab-sections` of plan 1, which merged as #3267 on 2026-11-10. Plan 3, `tickets-for-the-release-and-loose`, builds on the columns this slice adds.

### What to build

Today the Delivery tab renders its sections with the old row components. On origin/main, `packages/board/src/app/lib/agent-rows/rows.tsx` holds 2,969 lines (the plan says 2,959; the file grew by 10 lines since approval). The path is `lib/agent-rows/`, not `components/`. Five row kinds (PLAN, SLICE, RELEASE, PR, AGENT) have five column shapes, and internals such as "4 manifests, 26 synthesized" and "worker running (pid 99253)" show as content.

Build two one-line row forms over `CardFacts` (`packages/domain/src/entities/card-facts.ts`): a work-item row and an agent row. Both render the seven columns KIND, ITEM, WHERE, STATUS, DO, BY, AGE in that order. DO shows under You only. A cell holds a value, not a sentence. Each cell links to one kind of target, per the design's *Columns* and *Links by Row* tables. The design is canonical: `docs/superpowers/specs/2026-11-08-delivery-tab-design.md`. Do not restate it in code comments.

Build on what plan 1 left. `placeDelivery` and `DELIVERY_LAYOUT` (`packages/domain/src/rules/delivery-placement.ts`) already decide the section and group of every item and agent. `delivery-view.ts` already carries `PlacedItemView` (placement, rows, `label`, `anchor`, `links`) and `PlacedAgentView`. The `anchor` and `links` fields are the starting point for "a link scrolls to and highlights its target". Add the cell values and link targets as properties on domain objects next to the placement rule, and assert each in a domain unit test with no browser.

Move pids, manifest counts, synthesized rows, desk paths and raw branch names beyond the one link behind a details popover. Move the four auto switches into the Fleet header beside the parallel-agents control. Delete the replaced row code from `rows.tsx` in the same change.

### Settled decisions — do not re-derive them

**Cell values are domain properties, not `.tsx` decisions.** A wording, a link target or a disabled state computed in a component can be tested only by rendering it, and rendering is how 42 of 43 of this repo's browser tests came to start a full board server (CLAUDE.md, "Every rendered state is a domain property"). Browser tests keep one job: prove that a value is seen.

**The two forms read the five card facets (`identity`, `lineage`, `progress`, `next`, `ownership`) and show no chip for a fact nobody asked.** "Absent is not false": an unread fact renders nothing, never a default word such as "none" or "0". `PrReading` already models this with `unread`; carry that rule into every cell.

**No second row path stays.** The plan says the replaced code leaves `rows.tsx` in the same change. A new form added beside the old one, with the old one unreferenced but present, fails that. Measure it: after the change, grep for each removed component's name across `packages/board/src` and find no hit.

**Only auto-dispatch has a controller today. The other three switches have none, and building one is part of this slice.** Measured on origin/main: `/api/fleet-controls` (`packages/board/src/server/fleet-settings.ts`, `packages/fleet/src/shared/fleet-settings-store.ts`) writes `autoDispatch`, `parallelAgents` and `machineOverride`. `Auto-review`, `Auto-verify` and `Auto-design` are read from `## Plot Config` (`readConfigAsync` in `fleet.ts`, `AUTO_DESIGN_KEY` in `auto-design.ts`) and nothing writes them. `plot-write-config.sh` writes the config only at adoption (`composeAdoption`), not per key. A switch that edits `CLAUDE.md` by hand breaks "The Master Agent Uses The Controllers". Decide where the three keys live (the existing settings store, or the config file through a domain-owned write) and say which in the PR. Whatever you choose, the route goes through the controller gate, the controller calls the domain, and the domain owns the port.

**The held-group notice is a domain property.** A group that a switch holds back names it in its own header, for example `Queued (3) · auto-dispatch off · start ›`. Compute the sentence's parts in the domain, from the switch readings and the group, and assert them in a unit test.

**Layering rule.** controller → domain → port ← adapter. A controller never spawns. The spawn ratchet (`ci.yml`, `allowed=28`) fails when direct `spawn`/`execFile` sites outside `adapters/` grow. Do not add one.

**Style.** Every function you write is an arrow (`export const f = (…) => …`). Leave the board's existing `function` declarations alone. Name nothing `Wave` where it means `Slice`. An Agent is the actor, a Worker is its process. TSDoc states what an export does and how it fails, and keeps its argument for the commit message.

### Done when

The plan's `## Done when` list is not present; the plan's Changelog and its *Approach* bullets are the specification. In order:

- The You, Work items and Fleet sections render their rows in the seven columns, in that order. DO appears under You only.
- Each cell links to the target in the design's *Links by Row* table. Assert the targets for slice-queued, slice-being-built, slice-at-a-gate, slice-stuck, PR-with-no-plan and agent in a domain unit test. A test that checks only the slice-at-a-gate row passes with every other row wrong.
- No row shows a pid, a manifest count, a synthesized-row count or a desk path outside the details popover. Assert it in a browser test with the strings from the measurement above ("4 manifests", "pid 99253" as fixtures), because a grep of the source cannot see a string composed at run time.
- The four auto switches sit in the Fleet header. Each writes its key through a controller, and each one's write is asserted at the controller, not by clicking.
- At 320 px the tab has no horizontal scroll. Assert `scrollWidth <= clientWidth` on the tab in a browser test; a screenshot cannot catch a 1 px overflow.
- `rows.tsx` holds none of the replaced code.

Plus: the board artifact is not committed (`scripts/check-no-bundle-diff.sh`; `main` builds it). Add a changeset for `@plot-pm/board`, description first and the `bumps:` and `plan:` block last (`plan: docs/plans/2026-11-08-rows-share-seven-columns-and-link.md`). Run `scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. Do not run `test:board` while the operator's board is open.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file. If it does, remove an equal number of shell lines in the same change, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

Left to you, by the plan: which existing browser tests become unit tests, and how a link scrolls to and highlights its target. Many of the 90-odd tests under `packages/board/test/integration/` read the old rows (for example `stuck-rows`, `slice-status-speaks-verdict`, `working-shows-every-agent`, `delivery-tab-sections`). Run the whole related set the local checks print. A test you delete must have its assertion moved to a unit test, not dropped.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Do not run `gh pr create`. After it opens, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `packages/board/src/app/lib/agent-rows/**`, `packages/board/src/app/components/AgentList.tsx`, `FleetControls.tsx` and the Delivery tab's other components; `packages/domain/src/rules/delivery-placement.ts` and the new domain files beside it; the fleet-controls route in `packages/board/src/server/fleet-settings.ts`, with `packages/fleet/src/shared/fleet-settings-store.ts` where the switch keys live; and the tests that read those.

Branches in flight, checked on 2026-11-10 against origin/main: `feature/a-merged-pending-check-is-asked-again`, `feature/one-pr-reader-per-machine-and`, `feature/state-branch-setup`, `bug/pr-and-issue-reads-still-use` and `bug/the-host-reads-a-pr-conversation` touch none of the files above. Plan 3 (`tickets-for-the-release-and-loose`) has no branch yet; it owns the tracker reads, the ticket counts on the release line and the release and delete controllers, so build none of them here.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
