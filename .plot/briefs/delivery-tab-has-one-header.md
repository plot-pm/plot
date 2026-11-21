## Implementation brief — delivery-tab-has-one-header (wave 1: Header)

- **Plan (canonical):** `docs/plans/2026-11-20-delivery-tab-has-one-header.md` on `main`
- **Approved:** 2026-11-20, Jan Wloka, plan-PR #3583 merged
- **Branch:** `feature/delivery-tab-has-one-header` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention (`Review: pr`)

Plan 4 of 7 in the sprint "Delivery UI Polish", wave 1 of 2. Both slices it waits on are merged: `feature/every-delivery-section-folds` (#3587, the reachability rule) and `feature/delivery-tuples-in-every-row` (#3593, link tuples). `feature/delivery-header-release-group` (wave 2) waits on this slice, and so do plan 3's `feature/folded-sections-summarise-visually` and plan 5's Fleet slice. Build the frame and four groups; leave the Release group's content to wave 2.

### What to build

The tab header holds three widgets today: `TodoList`, `ReleaseCard` or `SprintCard`, and `FleetCard`, in `data-tab-header` (`AgentList.tsx`, search `data-tab-header-column`). The sections below show the same subjects again, and two of the widgets are controls that look usable and are not: the dimmed "Approve release" line and the read-only copy of the fleet switches in `FleetCard`. This slice replaces `TodoList` and `FleetCard` with one card of five groups (Release, You, Work items, Fleet, Machine) that never folds, built from a domain function `deliveryHeader`. Until wave 2 merges, the existing `ReleaseCard` or `SprintCard` (with its `ReleaseApprove`) renders in the Release group's place inside the new frame, so the release button stays reachable after the `todoList` "Approve release" line leaves. The plan is canonical; this brief records what not to re-derive.

Line numbers in the plan are stale: `AgentList.tsx` moved by about 70 lines after #3587 and #3593. Find code by symbol, not by the plan's `file:line`.

### Settled decisions — do not re-derive them

- **The header ignores Mine, and the agents are the second leak.** `mappingInput` in `AgentList.tsx` passes `agents: ownAgents`, which `agentsForReader` narrows by Mine. That list drives `live` in `placeDelivery`, so being built against queued, the agent-died and merge-conflict You cases, and the Fleet circles all change with Mine. The header calls `deliveryMapping({ ...mappingInput, rows: <scope-filtered rows>, agents: fleet.agents ?? [], mode: 'all' })`, as `releaseCardsOf` and `sprintCardViewOf` already do for rows. The scope's narrowing comes from `filteredRows`, not from Mine. Rejected: reading the existing `placement`, because it is Mine-narrowed (panel rounds 2 and 3 found this twice). The test is the plan's: a board unit test in `packages/board/test/unit/` feeds the header's view function `MineMode` `all`, `mine-and-unknown` and `mine` over one fixture and asserts equal facts, and the fixture includes an agent that `agentsForReader` drops. Without that agent the test passes on the leaky implementation.
- **Reuse `youHeader`/`youHeaderOf` for the You counts.** `youHeaderOf` is already called in `AgentList.tsx` for the section's own heading; the header takes its counts from the same function over the `all`-mode placement, not from a second count. `todoListOf` loses its only caller. `todoList` and `reasonVerb` keep their other callers, so delete neither.
- **A release approval counts as red only when it can run** (operator decision 2026-11-20, fix #3594 merged). `youHeader` follows `releaseTodoEntries`; the header's unit test asserts both cases: approvable counts red, not approvable stays a grey line with its reason and adds nothing to the red number.
- **Unread is never zero.** `placeDelivery` puts an item it cannot read and an agent with no group in `unplaced` with reason `unread`. Where `unplaced` holds such entries, a group shows its numbers plus an amber "! N not read" and never its clear form. `subject: 'agent'` counts under Fleet; `subject: 'item'` counts under both You and Work items. A unit test per group, with and without unread entries.
- **Fleet reads `fleet.supervisor` as an input value, not a port.** `deliveryHeader` takes the verdict's `state` and `label` (`supervisorVerdict`, `supervisor-reading.ts`). `down` and `died` read "fleet stopped", `unknown` reads "fleet state unknown", marks still shown. `up` with a stale tick reads the verdict's own label in the unread kind. An absent field reads "fleet not read yet". A stopped fleet never reads as `idle` with zeros, which is what `fleetCard` does today. Clear form: "✓ no agent runs" only where `fleetCard` counts no agent in any group. Unit tests for each of the four `SupervisorState` values, the stale `up` and the absent field.
- **Fleet marks are read-only text, not switches.** ✓ on / – off for dispatch, review, verify, design, plus the parallel-agents value as a number. The real switches stay in the open Fleet section. `FleetCard.tsx` leaves, and so do the `readOnly` branches of `AutoDispatchSwitch`, `AutoSwitch` and `ParallelAgentsStepper` in `FleetControls.tsx`, whose only caller is `FleetCard`. Check with a grep that no other caller exists before you delete a branch. Plan 5 moves the real switches into the section body and waits on this slice.
- **Machine meters follow `machineHealth`'s buckets.** A split host shows GraphQL and REST (`graphql`, `core`). A one-pool host has bucket `''`, which `bucketLabel` names nothing, and shows one meter labelled "API". An absent split bucket reads `machineHealth`'s own word "not recorded". A null `load1` or `cores` reads "not measured". A unit test covers the one-pool host; a naive loop over the buckets renders an empty label for it.
- **"open ›" and the triage link use plan 2's jump.** The shared jump (`jump` in `AgentList.tsx`, `anchorOwner` in `delivery-view.ts`) opens the section and persists the fold state before it scrolls. Targets are `delivery-section-<key>` and `TICKETS_ANCHOR`. Do not write a second scroll helper.
- **Retry is dropped.** No group offers Retry. An unread You clause shows the age of the last good rows from `issueAgeSeconds` through `issueNote` where it is not `null`.
- **Words move out of `.tsx`.** `STATE_WORDS` (`FleetCard.tsx`) and `SEGMENT_WORD`/`SEGMENT_CLASS` (`SprintCard.tsx`) move into the domain view or a shared module that the remaining importers (`ReleaseCard.tsx`, `ReleasePersonCards.tsx`, `ReleasePlanParts.tsx`, `unit/release-plan-parts.test.ts`) read. `SprintCard` stays until wave 2, so keep its export working. No new `.tsx` word map.
- **Rule carried over:** absent is not false. An absent `fleet.supervisor` is "not read yet", not "stopped". A missing tickets reading (`null`) is "tickets unread", not 0.

### Unresolved: the finished-worktrees count has no reading in the payload

The plan's Notes add a grey "N finished worktrees" count to the Fleet group, from the reaper's verdict (`reap()`, reconcile section 21). The plan also says the header reads only fields the payload carries. The payload has none for this: `schema.ts` carries `worktrees: {branch, path}[]` (about line 635) and `desk: boolean`, and no reaper verdict. `reapable.ts` and the `reap` entry in `packages/board/src/server/entry/` answer per tree from readings the server does not take on the payload path today. Do not write a second rule for "finished", and do not run `git`/host calls from the header. Build everything else first. For the count, read what the payload gives; if a new payload field or server read is required, stop that item, write `PLOT-BLOCKED` naming the missing reading, and let the plan be amended. The four unit tests the plan names (zero, finished, a dirty desk, a claimed desk) belong with the rule once its input exists.

### Done when

The plan has no `## Done when` section; the *Approach* bullets for both slices and the *Board tests* bullet are the specification. Assertions that exist because a naive implementation would pass without them:

- The `MineMode` equality test with an agent `agentsForReader` drops. Catches a header that reads `ownAgents`.
- A domain test that the `release` and `my-sprint` scopes give different facts for You and Work items, and the same Fleet and Machine facts. Catches a scope that narrows the whole machine.
- A test per group for clear, unread and stopped, each asserting the amber "! N not read" is present and the clear sentence is absent. Catches an unread item that reads as a calm zero.
- `supervisor` absent, stale `up`, `down`, `died`, `unknown`. Catches `fleetCard`'s idle-with-zeros for a stopped fleet.
- A browser test that clicking "open ›" on a folded section opens it and puts `data-link-target` on the target. Catches a jump that scrolls before the anchor mounts.
- A browser test that the header does not fold and has no `aria-expanded`. Catches a header wrapped in the section frame.
- Rewrite, do not delete, the tests the plan lists for slice 1: `delivery-tab-header.browser.test.ts`, `release-approve.browser.test.ts` (the `[data-todo-name]` "Approve release" click goes; the card-position assertion stays), `unit/delivery-link-icons.test.ts` (the `TodoList` case becomes the You group), `delivery-fleet-look.browser.test.ts`, `fleet-settings.browser.test.ts` (the assertions move to the Fleet section's real switches), `delivery-tab-sections.browser.test.ts`, `delivery-tab-screenshots.browser.test.ts` (it reads `--delivery-section` from `[data-tab-header]`), `unit/fleet-card.test.ts` and `unit/todo-list-markup.test.ts`. Re-grep for the old `data-todo-name`, `data-tab-header-column` and `FleetCard` selectors; a stale selector makes a test pass by finding nothing.
- The count gate: `EXPECTED_FILES` and `EXPECTED_TESTS` in `packages/board/test/integration/stubbed-tests-start-no-board.test.ts`. #3587 and `feature/delivery-section-empty-kinds` also move them, so read the current values after you merge `main`, and record this slice's delta and reason as #3575 did.

Plus: run `pnpm build:board` locally to test, and commit no bundle (`scripts/check-no-bundle-diff.sh` refuses one). Add a changeset for the board with the description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file; if that changes, `scripts/check-shell-lines.sh` refuses growth, so pay for it in the same change. The gate counts commands, not lines, and has no override. New domain code is arrow functions with factual TSDoc; a function you only pass through stays as it is.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/rules/` for the new `deliveryHeader` (a new file) and the `STATE_WORDS`/`SEGMENT_*` move, `packages/board/src/app/components/AgentList.tsx` (the header block), `FleetCard.tsx` and `TodoList.tsx` (deleted), `FleetControls.tsx` (the `readOnly` branches), `SprintCard.tsx` (the word export only), `packages/board/src/app/styles/delivery-header.css`, `packages/board/src/app/lib/agent-rows/` for the header's view function, and the tests listed above.

In flight, verified at dispatch on 2026-11-21:

- `feature/delivery-section-empty-kinds` is on origin (about 660 lines across 11 files): `delivery-view.ts`, a new `section-empty.ts`, `delivery.css`, `agents-tab.browser.test.ts`, `unplanned-issues.browser.test.ts` and the count gate. Expect a conflict in `delivery-view.ts`, the count gate and `agents-tab.browser.test.ts`; keep both sides.
- `feature/folded-sections-summarise-visually` (plan 3) is not on origin and waits on this slice. It compares its folded summaries against `deliveryHeader`, so keep `deliveryHeader` a pure function of its inputs that it can call.
- `feature/delivery-header-release-group` (wave 2) waits on this slice. Leave `ReleaseCard`, `SprintCard`, `ReleaseApprove`, `releaseStatusLine` and `lastRelease` to it.
- `feature/fleet-switches-in-fleet-section` (plan 5) waits on this slice for the removal of `FleetCard`'s switches.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
