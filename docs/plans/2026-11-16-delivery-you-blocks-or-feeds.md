# Delivery tab: You shows what blocks delivery and what feeds the fleet

> The You section groups what waits on the reader as Blocks delivery, Input to the fleet and Unblock, shows one row per plan with its slice count and open questions, holds loose ends with Release and Delete, and counts tickets instead of listing them.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- The **You** section shows three groups: **Blocks delivery** (red), **Input to the fleet** (blue) and **Unblock** (grey, "clean up"). The group says why a row is the reader's, so no reason sentence repeats down a column.
- Plan and spike approvals, a PR to review, a delivered plan to test, a `PLOT-BLOCKED` question, a spent fixer budget, a conflict no agent owns and a slice whose agent died move to **Blocks delivery**.
- A plan shows as one row with a chip for its slice count, a chip for its open-question count, and its first open question with a "+n more" link.
- A PR sits under **Blocks delivery** when its HIGH finding or failed CI has spent the `Correction budget`, or when its CI passed and the repository does not declare `Auto-review: true`.
- **Unblock** also holds a closed PR whose branch still exists and no plan names, with **Release** and **Delete**, as a loose branch already has.
- You shows the same rows in every Mine mode: it always means the reader.
- The You header counts each group and the tickets to triage, and carries the phase strip `Discovery n ─▶ Design n ─▶ Handed to fleet n`.

Board impact: changes the You section's grouping rule, readings and rows in `packages/domain` and `packages/board`, and adds an open-question count to the plan payload; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 2 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: "a ticket is assigned to you and no plan names it" repeats about 30 times, "a draft plan needs your input" repeats under every slice of a draft plan, and 30 ticket rows push the two draft plans that need the developer out of view.

The design is canonical. This plan implements its *You* section, the first point of *Changes to the 2026-11-08 Design* (You's groups), and the *Calls Made After Review* points listed below. It does not restate them. The third point (tickets leave You) ships with plan 6's Tickets section, which this plan waits on.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern, and on plan 6's `feature/delivery-tickets-section`, which moves the ticket rows out of You into the Tickets section in one change. Plan 1's to-do list reads the markers this plan's first slice decides.

- **Three groups in the placement rule** (`packages/domain/src/rules/delivery-placement.ts`), in this order: **Blocks delivery**, **Input to the fleet**, **Unblock**. *Review a result* folds into Blocks delivery, and Unblock holds loose ends only (*Changes to the 2026-11-08 Design*). Every `YouReason` (`delivery-placement.ts:125-137`) maps to one group:

  | `YouReason` | Group | Marker |
  |---|---|---|
  | `draft-plan` | Input to the fleet | input |
  | `plan-approval`, `spike-approval` | Blocks delivery | blocks delivery |
  | `release-approval` | Blocks delivery, until plan 1's `feature/delivery-release-card` removes the row | blocks delivery |
  | `test-delivered-plan` | Blocks delivery | blocks delivery |
  | `review-pr` | Blocks delivery | blocks delivery |
  | `blocked-marker` | Blocks delivery | blocks delivery |
  | `fleet-stuck` | Blocks delivery | blocks delivery |
  | `merge-conflict` | Blocks delivery | blocks delivery |
  | `agent-died` | Blocks delivery | blocks delivery |
  | `loose` | Unblock | clean up |
  | `ticket-assigned` | no You row (plan 6 has moved it to Tickets) | — |

- **The PR rule** (*Calls Made After Review*, "A PR blocks delivery; no PR is an input"), written as the change to `youCase` (`delivery-placement.ts:210-217`):
  - The **Correction budget** arm keeps today's `fleet-stuck` case whole: `gateUnpassable`, or a failed CI or a HIGH review with `corrections >= Correction budget`. It moves from Unblock to Blocks delivery.
  - The **Auto-review** arm keeps today's guard: a PR with `ci === 'passed'` and a review `pending` or `none`, where the repository does not declare `Auto-review: true`. A PR whose CI runs or failed stays a gate under Work items. See the open question below.
  - The **unanswered person comment** arm has no reading. `humanCommentOpen` (`rules/human-comment-open.ts`) exists, but only `workflows/merge.ts` and fleetd's `auto-merge.ts` call it, after a fresh host call; `PrReading` holds `ci` and `review` only, and the PR index carries no conversation field. The design forbids a new host read (*Non-goals*). This plan builds the other two arms and records this arm as a gap; see the open question below.
  - Otherwise a slice PR is a gate under Work items, and "a PR that needs a decision" leaves the Input group.
- **Markers.** Blocks delivery is red, Input to the fleet blue, Unblock grey and labelled "clean up" (*Calls Made After Review*, "Unblock rows carry a third marker"). The marker is a field of the placement, and plan 1's to-do list reads it.
- **Group-keyed tables.** `holdersOf` (`delivery-row-form.ts:381-395`, which ties `autoReview` and `autoVerify` to `review-a-result`), `REASON_DO`, `REASON_STATUS` and the group labels and reason words in `delivery-view.ts:32-56` change with the fold. The `loose` row's Do cell changes from `plan ›` to "Release · Delete".
- **You ignores Mine.** You places an item only when its `ownership === 'mine'`, in every Mine mode; the `mineAllows(input.mine, …)` gate at `delivery-placement.ts:337` no longer applies to You (*Calls Made After Review*, "You always means the reader"). Plan 1's **My sprint** scope narrows You to what waits on the reader in their sprint.
- **Closed PRs.** Today `delivery-readings.ts:128` drops a closed PR before placement. The groups slice keeps a closed PR whose branch still exists and no plan names (`LooseReading.named` false), and places it under Unblock with **Release** (the `release-claim` controller) and **Delete** (the `loose-delete` controller, `LooseDeleteButton.tsx`). A closed PR on a branch a plan's slice names keeps today's reading: it is not loose, `loose-delete` refuses it as `named` (`rules/loose-delete.ts:103`), and `a-deferred-slice-keeps-its-branch` relies on that refusal. A loose branch with no PR already shows both buttons (`AgentList.tsx:1165-1172`); that stays.
- **Header.** "<n> block delivery · <n> inputs the fleet waits for · <n> to clean up · <n> tickets to triage". Each group count links to its group; the ticket count links to the Tickets section, which exists because the groups slice waits on plan 6's tickets slice.
- **Phase strip.** `Discovery n ─▶ Design n ─▶ Handed to fleet n` from the 2026-11-08 design (`2026-11-08-delivery-tab-design.md:67`), which no code builds yet. Discovery counts the reader's tickets with no plan and the stories no plan answers, from the story reading the Discovery tab already takes (`/api/stories`); Design counts the reader's plans in Draft or Design; Handed to fleet counts the reader's approved plans. Each count links to its items. The strip has its own slice.
- **Columns:** Kind · Item · Status · Do · Age, as a column set of its own for You; `ROW_COLUMNS` (`delivery-row-form.ts:13`) stays the set of the other sections. **Status** holds the item's state ("Draft · not interrogated", "loose · no plan, nobody works on it"); **Do** holds the verb with `›`, and Unblock rows hold "Release · Delete". No BY column: every row is the reader's.
- **One row per plan.** A plan in Draft or Design is one row. `nestItems` (`agent-rows/delivery-view.ts:113-132, 240-262`) keeps Draft items out of the nesting today (`item.draft !== null`, `:248`), which causes the measured repetition; the plan-rows slice removes that exception for You. The row carries a slice-count chip from `planSliceCount` (`schema.ts:2294-2310`), an open-question chip, and the first open question with a "+n more" link. Its slices do not show as rows here.
- **Open-question count.** No parser reads a plan's open questions today. The plan-rows slice adds a plan-parser fact next to `planSliceCount`: the unchecked `- [ ]` items under the plan's `### Open Questions` and `## Open Points` headings, as a count and the first item's text.
- **Domain first.** Every group, marker, chip count, header count and Status value is a domain property with a unit test.

### Done When

- No reason sentence repeats down the Status column; the group carries the reason.
- Every `YouReason` places in the group the table names, each asserted in a unit test.
- Each row carries its marker (blocks delivery, input, clean up), asserted in a unit test.
- The Correction budget arm and the Auto-review arm each place a PR under Blocks delivery; a PR with neither places under Work items; a PR with no passed CI and Auto-review off places under Work items, each asserted in a unit test.
- You shows the same rows in every Mine mode, asserted in a unit test.
- A closed PR whose branch still exists and no plan names shows under Unblock with Release and Delete, both calling their controllers; a closed PR on a named slice branch does not.
- A draft plan with five slices shows as one row with "5 slices", its open-question count and its first open question.
- You's rows show the columns Kind · Item · Status · Do · Age under headers.
- The You header counts each group and the tickets to triage, each count linking to its target, and the phase strip counts Discovery, Design and Handed to fleet.
- No ticket row shows under You.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- This plan owns the You marker per row; plan 1's to-do list reads it. Writer's call, from the round-1 panel.
- The ticket rows leave You in plan 6's tickets slice, and this plan waits on it, so a ticket shows on exactly one row at every merge. Writer's call, from the round-1 panel and the design goal "Every work item and every agent still shows once".

### Open Questions

- [x] Until plan 6 ships the Tickets section, where does the header's ticket count link? Resolved: the groups slice waits on `feature/delivery-tickets-section`, so the section exists when the count ships.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology.
- Which existing browser tests move to unit tests. `delivery-placement.test.ts` names the old group ids 18 times, and six board tests import the rule, including `ticket-input-to-the-fleet.browser.test.ts`, which plan 6's tickets slice changes.

## Slices

### Groups and markers

- `feature/delivery-you-groups` <!-- waits: feature/delivery-section-header, feature/delivery-tickets-section --> — the placement rule's three You groups with their markers and the `YouReason` table, the PR rule's two arms, You ignoring Mine, closed PRs on unnamed branches under Unblock, the group-keyed tables, and the You header counts <!-- builds: You groups Blocks delivery, Input to the fleet and Unblock with markers and the PR rule -->

### Plan rows

- `feature/delivery-you-plan-rows` <!-- waits: feature/delivery-you-groups --> — one row per plan with slice-count and open-question chips and the first open question, the plan-parser open-question fact, the Kind · Item · Status · Do · Age columns, and Release · Delete on closed-PR Unblock rows <!-- builds: a one-row plan form and a column set for You -->

### Phase strip

- `feature/delivery-you-phase-strip` <!-- waits: feature/delivery-you-groups --> — the You header's phase strip `Discovery n ─▶ Design n ─▶ Handed to fleet n`, each count linking to its items <!-- builds: the You phase strip -->

## Notes

- Created by `/plot-idea` in one batch with plans 1 and 3 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "Blocks delivery" and "Input to the fleet" found no artifact of that name in the estate; the existing groups live in `delivery-placement.ts`, which this plan changes. The mechanisms it extends exist: `humanCommentOpen`, `fleet-stuck`, `review-pr`, `holdersOf`, `REASON_DO`, `ROW_COLUMNS`, `nestItems`, `planSliceCount`, and the loose-branch buttons at `AgentList.tsx:1165-1172`.
- Amended after the round-1 panel, 2026-11-16: placement changes sit in slice 1, slice 2 waits on it, the phase strip has its own slice, and the ticket move belongs to plan 6.

## Open Points

- [ ] [Domain] Where does the PR rule's "unanswered comment from a person" reading come from? `humanCommentOpen` exists, but `PrReading` carries no conversation and the design forbids new host reads. This plan builds the other two arms and records the gap. Question for Jan Wloka: does a PR-index field written by fleetd from the conversation reading it already takes for auto-merge count as "no new read", or does the arm stay out of the tab?
- [x] [Domain] Does a closed PR on a branch a plan's slice names get a Delete? Resolved: no. Only a closed PR on a branch no plan names goes to Unblock with Release and Delete; a named slice's closed PR keeps today's reading, and `loose-delete`'s `named` refusal stands.
- [x] [Technical] Do the two slices run in parallel? Resolved: every placement change sits in `feature/delivery-you-groups`, and `feature/delivery-you-plan-rows` waits on it and only renders.
- [x] [Domain] Which group holds each of the 12 `YouReason` values? Resolved: the table in the Approach maps each; `release-approval` stays in Blocks delivery until plan 1's release-card slice removes it, so the release never shows twice.
- [ ] [Domain] Does the Auto-review arm keep today's `ci === 'passed'` guard, and what happens to `gateUnpassable` and a failed CI with the budget spent? Resolved for `gateUnpassable` and the spent budget: both stay in `fleet-stuck` and move to Blocks delivery. Open for Jan Wloka: the design's wording places every PR under Blocks delivery when `Auto-review: true` is absent; this plan keeps the passed-CI guard, so a PR whose CI runs or failed stays a gate under Work items. Confirm or overturn.
- [x] [Domain] Does "You ignores Mine" mean `ownership === 'mine'` in every mode? Resolved: yes; the groups slice owns the change at `delivery-placement.ts:337`, and a Done When line asserts it.
- [x] [UX] Between this plan and plan 6, the reader's unplanned tickets show on no row. Resolved: plan 6's tickets slice moves the ticket rows, and this plan's groups slice waits on it.
- [x] [Technical] What is the source of the open-question chip and first open question? Resolved: a new plan-parser fact over unchecked items under `### Open Questions` and `## Open Points`, built in the plan-rows slice. The phase strip has its own slice and reads the Discovery tab's story reading.
- [x] [Scope] Changelog line 4 and Done When line 4 describe loose-branch Release and Delete, which ship today. Resolved: both now name only the closed PR, and Done When has lines for markers, columns, header counts and the Mine change.
- [x] [Technical] "Rebuild the board artifact with each slice" conflicts with `check-no-bundle-diff.sh`; the story link resolves to no file. Resolved: the rebuild is a local test only; the story is on `main` and the link resolves once this branch merges.
- [ ] [UX] The design's You header names no Unblock count, while its rule says a group's 0 count says it is empty. This plan adds "<n> to clean up", as the to-do header has it. Question for Jan Wloka: keep that count, or leave Unblock uncounted in the You header.
- [ ] [Domain] Round 2, held by all four jurors (amend): "You places an item only when `ownership === 'mine'`" (Approach, *You ignores Mine*) empties Unblock. A loose branch with no PR reads `ownership` `'unknown'` (`ownership.ts:287-288`) and so does every PR on Bitbucket (`ownership.ts:103-106`), so loose branches would fall to Work items › Queued, which the design (spec:116) and plan 3 forbid, and the release row (authored by the changesets bot) would leave Blocks delivery before plan 1's release card removes it. This reopens the [x] "You ignores Mine" point above. Question for Jan Wloka: should You admit `!== 'theirs'`, or place regardless of `input.mine` and keep each reason's own ownership test? A Done When line must then cover a loose branch with unknown ownership in every Mine mode.
- [ ] [Domain] Round 2, plan 1 reads You: its **Blocked** slice state is "the slice sits under You › Blocks delivery" and its release bar counts every team member's sprints. If You holds only the reader's items, the blocked count differs per reader. Question for Jan Wloka: is Blocked reader-relative, or does plan 1 read a reader-independent set?
- [ ] [Domain] Round 2: a closed PR under Unblock gets **Delete**, but `loose-delete` also refuses `held` (a desk, manifest or running worker), and the plan's condition names only `named` false. Which facts must a closed PR carry to place as loose (`held`, `fixing`), and does Delete show only when `held` is false? Release refuses only an open or merged PR (`releaseClaim`), so the stale comment at `AgentList.tsx:1165` is not the rule.
- [ ] [Technical] Round 2: the plan says `delivery-readings.ts:128` drops a closed PR before placement. Line 128 is `hasOpenPr` and only sets `stage`; a closed PR places in Queued today. What keeps it out of Unblock is the server's fixer read, which skips closed PRs (`fleet.ts:6626`), so `looseOf` returns `undefined` (`delivery-readings.ts:155-157`). The groups slice must name the fixer-read gate it changes.
- [ ] [Domain] Round 2: Release on a closed-PR Unblock row may always refuse, because `plot-dispatch.sh:1799` refuses a release when the origin branch carries commits that change files, and a branch that carried a PR does. Done When line 79 passes with a button that only calls its controller. Does the row show Release only when the controller would accept it?
- [ ] [Technical] Round 2: the phase strip cites `/api/stories`, which does not exist. The Discovery tab reads `Board.storyLanes` (`schema.ts:1577`) and `ticketLanes` (`rules/ticket-lanes.ts:185`). The 2026-11-08 design takes phase names from the `Workflow phases` config key (`rules/workflow-phases.ts`), and this repo declares `Development`, not "Handed to fleet". Does the strip use the config map or the three fixed labels, and does it add a fetch per poll?
- [ ] [Technical] Round 2: `planSliceCount` is a field of pulse slices (`schema.ts:2310`, `rules/pulse.ts:68`). A Draft plan with no rows carries no slice count, and `DraftPlanSchema` (`schema.ts:4315-4333`) has none. Done When line 80 tests exactly that case. Name the source (`Card.sliceSummary.slices`, `schema.ts:281-290`, or a new fact). "Slice 2 only renders" is also false: it adds a plan-parser fact and a contract field (`schema.ts:2310`, `pulse.ts:68`, `fleet.ts:4265`); name the file the parser goes into, because shell additions cost lines under `check-shell-lines.sh`.
- [ ] [Scope] Round 2: Done When line 1 holds today, because the Status cell already shows short words (`delivery-row-form.ts:107-120`). The sentence that repeats is the reason line under each row (`AgentList.tsx:1158-1163`, `REASON_WORDS` in `delivery-view.ts:44-56`), which the plan never names. A builder can pass line 1 and leave the measured repetition.
- [ ] [Scope] Round 2: Done When lines 74, 79 and 82 each split across two slices, line 83 ("No ticket row shows under You") is plan 6's deliverable, and both slices claim Release · Delete on closed-PR rows (guard at `AgentList.tsx:1167`). The changelog does not mention slice 2's column change. Assign each line and the guard change to one slice.
- [ ] [Scope] Round 2: slices 2 and 3 wait only on slice 1 and both edit the You header and rows in `AgentList.tsx`, the collision round 1 fixed between slices 1 and 2. Slice 1 is the largest and sits on the critical path for plans 1, 3 and 5, though downstream slices need only its placement rule and markers. Consider moving the closed-PR reading and header counts to a later slice.
- [ ] [Scope] Round 2, cosmetic: cited lines drifted: `holdersOf` starts at `delivery-row-form.ts:378` (plan: 381), the draft exception is at `delivery-view.ts:246` (plan: 248).

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
