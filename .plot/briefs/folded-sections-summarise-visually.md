## Implementation brief — folded-sections-summarise-visually (wave 1: Summaries)

- **Plan (canonical):** `docs/plans/2026-11-20-folded-sections-summarise-visually.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/folded-sections-summarise-visually` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Plan 3 of 7 in the sprint "Delivery UI Polish", one slice. All four slices it waits on are merged: `feature/every-delivery-section-folds` (#3587, fold frame, summary slot, reachability rule), `feature/delivery-section-empty-kinds` (#3596, `section-empty.ts`), `feature/mine-means-mine-or-my-plan` (#3590, the `mine` rule) and `feature/delivery-tab-has-one-header` (#3607, `deliveryHeader`). `delivery-activity-has-three-signals` (plan 6) waits on this slice for the heading spinner.

### What to build

A folded Delivery section shows a header line that must be read as a sentence today ("YOU BLOCK 1 DELIVERY · 3 TO CLEAN UP"), and folding means hiding. This slice fills the summary slot that `SectionHead` already carries (`data-section-summary-slot`, `packages/board/src/app/components/SectionHead.tsx`) with a visual summary per section, each computed as a domain or view property: a five-state segment bar for Release delivery, coloured counters with an icon and a word for You, Work items and Tickets, agent circles for Fleet, near-limit chips for Machine, one amber chip for Not placed. It also puts the activity spinner beside the title of every folded section with an active hidden row. The plan is canonical, including its table of summaries and its scope × Mine table; this brief records what not to re-derive. The design spec is outside the repository: `/Users/jwloka/Quatico/Agentic-Tools/plot/docs/superpowers/specs/2026-11-20-delivery-ui-polish-design.md`, mockups `folded-headers.html` and `header-and-sections-v2.html` in the sibling directory.

Plan line numbers are stale after #3587, #3593, #3596 and #3607. Find code by symbol, not by the plan's `file:line`.

### Settled decisions — do not re-derive them

- **Summary style B.** A bar only where the section measures progress (Release delivery); counters elsewhere. A bar for You would suggest progress where there is only a to-do list.
- **The summaries follow Mine; the header does not.** `deliveryHeaderOf` (`packages/board/src/app/lib/agent-rows/delivery-header.ts`) builds its placement with every agent and mode `all`. The summaries count the rows each section shows, so they read the Mine-narrowed placement. Both count through the same functions (`fleetCard`, `machineHealth`, the placement's group counts, `youHeaderOf`). Rejected: a second count for the summaries, because the agreement test below would then compare two implementations.
- **The agreement test belongs to this slice.** A unit test asserts that `deliveryHeader`'s You, Work items and Fleet numbers equal the summaries' numbers under `MineMode` `all` over one fixture. A summary that reads `ownAgents` (Mine-narrowed) and a header that reads `fleet.agents` differ only where the fixture holds an agent `agentsForReader` drops, so include one, as #3607's test does; without it the test passes on a leaky summary.
- **Scope and Mine cells.** `DeliveryScopeKind` is `release | my-sprint`; `MineMode` is `all | mine-and-unknown | mine`, mapped to `DeliveryMine` through `MINE` in `delivery-readings.ts`. Release delivery reads `deliveryMapping({ ...input, mode: 'all' })`, so only its scope varies. Fleet and Machine take no scope; Machine takes no Mine either. Fleet's `my-sprint` cells equal its `release` cells. This slice counts the rows plan 5's filters keep and decides no ownership: do not add an ownership test. A unit test per section covers each of the six scope × Mine cells.
- **My sprint with several sprints** combines all of them (operator decision 2026-11-20): `deliveryScope` returns the active sprints the reader owns and selects.
- **Zero shows grey, an unread count shows unread, never 0.** No chip disappears because its count is zero, except Machine's amber limit chip, which shows only past its threshold. A reading that failed or is absent renders the unread form. A naive implementation renders `0` for both; assert the difference per section.
- **Empty is plan 2's, not a second rule.** Where a section is empty the summary is the `sectionEmptyKind` mark (`section-empty.ts`) with its scope and hidden count. The hidden count comes from the rows the section shows (`SectionHiddenCounts` in `delivery-view.ts`), not from a second ownership test. A scope or Mine that empties a section must never read as clear while rows exist out of view. A unit test per section's empty summary in each scope × Mine cell.
- **Release delivery bar has five states,** the five `SLICE_STATES` in `packages/domain/src/rules/slice-states.ts` (delivered, blocked, at a gate, being built, not started), plus "N plans" and a red chip when any plan is blocked. Extend `releaseDeliveryHeader`, `headerCountParts` and `headerText` in `release-plan-rows.ts`. Rejected: a three-state bar, which panel round 1 found hides blocked and not-started slices.
- **Every chip that links opens its target first.** A chip or count that jumps goes through the shared `jump` in `AgentList.tsx` (section, group, row, then scroll). No chip calls `scrollToAnchor` (`DeliveryRows.tsx`) directly: it scrolls before the anchor mounts in a folded section.
- **No new external queries.** Machine reads `headroom`, `load1`, `cores` and the host rate-limit buckets from `FleetMachineSchema` only, through `machineHealth`. The amber threshold is open: use more than 50 % used (the spec's suggestion) and record the value and the reason in the plan's Open Questions when you close it. A split host shows GraphQL and REST; a one-pool host has bucket `''` and shows one "API" meter (the same trap as in #3607).
- **Tickets** reads `ticketsSection` (`packages/domain/src/rules/tickets-section.ts`): assigned to me, others, unassigned, and the hidden-by-filter count. Plan 7 adds `◎ N delivered by the sprint` and `⚑ N found`; leave a place for them, build neither.
- **Heading spinner.** Reuse `headingPace` and `groupPace` (`activity.ts`) and `ActivitySpinner` (`marks.tsx`, #3575); `AgentList.tsx` already calls them for a section heading. Extend to Tickets and Not placed where their rows carry a pace. Plan 6 owns the activity signals as a whole; build only this spinner.
- **Rules carried over:** absent is not false (an absent supervisor is "not read yet", not "stopped"; a `null` tickets reading is "tickets unread", not 0). New words and decisions live in domain or view modules, never in `.tsx`: a view state that cannot be asserted without a browser is a property not yet extracted. New domain code is arrow functions with factual TSDoc; a function you only pass through stays as it is.

### Done when

The plan has no `## Done when` section; the *Approach* bullets and the *Board tests* bullet are the specification. Assertions that exist because a naive implementation would pass without them:

- The agreement test with an agent `agentsForReader` drops. Catches a summary that reads the Mine-narrowed agents.
- Per section, one unit test for zero (grey, present), unread (unread form, never 0) and empty (`sectionEmptyKind` mark with scope and hidden count). Catches a calm zero for a lost reading and an empty summary that hides rows out of view.
- Release delivery: a fixture with a slice in each of the five states, asserting five segments. Catches a bar that merges states.
- Fleet and Machine in both scopes assert equal summaries. Catches a scope that narrows the whole machine.
- A browser test that clicking a summary chip on a folded section opens the section and puts `data-link-target` on the target. Catches a chip that scrolls before the anchor mounts.
- A browser test that a folded section with an active hidden row shows the spinner beside its title and that an idle one does not. Catches a spinner wired to the open state only.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a board changeset with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). The count gate `EXPECTED_FILES` and `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts` moves with browser tests: read the current values after you merge `main` and record this slice's delta and reason as #3575 did; moving assertions into unit tests updates it too. Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if that changes, `scripts/check-shell-lines.sh` refuses growth, so pay for it in the same change. The gate counts commands, not lines, and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the section-summary code: new files under `packages/domain/src/rules/` and `packages/board/src/app/lib/agent-rows/` for `sectionSummary`; the summary slot's content in `AgentList.tsx` and the section components that pass `summary` to `SectionHead`; `release-plan-rows.ts` (Release delivery line); the heading-pace wiring; the delivery CSS for the summary chips and bar; and the tests above.

Leave alone: `deliveryHeader` and `delivery-header.ts` (#3607's; call them, do not change them), `section-empty.ts` (plan 2's; read `sectionEmptyKind`), the Mine filters (plan 5's), and `FleetControls.tsx`.

In flight, to verify with `git branch -r` before you start: `feature/delivery-header-release-group` (plan 4, wave 2) touches `ReleaseCard`, `SprintCard`, `ReleaseApprove` and the Release group of the header, and may touch `release-plan-rows.ts`; `feature/fleet-switches-in-fleet-section` (plan 5) touches the Fleet section body in `AgentList.tsx`. Expect conflicts in `AgentList.tsx` and the count gate; keep both sides.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
