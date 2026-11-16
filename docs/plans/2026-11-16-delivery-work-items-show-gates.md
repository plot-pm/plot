# Delivery tab: Work items show their gates

> The Work items section groups items in flight as At a gate, Being built and Queued, shows each group's own column — gates as ✓ ⟳ ✗, progress, or what a queued item waits on — and names the agent on each item with its role chip.

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

- The **Work items** header counts items at a gate, being built and queued, and names how long the oldest one waits.
- An item at a gate shows its CI and review gates as ✓, ⟳ or ✗, linked to its PR's checks and review where the host gave a link (`CI ✗ · review –`).
- An item being built shows its progress (`no PR yet`, or `2 unpushed`); a queued item shows what it waits on (`no agent assigned`, or the earlier slice).
- The **Where** column shows the PR with its branch beneath it, written in full.
- The **By** column shows the agent's role chip and name, linked to its Fleet row; a fixer adds its attempt ("1/2").

Board impact: changes the Work items section's rows in `packages/domain` and `packages/board`; no change to the plan format, the template, the helper scripts or the `docs/plans` layout. A builder runs `pnpm build:board` locally to test a slice and commits no bundle: `scripts/check-no-bundle-diff.sh` refuses one, and `main` builds the bundle after the merge.

## Motivation

Plan 3 of 6 of the [Delivery tab reads at a glance design](../superpowers/specs/2026-11-16-delivery-tab-reads-at-a-glance-design.md), approved by Jan Wloka on 2026-11-16, story [delivery-tab-reads-at-a-glance](../stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md). Measured on the running board that day: one column holds "complete", "merged", "waiting on approval" and "2 complete", and no column carries a header.

The design is canonical. This plan implements its *Work Items* section and the *Calls Made After Review* points listed below. It does not restate them.

## Design

### Approach

Depends on plan 1, `delivery-tab-header-and-my-sprint`, for the section-header pattern, and on plan 2's `feature/delivery-you-groups`, whose PR rule decides which PR is a gate here. The By slice waits on plan 4's `feature/delivery-agent-roles`, which builds the role chip once.

- **Header.** "<n> at a gate · <n> being built · <n> queued · oldest waits <age>", each count linking to its group. "Oldest waits" is the age of the oldest row in the section.
- **Groups:** At a gate · Being built · Queued.
- **Columns:** Kind · Item · Where · (group column) · By · Age. `ROW_COLUMNS` fixes a `status` column today; the group column takes the place of `status` in Work items, and Release delivery rows keep `ROW_COLUMNS` unchanged. The group column is **Gates** for At a gate, **Progress** for Being built and **Waits on** for Queued. One column holds one kind of value.
- **Gates.** The gate marks exist: `GATE_MARK` and `gateValue` (`delivery-row-form.ts:91, 139`) render ✓ ⟳ ✗ for one gate per row today. The gates slice extends `gateValue`, which returns one string today (CI when read, else one review mark), to return the CI and review marks as two cells, and updates `itemRowCells` and the tests that select `CI ✓` text. A review nobody has asked reads `–` and stands for `review: none`; an unread gate yields a `null` cell, as the row form's rule says (`delivery-row-form.ts:215-216`). A slice PR is a gate here unless plan 2's PR rule places it under You › Blocks delivery (*Calls Made After Review*, "A PR blocks delivery; no PR is an input").
- **Gate links and the check name.** The PR index carries `ciChecks` as a summary (`green`, `pending`, `failing`, `none`, `unknown`) and no run id or check name, and `ciRun` is never set. The payload already carries the host's own links on `CardPr` (`schema.ts:292-312`): `url` for the PR and `checksUrl` for its checks page, each empty where the board does not know one. The board builds no PR address from a PR number and a repository, because that arithmetic is wrong on GitHub Enterprise and self-hosted Bitbucket. The CI mark links to `checksUrl` and the review mark to `url`; an empty value renders the mark as plain text. `prUrl` is `() => null` at `AgentList.tsx:1097`, and the gates slice replaces it with a read of those two fields, which needs a new link target beside `pr` and `review` in `delivery-link-targets.ts` for the checks page. The `–` mark for `review: none` carries no link (`gateLinks` emits none for `none`), and Done When says so. The failing check names exist as `failingChecks` on `entities/pr.ts`, but the PR index summary has no name for the gate; the cell shows `CI ✗` without the name unless the builder finds the names already on the row's facts. The design forbids a new host read (*Non-goals*).
- **Progress.** A row being built shows its PR state ("no PR yet") and, where one is read, a commit count. `local_ahead` (`localAhead`, `schema.ts:2489`) counts only commits the machine holds that the remote does not, and reads 0 for a pushed branch, so it is not "N commits on the branch". The commit count stays out of the first slice until a reading exists that counts a branch's own commits against the default branch; until then Progress shows "no PR yet", "PR open" or the unpushed count named as such ("2 unpushed"). `localAhead` is not part of row identity (`row-identity.ts:418`) and must stay out of any key.
- **Queued.** After this plan, Queued holds the slices of approved plans that have a branch or a claim and no live agent: `stage: 'building'` with no live agent and no stopped agent, and `stage: 'queued'`. **Waits on** reads "no agent assigned", or the earlier slice the branch's `<!-- waits: -->` marker or its slice order names. Ticket rows leave Queued with plan 6's tickets slice. Another person's Draft or Design plan and another person's approval-owed item stay in Queued as today, with Waits on naming the phase or the approval; see the open question below.
- **A slice that has not started** (no branch, no agent) is not a row here. Plan 5's `feature/delivery-release-plan-rows` removes those rows, through `isUnbegun` (`packages/board/src/app/lib/agent-rows/row-identity.ts:77`), and gives the eligible ones today's **Start** (`dispatch`) control (`AgentList.tsx:1219`) on their To do line in Release delivery. This plan does not remove them, so Start never disappears.
- **The release row** under At a gate keeps its current form until plan 1's `feature/delivery-release-card` removes it.
- **Item** is the plan § slice, linked. **Where** is the PR, with the branch beneath it, written in full. **By** is the agent's role chip and name, linked to its Fleet row. The role chip and the role readings are plan 4's (`feature/delivery-agent-roles`, which widens `AgentRole` from six roles to eight); this plan adds the chip to the row form in `packages/domain/src/rules/delivery-row-form.ts`.
- **A fixer's attempt.** A fixer adds "<attempt>/<budget>": its attempt number on the finding kind it fixes. The payload carries only `fixerInFlight` (`schema.ts:3329`), so the By slice adds a per-PR attempt field that the server fills once per scan, for fixer rows only, from `.plot/state/fixer-attempts/<pr>.json` through `rules/fixer-attempts.ts`, against `FIXER_ATTEMPTS_BUDGET` (2, per finding kind). The `Correction budget` key is the desk's correction budget that plan 2's PR rule reads; it is not the fixer's denominator.
- **A closed PR or branch no plan names** moves to You › Unblock (plan 2), not Queued.
- **Scope.** Mine narrows Work items; the **My sprint** scope from plan 1 applies here too (*Calls Made After Review*, "One scope rule for every section").
- **Domain first.** Every gate state, link target, progress value, waits-on value and header count is a domain property with a unit test.

### Done When

- Every group in Work items shows its own column under a header, and no column holds two kinds of value.
- The header counts each group, each count linking to its group, and names the oldest row's age, asserted in a unit test.
- An item at a gate shows one mark per gate, CI and review, CI linked to the PR's `checksUrl` and review to its `url`, rendered as plain text where the host gave none; a review nobody asked reads `–` with no link, and an unread review renders no cell, asserted in a unit test.
- A row being built shows "no PR yet" where it has no PR, and the unpushed commit count where the pulse reads one, named as unpushed.
- A queued row names what it waits on: "no agent assigned" or the earlier slice.
- Where shows the PR with the full branch name beneath it.
- By shows the agent's role chip and name, linked to its Fleet row; a fixer row shows its attempt against `FIXER_ATTEMPTS_BUDGET` on the finding kind it fixes.

### Settled Questions

- Every slice waits on plan 1's `feature/delivery-section-header`. Writer's call, from the design: plan 1 lays the section-header pattern every later plan uses.
- Plan 4 owns the role chip and the role readings; this plan's By slice waits on `feature/delivery-agent-roles`. Writer's call, from the round-1 panel.
- Plan 5 removes not-started slices from Work items and gives them Start; this plan only states the exclusion. Writer's call, from the round-1 panel.

### Open Questions

- [x] Which glyph in `glyphs.ts` stands for a gate nobody has asked yet ("review –")? Resolved: the gate marks live in `GATE_MARK`, not `glyphs.ts`; `–` stands for `review: none`, and an unread gate renders no cell.

### Left to the Builder

- The names of the new domain facts and their types, within the domain's terminology.
- Which existing browser tests move to unit tests, and which browser tests select the current columns.

## Slices

### Group columns

- `feature/delivery-work-items-gates` <!-- waits: feature/delivery-section-header, feature/delivery-you-groups --> — the Work items header and groups, the per-group column (Gates as ✓ ⟳ ✗ with links, Progress, Waits on), the Where column, and what Queued holds <!-- builds: Work items gate, progress and waits-on cells -->

### Agent chips

- `feature/delivery-work-items-by-chips` <!-- waits: feature/delivery-work-items-gates, feature/delivery-agent-roles --> — the By column with the agent's role chip, name and Fleet link, and a fixer's attempt count <!-- builds: a By cell with role chip and fixer attempt -->

## Notes

- Created by `/plot-idea` in one batch with plans 1, 2 and 4 to 6 of the same design. Type `feature` came from the brief; the design question was answered with the default, no, so the plan starts in Draft.
- Deliverable search for "gate glyphs" and "agent role chip" found no artifact of that name. The gate marks exist as `GATE_MARK` and `gateValue` in `delivery-row-form.ts`, which the gates slice extends.
- Amended after the round-1 panel, 2026-11-16: the role chip belongs to plan 4, the not-started exclusion and Start belong to plan 5, and both slices carry their waits.

## Open Points

Round 1, panel of four lenses, all `amend` (`.plot/panels/delivery-work-items-show-gates/panel.md`).

- [x] [Estate] The gate marks exist in `GATE_MARK` and `gateValue`, and `glyphs.ts` holds kind icons only. Resolved: the gates slice extends `gateValue`; the glyph question moves to `GATE_MARK`; the Notes line is corrected.
- [x] [Contradiction] `–` for a review nobody has asked conflicts with the row form's rule that an unread fact yields a `null` cell. Resolved: `–` stands for `review: none`, and `unread` renders nothing.
- [x] [Estate, Contradiction, Deliverable] The role chip has two owners. Resolved: plan 4's `feature/delivery-agent-roles` builds it and widens `AgentRole`; this plan's By slice waits on it.
- [x] [Estate, Deliverable, Cost] Four readings are not in the payload. Resolved: the gates slice fills `prUrl` from the PR number and the repository URL; the check name is a named gap with no new host read; plan 4 builds the agent role reading; the fixer attempt comes from the fixer-attempts record; the commit count comes from the pulse's local git reading.
- [x] [Estate, Cost] The fixer's denominator has two sources. Resolved: By shows the attempt on the finding kind in flight against `FIXER_ATTEMPTS_BUDGET`; the `Correction budget` key stays plan 2's.
- [ ] [Contradiction] Queued holds tickets, Draft and Design plans and approval-owed items today. Resolved in part: Queued holds approved plans' slices with a branch or claim and no live agent, and tickets leave it through plan 6. Question for Jan Wloka: the design says Work items holds items in flight, and is silent on another person's Draft or Design plan and another person's approval-owed item. This plan keeps them in Queued with Waits on naming the phase or the approval. Keep them there, or take them off the tab.
- [x] [Estate] Removing not-started slices from Work items removes today's Start control. Resolved: plan 5's plan-rows slice removes those rows through `isUnbegun` and puts Start on the eligible To do lines in Release delivery.
- [x] [Contradiction, Cost] No `waits:` on plan 2's PR rule or plan 1's release-row removal. Resolved: the gates slice waits on `feature/delivery-you-groups`; the release row keeps its current form until plan 1's release-card slice removes it.
- [x] [Deliverable] Done When checks neither the role chip, the header counts, Progress, Waits on nor Where. Resolved: Done When has a line for each.
- [x] [Contradiction, Cost] The Board impact line says to rebuild the board artifact with each slice. Resolved: the rebuild is a local test only.
- [x] [Not verified by any juror] Whether the fixer-attempts record carries a count, whether CI run ids exist, whether fixers are registry entries, and which browser tests select the columns. Resolved: the record holds one attempt entry per start, per finding kind (`entities/fixer-attempts.ts`); no CI run id or check name is on the index (`ciChecks` is a summary); the fixer role reading is plan 4's; the browser tests are the builder's.

Round 2, panel of four lenses, all `amend` (`.plot/panels/delivery-work-items-show-gates/r2-panel.md`).

- [x] [Estate, Cost, Deliverable] The round-1 `prUrl` resolution builds a PR address from a number and a repository, which `schema.ts:292-303` forbids. Resolved: the marks link to `CardPr.checksUrl` and `CardPr.url`, plain text where empty; the checks link needs a new link target.
- [x] [Estate, Contradiction] `local_ahead` counts unpushed commits, so it is no commit count for a pushed branch. Resolved: Progress shows "no PR yet", "PR open" or the unpushed count named as such; a branch commit count waits for a reading that counts it.
- [x] [Contradiction] `review –` cannot be "linked" (`gateLinks` emits no link for `none`). Resolved: the `–` mark carries no link, and Done When says so.
- [x] [Deliverable, Contradiction] `ROW_COLUMNS` fixes a `status` column that the per-group column must reconcile with, and `gateValue` returns one string. Resolved: the group column takes the place of `status` in Work items, and `gateValue` returns two marks.
- [x] [Cost] The payload carries `fixerInFlight` only, so the fixer's attempt count needs a field. Resolved: the By slice adds a per-PR attempt field, read by the server once per scan for fixer rows.
- [x] [Estate, Contradiction, Deliverable, Cost] Citation drift: `:221` should be `:215-216`; `isUnbegun` is in the board package. Resolved in the Design section.
- [ ] [Deliverable, Cost] The gates slice carries six deliverables and sits on the critical path of plans 1 and 5 in four shared files. Not resolved here: a person decides whether to split it into header and groups, gate cells, and Progress with Waits on, before approval.
- [ ] [Not verified by any juror] How many existing unit and browser tests select `CI ✓` text, and whether `blockedBy` derives from the `<!-- waits: -->` marker.

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
