# Delivery tab: Work items show their gates

> The Work items section groups items in flight as At a gate, Being built and Queued, shows each group's own column — gates as ✓ ⟳ ✗, progress, or what a queued item waits on — and names the agent on each item with its role chip.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:**
- **Issue:**
- **Story:** delivery-tab-reads-at-a-glance
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-11-17, Jan Wloka, plan-PR #3469 merged
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-work-items-groups`
- **Started:** 2026-11-17, Jan Wloka, `feature/delivery-work-items-gate-cells`

## Changelog

- The **Work items** header counts items at a gate, being built and queued, and names how long the oldest one waits.
- An item at a gate shows its CI and review gates as ✓, ⟳ or ✗, linked to its PR's checks and to the PR where the host gave a link (`CI ✗ · review –`).
- An item being built shows its progress (`no PR yet`, `PR open`, or `2 unpushed`); a queued item shows what it waits on (`no agent assigned`, the earlier slice, or the phase or approval another person owes).
- The **Where** column shows the PR with its branch beneath it, written in full.
- The **By** column shows the agent's role chip and name, linked to its Fleet row; a fixer adds its attempt ("1/2").

Board impact: changes the Work items section's rows in `packages/domain` and `packages/board`, and adds a per-PR fixer attempt to the fleet payload; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 3 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: one column holds "complete", "merged", "waiting on approval" and "2 complete", and no column carries a header.

The design is canonical. This plan implements its *Work Items* section and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern, and on plan 2's `feature/delivery-you-groups`, whose PR rule decides which PR is a gate here and which items You admits. The By slice waits on plan 4's `feature/delivery-agent-roles`, which builds the role chip once.

- **Header.** "<n> at a gate · <n> being built · <n> queued · oldest waits <age>", each count linking to its group. "Oldest waits" is the age of the oldest row in the section.
- **Groups:** At a gate · Being built · Queued.
- **Columns:** Kind · Item · Where · (group column) · By · Age. `ROW_COLUMNS` (`delivery-row-form.ts:13`) fixes a `status` column today; in Work items the group column takes its place. Plan 5 gives Release delivery's plan rows a column set of their own (Plan · Phase · Slices · Owner), and plan 2 gives You one; `ROW_COLUMNS` stays the set of the rows that keep it. The group column is **Gates** for At a gate, **Progress** for Being built and **Waits on** for Queued. One column holds one kind of value.
- **Gates.** The gate marks exist: `GATE_MARK` (`delivery-row-form.ts:91`) and `gateValue` (`:139`) render ✓ ⟳ ✗ for one gate per row today. The gate-cells slice extends `gateValue`, which returns one string today (CI when read, else one review mark), to return the CI and review marks as two cells, and updates `itemRowCells` (`:222`) and the tests that select the gate text: `packages/domain/test/delivery-row-form.test.ts` holds the only six such lines on `main` (`f0dfed71a`). A review nobody has asked reads `–` and stands for `review: none`; an unread gate yields a `null` cell, as the row form's rule says (`delivery-row-form.ts:215-216`). A slice PR is a gate here unless plan 2's PR rule places it under You › Blocks delivery (*Calls Made After Review*, "A PR blocks delivery; no PR is an input").
- **Gate links and the check name.** The PR index carries `ciChecks` as a summary (`green`, `pending`, `failing`, `none`, `unknown`) and no run id or check name, and `ciRun` is never set. The payload already carries the host's own links on `CardPr` (`schema.ts:292-312`): `url` for the PR and `checksUrl` for its checks page, each empty where the board does not know one. The board builds no PR address from a PR number and a repository, because that arithmetic is wrong on GitHub Enterprise and self-hosted Bitbucket. The CI mark links to `checksUrl` and the review mark to `url`; an empty value renders the mark as plain text. `prUrl` is `() => null` at `AgentList.tsx:1097`, and the gate-cells slice replaces it with a read of those two fields, which needs a new link target beside `pr` and `review` in `agent-rows/delivery-link-targets.ts` for the checks page. The `–` mark for `review: none` carries no link (`gateLinks`, `delivery-row-form.ts:228`, emits none for `none`). The failing check names exist as `failingChecks` on `entities/pr.ts`, but the PR index summary has no name for the gate; the cell shows `CI ✗` without the name. The design forbids a new host read (*Non-goals*).
- **Progress.** A row being built shows its PR state ("no PR yet", "PR open") and, where the pulse reads one, its unpushed commit count named as such ("2 unpushed"). `localAhead` (`schema.ts:2489`) counts only commits the machine holds that the remote does not, and reads 0 for a pushed branch, so Progress never calls it a branch's commit count. A count of a branch's own commits against the default branch has no reading today and stays out of this plan. `localAhead` is not part of row identity (`row-identity.ts:418`) and stays out of any key.
- **Queued.** Queued holds the slices of approved plans that have a branch or a claim and no live agent (`stage: 'building'` with no live agent and no stopped agent, and `stage: 'queued'`), and the items plan 2's You does not admit because they are another person's: their Draft or Design plans and the approvals they owe (Jan Wloka, 2026-11-16). Plan 1's slice states count a Queued slice as **being built**, so Queued holds no state of its own. Ticket rows leave Queued with plan 6's tickets slice.
- **Waits on.** "no agent assigned"; the earlier slice the server names in `AgentRow.blockedBy` (`schema.ts:3182-3195`); or, for another person's item, the phase or the approval and the person: "Draft · Max Albrecht", "plan approval · Max Albrecht", the name read through `People` as plan cards already read it (`plan-card-facts.ts`). A wait on another plan's slice shows where the server names it in `blockedBy`; the progress slice asserts that case in a unit test, and where the server names no slice the cell reads "an earlier slice".
- **A slice that has not started** (no branch, no agent) is not a row here. Plan 5's `feature/delivery-release-plan-rows` removes those rows, through `isUnbegun` (`packages/board/src/app/lib/agent-rows/row-identity.ts:77`), and gives the eligible ones today's **Start** (`dispatch`) control (`AgentList.tsx:1219`) on their To do line in Release delivery. This plan does not remove them, so Start never disappears.
- **The release row** under At a gate keeps its current form until plan 1's `feature/delivery-release-card` removes it.
- **Item** is the plan § slice, linked. **Where** is the PR, with the branch beneath it, written in full. **By** is the agent's role chip and name, linked to its Fleet row. The role chip and the role readings are plan 4's (`feature/delivery-agent-roles`, which widens `AgentRole` from six roles to eight); this plan adds the chip to the row form in `packages/domain/src/rules/delivery-row-form.ts`.
- **A fixer's attempt.** A fixer adds "<attempt>/<budget>": its attempt number on the finding kind it fixes. The payload carries only `fixerInFlight` (`schema.ts:3329`), so the By slice adds a per-PR attempt field that the server fills once per scan, for fixer rows only, from `.plot/state/fixer-attempts/<pr>.json` through `rules/fixer-attempts.ts`, against `FIXER_ATTEMPTS_BUDGET` (2, per finding kind). The `Correction budget` key is the desk's correction budget that plan 2's PR rule reads; it is not the fixer's denominator.
- **A closed PR or branch no plan names** moves to You › Unblock (plan 2's `feature/delivery-you-loose-prs`), not Queued.
- **Scope.** Mine narrows Work items; the **My sprint** scope from plan 1 applies here too (*Calls Made After Review*, "One scope rule for every section").
- **Domain first.** Every gate state, link target, progress value, waits-on value and header count is a domain property with a unit test.

### Done When

Per slice, in slice order.

- *Groups and columns:* every group in Work items shows its own column under a header, and no column holds two kinds of value; the header counts each group, each count linking to its group, and names the oldest row's age, asserted in a unit test; Queued holds approved plans' slices with a branch or claim and no live agent, and another person's Draft or Design plan and approval-owed item, asserted in a unit test; Where shows the PR with the full branch name beneath it.
- *Gate cells:* an item at a gate shows one mark per gate, CI and review, CI linked to the PR's `checksUrl` and review to its `url`, rendered as plain text where the host gave none; a review nobody asked reads `–` with no link, and an unread review renders no cell, asserted in a unit test.
- *Progress and waits:* a row being built shows "no PR yet" where it has no PR, "PR open" where it has one, and the unpushed count named as unpushed where the pulse reads one; a queued row names what it waits on: "no agent assigned", the earlier slice from `blockedBy`, or the phase or approval with the person who owes it, each asserted in a unit test.
- *Agent chips:* By shows the agent's role chip and name, linked to its Fleet row; a fixer row shows its attempt against `FIXER_ATTEMPTS_BUDGET` on the finding kind it fixes.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`, directly or through the groups slice. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- Plan 4 owns the role chip and the role readings; this plan's By slice waits on `feature/delivery-agent-roles`. Writer's call, from the round-1 panel.
- Plan 5 removes not-started slices from Work items and gives them Start; this plan only states the exclusion. Writer's call, from the round-1 panel.

### Open Questions

- [x] Which glyph in `glyphs.ts` stands for a gate nobody has asked yet ("review –")? Resolved: the gate marks live in `GATE_MARK`, not `glyphs.ts`; `–` stands for `review: none`, and an unread gate renders no cell.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology.
- Which existing browser tests move to unit tests, and which browser tests select the current columns.

## Slices

### Groups and columns

- `feature/delivery-work-items-groups` <!-- waits: feature/delivery-section-header, feature/delivery-you-groups --> — the Work items header and groups, what Queued holds, the group column in the place of `status`, and the Where column <!-- builds: Work items groups, header and column model --> → #3512

### Gate cells

- `feature/delivery-work-items-gate-cells` <!-- waits: feature/delivery-work-items-groups --> — `gateValue` returning a CI and a review mark, linked to `CardPr.checksUrl` and `CardPr.url` with the new checks link target <!-- builds: Work items gate cells with host links -->

### Progress and waits

- `feature/delivery-work-items-progress` <!-- waits: feature/delivery-work-items-gate-cells --> — the Progress cell (PR state, unpushed count) and the Waits on cell (no agent, earlier slice, another person's phase or approval) <!-- builds: Work items progress and waits-on cells -->

### Agent chips

- `feature/delivery-work-items-by-chips` <!-- waits: feature/delivery-work-items-progress, feature/delivery-agent-roles --> — the By column with the agent's role chip, name and Fleet link, and a fixer's attempt count <!-- builds: a By cell with role chip and fixer attempt -->

## Notes

- Created by `/plot-idea` in one batch with plans 1, 2 and 4 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "gate glyphs" and "agent role chip" found no artifact of that name. The gate marks exist as `GATE_MARK` and `gateValue` in `delivery-row-form.ts`, which the gate-cells slice extends.
- Plans 1 and 5 wait on `feature/delivery-work-items-groups`, because they need the groups and not the gate cells.
- Slices in one plan run in heading order: a slice is eligible once every earlier slice has merged.
- Amended after the round-1 panel, 2026-11-16: the role chip belongs to plan 4, the not-started exclusion and Start belong to plan 5, and both slices carry their waits.
- Amended after the round-2 panel (`.plot/panels/delivery-work-items-show-gates/r2-panel.md`) and Jan Wloka's decisions, 2026-11-16: the gates slice is split into groups, gate cells, and progress with waits; another person's Draft or Design plans and approvals stay in Queued with Waits on naming the phase or approval and the person.

## Open Points

Round 1, panel of four lenses, all `amend` (`.plot/panels/delivery-work-items-show-gates/panel.md`).

- [x] [Estate] The gate marks exist in `GATE_MARK` and `gateValue`, and `glyphs.ts` holds kind icons only. Resolved: the gate-cells slice extends `gateValue`; the glyph question moves to `GATE_MARK`; the Notes line is corrected.
- [x] [Contradiction] `–` for a review nobody has asked conflicts with the row form's rule that an unread fact yields a `null` cell. Resolved: `–` stands for `review: none`, and `unread` renders nothing.
- [x] [Estate, Contradiction, Deliverable] The role chip has two owners. Resolved: plan 4's `feature/delivery-agent-roles` builds it and widens `AgentRole`; this plan's By slice waits on it.
- [x] [Estate, Deliverable, Cost] Four readings are not in the payload. Resolved in round 2: the marks link to `CardPr.url` and `checksUrl`; the check name is a named gap with no new host read; plan 4 builds the agent role reading; the fixer attempt comes from the fixer-attempts record; Progress names the unpushed count as unpushed.
- [x] [Estate, Cost] The fixer's denominator has two sources. Resolved: By shows the attempt on the finding kind in flight against `FIXER_ATTEMPTS_BUDGET`; the `Correction budget` key stays plan 2's.
- [x] [Contradiction] Queued holds tickets, Draft and Design plans and approval-owed items today. Resolved (Jan Wloka, 2026-11-16): another person's Draft or Design plans and the approvals they owe stay in Work items › Queued, with Waits on naming the phase or the approval and the person; tickets leave through plan 6.
- [x] [Estate] Removing not-started slices from Work items removes today's Start control. Resolved: plan 5's plan-rows slice removes those rows through `isUnbegun` and puts Start on the eligible To do lines in Release delivery.
- [x] [Contradiction, Cost] No `waits:` on plan 2's PR rule or plan 1's release-row removal. Resolved: the groups slice waits on `feature/delivery-you-groups`; the release row keeps its current form until plan 1's release-card slice removes it.
- [x] [Deliverable] Done When checks neither the role chip, the header counts, Progress, Waits on nor Where. Resolved: Done When has a line for each, per slice.
- [x] [Contradiction, Cost] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only.
- [x] [Not verified by any juror] Whether the fixer-attempts record carries a count, whether CI run ids exist, whether fixers are registry entries, and which browser tests select the columns. Resolved: the record holds one attempt entry per start, per finding kind (`entities/fixer-attempts.ts`); no CI run id or check name is on the index (`ciChecks` is a summary); the fixer role reading is plan 4's; the browser tests are the builder's.

Round 2, panel of four lenses, all `amend` (`.plot/panels/delivery-work-items-show-gates/r2-panel.md`).

- [x] [Estate, Cost, Deliverable] The round-1 `prUrl` resolution builds a PR address from a number and a repository, which `schema.ts:292-303` forbids. Resolved: the marks link to `CardPr.checksUrl` and `CardPr.url`, plain text where empty; the checks link needs a new link target.
- [x] [Estate, Contradiction] `local_ahead` counts unpushed commits, so it is no commit count for a pushed branch. Resolved: Progress shows "no PR yet", "PR open" or the unpushed count named as such; a branch commit count stays out of this plan.
- [x] [Contradiction] `review –` cannot be "linked" (`gateLinks` emits no link for `none`). Resolved: the `–` mark carries no link, and Done When says so.
- [x] [Deliverable, Contradiction] `ROW_COLUMNS` fixes a `status` column that the per-group column must reconcile with, and `gateValue` returns one string. Resolved: the group column takes the place of `status` in Work items, and `gateValue` returns two marks. Release delivery's plan rows take plan 5's column set, which corrects this plan's earlier "Release delivery rows keep `ROW_COLUMNS`".
- [x] [Cost] The payload carries `fixerInFlight` only, so the fixer's attempt count needs a field. Resolved: the By slice adds a per-PR attempt field, read by the server once per scan for fixer rows.
- [x] [Estate, Contradiction, Deliverable, Cost] Citation drift: `:221` should be `:215-216`; `isUnbegun` is in the board package. Resolved in the Design section.
- [x] [Deliverable, Cost] The gates slice carries six deliverables and sits on the critical path of plans 1 and 5. Resolved: it is split into `feature/delivery-work-items-groups`, `feature/delivery-work-items-gate-cells` and `feature/delivery-work-items-progress`; plans 1 and 5 wait on the groups slice only, which shortens their path.
- [x] [Not verified by any juror] How many existing tests select `CI ✓` text, and whether `blockedBy` derives from the `<!-- waits: -->` marker. Resolved: one test file, `packages/domain/test/delivery-row-form.test.ts`, holds the six gate-text lines on `main`; Waits on reads `blockedBy`, the earlier slice the server names (`schema.ts:3182-3195`), and the progress slice asserts the cross-plan case in a unit test, so whether the server reads the marker is settled while building.

<!-- CHALLENGE-THE-PLAN-METADATA
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
