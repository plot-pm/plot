# Delivery tab: You shows what blocks delivery and what feeds the fleet

> The You section groups what waits on the reader as Blocks delivery, Input to the fleet and Unblock, shows one row per plan with its slice count and open questions, holds loose ends with Release and Delete, and counts tickets instead of listing them.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3469 merged
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-you-groups`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-you-loose-prs`

## Changelog

- The **You** section shows three groups: **Blocks delivery** (red), **Input to the fleet** (blue) and **Unblock** (grey, "clean up"). The group says why a row is the reader's, and the reason line under each row goes away.
- Plan and spike approvals, a PR to review, a delivered plan to test, a `PLOT-BLOCKED` question, a spent fixer budget, a conflict no agent owns and a slice whose agent died move to **Blocks delivery**.
- A PR sits under **Blocks delivery** when its HIGH finding or failed CI has spent the `Correction budget`, when its CI passed and the repository does not declare `Auto-review: true`, or when fleetd recorded an unanswered comment from a person on its head.
- You shows the same rows in every Mine mode: every item that waits on the reader and is not known to be another person's.
- **Unblock** also holds a closed PR whose branch still exists and that no plan names or holds, with **Delete**.
- A plan shows as one row with a chip for its slice count, a chip for its open-question count, and its first open question with a "+n more" link. You's rows show the columns Kind · Item · Status · Do · Age.
- The You header counts each group and the tickets to triage, and carries the phase strip, named from the `Workflow phases` config key (`Discovery n ─▶ Design n ─▶ Development n` in this repository).
- The PR index carries the conversation answer fleetd already reads before an auto-merge.

Board impact: changes the You section's grouping rule, readings and rows in `packages/domain` and `packages/board`; adds an open-question count to the plan card; adds a person-comment field to the PR index, written by fleetd's PR pass in `packages/fleet`. No change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 2 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: "a ticket is assigned to you and no plan names it" repeats about 30 times, "a draft plan needs your input" repeats under every slice of a draft plan, and 30 ticket rows push the two draft plans that need the developer out of view.

The design is canonical. This plan implements its *You* section, the first point of *Changes to the 2026-11-08 Design* (You's groups), and the *Calls Made After Review* points listed below. It does not restate them. The third point (tickets leave You) ships with plan 6's Tickets section, which this plan waits on.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern, and on plan 6's `feature/delivery-tickets-section`, which moves the ticket rows out of You into the Tickets section in one change. Plan 1's to-do list and slice states read the reason table this plan's first slice decides.

- **Three groups in the placement rule** (`packages/domain/src/rules/delivery-placement.ts`), in this order: **Blocks delivery**, **Input to the fleet**, **Unblock**. *Review a result* folds into Blocks delivery, and Unblock holds loose ends only (*Changes to the 2026-11-08 Design*). Every `YouReason` (`delivery-placement.ts:125-137`) maps to one group and one marker:

  | `YouReason` | Group | Marker |
  |---|---|---|
  | `draft-plan` | Input to the fleet | input |
  | `plan-approval`, `spike-approval` | Blocks delivery | blocks delivery |
  | `release-approval` | Blocks delivery, until plan 1's `feature/delivery-release-card` removes the row | blocks delivery |
  | `test-delivered-plan` | Blocks delivery | blocks delivery |
  | `review-pr` | Blocks delivery | blocks delivery |
  | `person-comment` (new, slice 5) | Blocks delivery | blocks delivery |
  | `blocked-marker` | Blocks delivery | blocks delivery |
  | `fleet-stuck` | Blocks delivery | blocks delivery |
  | `merge-conflict` | Blocks delivery | blocks delivery |
  | `agent-died` | Blocks delivery | blocks delivery |
  | `loose` | Unblock | clean up |
  | `ticket-assigned` | no You row (plan 6 has moved it to Tickets) | — |

- **The case comes from the item; ownership decides who sees it.** `youCase` (`delivery-placement.ts:196-222`) reads the item alone, and the ownership test runs after it (`:337`). The groups slice exports the case with its group and marker, so plan 1's `feature/delivery-slice-states` counts a blocked slice the same way for every reader, and plan 1's to-do list reads the marker of a reason.
- **The PR rule** (*Calls Made After Review*, "A PR blocks delivery; no PR is an input"), as the change to `youCase` (`delivery-placement.ts:210-217`):
  - The **Correction budget** arm keeps today's `fleet-stuck` case whole: `gateUnpassable`, or a failed CI or a HIGH review with `corrections >= Correction budget`. It moves from Unblock to Blocks delivery.
  - The **Auto-review** arm keeps today's CI guard: a PR with `ci === 'passed'` and a review `pending` or `none`, where the repository does not declare `Auto-review: true`, moves to Blocks delivery. A PR whose CI runs or failed stays a gate under Work items (Jan Wloka, 2026-11-16).
  - The **person-comment** arm reads a field fleetd writes into the PR index, built in slice 5 (Jan Wloka, 2026-11-16); see *The person-comment reading*.
  - Otherwise a slice PR is a gate under Work items, and "a PR that needs a decision" leaves the Input group.
- **The person-comment reading.** fleetd's auto-merge pass already reads a PR's conversation before it merges: `mergeAt` refuses `human-comment-open` and returns the newest time it saw (`workflows/merge.ts:592-598`), and fleetd keeps the answer in memory as `conversationHolds`, keyed by PR, with the head and that time (`packages/fleet/src/shared/auto-writes.ts:59`, `auto-merge.ts:49-53, 249`). Slice 5 folds that held answer into the OPEN row of the PR index as a new optional field (`personComment: { head, at }`) through `foldPrIndex` (`rules/pr-index.ts:146`), called from `pr-refresh.ts`, the index's one writer, and moves `PR_INDEX_VERSION` from 7 to 8 (`entities/pr-index.ts:12`). It makes no new host call. The arm places a PR under Blocks delivery while the field's `head` is the row's head and the row's `updatedAt` is not later than `at`, the same test `holds()` makes in `auto-merge.ts:235`. **The index never says no**: a row with no field was never asked, and the arm then does not fire, so the PR stays where the other arms place it. A repository whose fleetd runs no auto-merge pass, and a PR whose CI never passed, carry no field; Notes names that gap.
- **Markers.** Blocks delivery is red, Input to the fleet blue, Unblock grey and labelled "clean up" (*Calls Made After Review*, "Unblock rows carry a third marker"). The marker is a field of the case.
- **The reason line goes.** The sentence that repeats is the reason line under each You row (`AgentList.tsx:1158-1163`, `reasonWords` over `REASON_WORDS` in `agent-rows/delivery-view.ts:44-59`). The groups slice removes that line; the group carries the reason, and the Status cell keeps its short state words (`REASON_STATUS`, `delivery-row-form.ts:107`).
- **Group-keyed tables.** `holdersOf` (`delivery-row-form.ts:378-395`, which ties `autoReview` and `autoVerify` to `review-a-result`), `REASON_DO`, `REASON_STATUS` and the group labels in `delivery-view.ts` change with the fold.
- **Who You admits** (Jan Wloka, 2026-11-16). You places an item whose case is not `null` and whose `ownership` is not `'theirs'` — `'mine'` or `'unknown'` — in every Mine mode. The `mineAllows(input.mine, …)` gate at `delivery-placement.ts:337` no longer applies to You (*Calls Made After Review*, "You always means the reader"). This replaces the round-1 answer "`ownership === 'mine'`", which emptied Unblock: a loose branch with no PR reads `'unknown'` (`ownership.ts:287-288`), and so does every PR where the reader's host login is not read (`ownership.ts:103-108`), which includes every Bitbucket repository. An item that is `'theirs'` goes to Work items › Queued, as plan 3 states. Plan 1's **My sprint** scope narrows You to what waits on the reader in their sprint.
- **Closed PRs.** A closed PR places in Work items › Queued today, not as loose: the server reads the fixer record only for open PRs (`withFixerInFlight`, `packages/board/src/server/fleet.ts:6622-6631`), so the client's `looseOf` returns `undefined` for a PR row with no `fixerInFlight` (`agent-rows/delivery-readings.ts:146-158`). The loose-PR slice changes the client's `looseOf`: a closed PR needs no fixer reading, because no fixer runs on a closed PR, and it reads `named` and `held` as a branch does. The domain's loose rule (`delivery-placement.ts:182-190`) stays: an item is loose only where `named` and `held` are both read false. So a closed PR places under Unblock only where its branch still exists, no plan's slice names it, and no worktree on this machine, registry manifest or running worker holds it.
- **The actions follow the controllers' refusals.** A row shows a button only where its controller would not refuse the row's own facts:
  - **Delete** (`loose-delete`, `LooseDeleteButton.tsx`) shows on a closed-PR Unblock row. `loose-delete` refuses `named` (`rules/loose-delete.ts:103`) and `held` (`:105-108`), and the placement already requires both false. It refuses `claimed` (`:112`) except where the branch holds a commit of work, its PR is closed and the host merged no PR for it, which is this row's case. It refuses `merged`, and a merged PR is delivered and never loose.
  - **Release** (`release-claim`) does not show on a closed-PR row. `release-claim` runs `plot-dispatch.sh --release`, which refuses a branch whose origin carries commits that change files (`plot-dispatch.sh:1792-1803`), and a branch that carried a PR carries them.
  - A loose branch with no PR keeps both buttons (`AgentList.tsx:1165-1173`), as today. The comment at `AgentList.tsx:1165-1166` changes to state these rules.
  - A closed PR on a branch a plan's slice names keeps today's reading: it is not loose, `loose-delete` refuses it as `named`, and `a-deferred-slice-keeps-its-branch` relies on that refusal.
- **Header.** "<n> block delivery · <n> inputs the fleet waits for · <n> to clean up · <n> tickets to triage" (Jan Wloka, 2026-11-16, for "to clean up"). Each group count links to its group; the ticket count links to the Tickets section, which exists because the groups slice waits on plan 6's tickets slice.
- **Phase strip.** The 2026-11-08 design's strip (`2026-11-08-delivery-tab-design.md:67`), which no code builds yet. It names its three phases from the `Workflow phases` config key, through the phase map the board already parses (`rules/workflow-phases.ts`, `DEFAULT_PHASE_MAP` at `:39-45`, read by `planningColumns`): the phase that holds `story:*`, the phase that holds `plan:draft` and `plan:design`, and the phase that holds `plan:approved`. In this repository they are Discovery, Design and Development. The first counts the reader's tickets with no plan and the stories no plan answers, from `Board.storyLanes` (`schema.ts:1577`) and the ticket lanes (`rules/ticket-lanes.ts:185`); the second counts the reader's plans in Draft or Design; the third counts the reader's approved plans. It reads the board payload the client already polls and adds no fetch and no route. A phase map that names no phase for a member shows that count with no name. Each count links to its items.
- **Columns:** Kind · Item · Status · Do · Age, as a column set of its own for You; `ROW_COLUMNS` (`delivery-row-form.ts:13`) stays the set of the sections that keep it. **Status** holds the item's state ("Draft · not interrogated", "loose · no plan, nobody works on it"); **Do** holds the verb with `›`, and Unblock rows hold their buttons. No BY column: every row is the reader's.
- **One row per plan.** A plan in Draft or Design is one row. `nestItems` (`agent-rows/delivery-view.ts:113-132, 240-262`) keeps Draft items out of the nesting today (`item.draft !== null`, `:246`), which causes the measured repetition; the plan-rows slice removes that exception for You. The row carries a slice-count chip, an open-question chip, and the first open question with a "+n more" link. Its slices do not show as rows here.
- **The slice count.** `planSliceCount` is a field of pulse slices (`schema.ts:2310`, `rules/pulse.ts:68`), so a Draft plan with no rows carries none. The chip reads `Card.sliceSummary.slices` (`schema.ts:281-290`, set at `board.ts:3093` for every plan that names slices).
- **Open-question count.** No parser reads a plan's open questions today. The plan-rows slice adds a domain rule in `packages/domain/src/rules/` over a plan's text: the unchecked `- [ ]` items under its `### Open Questions` and `## Open Points` headings, as a count and the first item's text. The board server calls it where it builds a Draft or Design card (`board.ts:3032-3043`, beside `rounds`), over the plan file it lists, and the card gains the two fields with their schema defaults. `plot-plan-meta.sh` does not change, so `check-shell-lines.sh` is not affected.
- **Domain first.** Every group, marker, chip count, header count, button availability and Status value is a domain property with a unit test.

### Done When

Per slice, in slice order.

- *Groups and markers:* every `YouReason` places in the group the table names, with its marker, each asserted in a unit test; the reason line under a You row is gone; the Correction budget arm and the Auto-review arm each place a PR under Blocks delivery, a PR whose CI runs or failed with Auto-review off places under Work items, and a PR with neither arm places under Work items, each asserted in a unit test; You shows the same rows in every Mine mode, a `'theirs'` item shows under Work items › Queued, and a loose branch with `'unknown'` ownership shows under Unblock in every Mine mode, each asserted in a unit test; the case and its marker are exported for plan 1.
- *Loose PRs:* a closed PR whose branch exists, that no plan names and nothing holds shows under Unblock with Delete and without Release; a closed PR on a named slice branch, and one a desk holds, does not; each button's availability is a domain property asserted in a unit test against the controller's refusals.
- *Plan rows:* a draft plan with five slices and no pulse rows shows as one row with "5 slices", its open-question count and its first open question; You's rows show the columns Kind · Item · Status · Do · Age under headers.
- *Header and phase strip:* the You header counts each group, "to clean up" and the tickets to triage, each count linking to its target; the phase strip names its phases from the phase map and counts each, asserted in a unit test with this repository's map and with the default map.
- *Person comment:* fleetd's PR pass writes `personComment` on an OPEN row from a held `human-comment-open` answer and makes no host call; a PR whose field names its head and is not older than its `updatedAt` places under Blocks delivery, and a row with no field does not, each asserted in a unit test.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`, directly or through the groups slice. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- This plan owns the case and the marker per reason; plan 1's to-do list and slice states read them. Writer's call, from the round-1 panel.
- The ticket rows leave You in plan 6's tickets slice, and this plan waits on it, so a ticket shows on exactly one row at every merge. Writer's call, from the round-1 panel and the design goal "Every work item and every agent still shows once". "No ticket row shows under You" is plan 6's Done When line.

### Open Questions

- [x] Until plan 6 ships the Tickets section, where does the header's ticket count link? Resolved: the groups slice waits on `feature/delivery-tickets-section`, so the section exists when the count ships.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology, except the `person-comment` reason and the `personComment` index field.
- Which existing browser tests move to unit tests. `delivery-placement.test.ts` names the old group ids 18 times, and six board tests import the rule, including `ticket-input-to-the-fleet.browser.test.ts`, which plan 6's tickets slice changes.

## Slices

### Groups and markers

- `feature/delivery-you-groups` <!-- waits: feature/delivery-section-header, feature/delivery-tickets-section --> — the placement rule's three You groups with their markers and the `YouReason` table, the exported case, the Correction budget and Auto-review arms, You admitting every item that is not `'theirs'` in every Mine mode, the group-keyed tables, and the reason line removed <!-- builds: You groups Blocks delivery, Input to the fleet and Unblock with markers and the PR rule --> → #3500

### Loose PRs

- `feature/delivery-you-loose-prs` <!-- waits: feature/delivery-you-groups --> — a closed PR on an unnamed, unheld branch read as loose and placed under Unblock, with Delete and without Release, and each button's availability as a domain property <!-- builds: closed PRs as loose ends under Unblock -->

### Plan rows

- `feature/delivery-you-plan-rows` <!-- waits: feature/delivery-you-loose-prs --> — one row per plan with the slice-count chip from `Card.sliceSummary`, the open-question rule and its card fields, the first open question, and the Kind · Item · Status · Do · Age columns <!-- builds: a one-row plan form, an open-question count and a column set for You -->

### Phase strip

- `feature/delivery-you-phase-strip` <!-- waits: feature/delivery-you-plan-rows --> — the You header counts with "to clean up" and the tickets to triage, and the phase strip named from the phase map, each count linking to its items <!-- builds: the You header counts and phase strip -->

### Person comment

- `feature/delivery-you-person-comment` <!-- waits: feature/delivery-you-phase-strip --> — fleetd's PR pass folding its held conversation answer into the PR index's `personComment` field at `PR_INDEX_VERSION` 8, and the `person-comment` arm placing that PR under Blocks delivery <!-- builds: a person-comment reading on the PR index and its You arm -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 and 3 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "Blocks delivery" and "Input to the fleet" found no artifact of that name in the estate; the existing groups live in `delivery-placement.ts`, which this plan changes. The mechanisms it extends exist: `humanCommentOpen`, `conversationHolds`, `fleet-stuck`, `review-pr`, `holdersOf`, `REASON_DO`, `ROW_COLUMNS`, `nestItems`, `sliceSummary`, and the loose-branch buttons at `AgentList.tsx:1165-1173`.
- Slices in one plan run in heading order: a slice is eligible once every earlier slice has merged. So slices 2 to 5 never edit `AgentList.tsx` at the same time, and each `waits:` marker names the slice before it to say so.
- Named gap: the person-comment arm fires only where fleetd's auto-merge pass has asked the conversation, which needs a PR whose CI passed and a fleetd that runs the merge arm. Elsewhere the index carries no field, and the PR places by the other two arms.
- Amended after the round-1 panel, 2026-11-16: placement changes sit in slice 1, slice 2 waits on it, the phase strip has its own slice, and the ticket move belongs to plan 6.
- Amended after the round-2 panel (`.plot/panels/delivery-you-blocks-or-feeds/r2-panel.md`) and Jan Wloka's decisions, 2026-11-16: You admits every item that is not `'theirs'`, the CI guard stays, the person-comment arm reads a PR-index field fleetd writes, the header counts "to clean up", closed PRs and their buttons follow the controllers' refusals in a slice of their own, and the phase strip reads the phase map.

## Open Points

- [x] [Domain] Where does the PR rule's "unanswered comment from a person" reading come from? Resolved (Jan Wloka, 2026-11-16): fleetd writes the conversation answer it already reads before an auto-merge into the PR index's `personComment` field, with no new host call, and the arm reads it; slice 5 builds both.
- [x] [Domain] Does a closed PR on a branch a plan's slice names get a Delete? Resolved: no. Only a closed PR on a branch no plan names or holds goes to Unblock; a named slice's closed PR keeps today's reading, and `loose-delete`'s `named` refusal stands.
- [x] [Technical] Do the slices run in parallel? Resolved: no. Every placement change sits in `feature/delivery-you-groups`, and the later slices run in heading order after it. The round-1 answer "the plan-rows slice only renders" was wrong; that slice adds a domain rule and two card fields, as the Approach says.
- [x] [Domain] Which group holds each `YouReason` value? Resolved: the table in the Approach maps each; `release-approval` stays in Blocks delivery until plan 1's release-card slice removes it, so the release never shows twice.
- [x] [Domain] Does the Auto-review arm keep today's `ci === 'passed'` guard? Resolved (Jan Wloka, 2026-11-16): yes. A PR whose CI runs or failed stays a gate under Work items; only a PR whose CI passed moves to Blocks delivery. `gateUnpassable` and the spent budget stay in `fleet-stuck` and move to Blocks delivery.
- [x] [Domain] Does "You ignores Mine" mean `ownership === 'mine'` in every mode? Reopened in round 2 and resolved (Jan Wloka, 2026-11-16): You admits every item whose ownership is not `'theirs'`, in every Mine mode; a Done When line covers a loose branch with `'unknown'` ownership.
- [x] [UX] Between this plan and plan 6, the reader's unplanned tickets show on no row. Resolved: plan 6's tickets slice moves the ticket rows, and this plan's groups slice waits on it.
- [x] [Technical] What is the source of the open-question chip and first open question? Resolved: a domain rule over the plan's text, called by the board server where it builds a Draft or Design card, in the plan-rows slice; no shell change.
- [x] [Scope] Changelog line 4 and Done When line 4 describe loose-branch Release and Delete, which ship today. Resolved: both name only the closed PR.
- [x] [Technical] "Rebuild the board artifact with each slice" conflicts with `check-no-bundle-diff.sh`; the story link resolves to no file. Resolved: the rebuild is a local test only; the story is on `main` and the link resolves once this branch merges.
- [x] [UX] The design's You header names no Unblock count. Resolved (Jan Wloka, 2026-11-16): the header adds "<n> to clean up".
- [x] [Domain] Round 2: plan 1's **Blocked** slice state reads You, so a reader-only You would make the blocked count differ per reader. Resolved: the groups slice exports the case read from the item before ownership, and plan 1 counts that, so the count is the same for every reader.
- [x] [Domain] Round 2: which facts must a closed PR carry to place as loose, and does Delete show only when `held` is false? Resolved: `named` and `held` both read false, as the domain's loose rule already requires; Delete shows on such a row, and every `loose-delete` refusal the row could meet is excluded by its facts.
- [x] [Technical] Round 2: `delivery-readings.ts:128` does not drop a closed PR. Resolved: the gate is the server's fixer read, which skips closed PRs (`fleet.ts:6626`), and the client's `looseOf`, which then returns `undefined`; the loose-PR slice changes the client's `looseOf` and leaves the server's read as it is.
- [x] [Domain] Round 2: Release on a closed-PR row may always refuse (`plot-dispatch.sh:1792-1803`). Resolved: Release does not show on a closed-PR row; a button shows only where its controller would accept the row's facts.
- [x] [Technical] Round 2: the phase strip cites `/api/stories`, which does not exist, and ignores `Workflow phases`. Resolved: the strip reads `Board.storyLanes` and the ticket lanes from the payload the client already polls, adds no fetch, and names its phases from the phase map.
- [x] [Technical] Round 2: `planSliceCount` is absent for a Draft plan with no rows. Resolved: the chip reads `Card.sliceSummary.slices`.
- [x] [Scope] Round 2: Done When line 1 holds today, because the repeating sentence is the reason line. Resolved: the groups slice removes the reason line, and its Done When line says so.
- [x] [Scope] Round 2: Done When lines split across slices, and both slices claim Release · Delete. Resolved: Done When is listed per slice; the closed-PR buttons belong to the loose-PR slice only; "No ticket row shows under You" is plan 6's line; the Changelog names the column change.
- [x] [Scope] Round 2: slices 2 and 3 collide in `AgentList.tsx`, and slice 1 is the largest on the critical path. Resolved: the closed-PR reading and the header counts move out of slice 1 into later slices, and the slices run in heading order, so no two edit `AgentList.tsx` at once.
- [x] [Scope] Round 2, cosmetic: cited lines drifted. Resolved: `holdersOf` is `delivery-row-form.ts:378`, the draft exception is `delivery-view.ts:246`, re-read on `main` at `f0dfed71a`.

<!--
CHALLENGE-THE-PLAN-METADATA
{
  "round": 2,
  "engine": "panel",
  "questionHistory": [],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": false, "architecture": true, "implementation": true},
    "domain": true,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": false
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
