# Juror: deliverable

Subject: `docs/plans/active/delivery-work-items-show-gates.md` at HEAD `a1bbe74ca`.

## Findings

### 1. The By slice's main deliverable has no Done When item (verified by reading)

The second slice's `builds:` marker reads "a By cell with role chip and fixer attempt". The Changelog line (plan:20) names the role chip, the name and the Fleet link. Done When (plan:48-51) checks only the fixer attempt (plan:50). No Done When item asks for the role chip or the Fleet link in By. A slice that adds only the attempt count passes every Done When item. Name the check, for example "By shows the agent's role chip and name, linked to its Fleet row, asserted in a unit test".

### 2. The header counts and "oldest waits" have no Done When item (verified by reading)

The Changelog (plan:17) promises a header with three counts and "how long the oldest one waits". Slice 1's prose says "the Work items header". Done When item 1 (plan:48) says only "under a header". Plan 1's `feature/delivery-section-header` (`delivery-tab-header-and-my-sprint.md:87`) builds a generic summary with "counts with their group targets" and does not name an oldest-age value. So "oldest waits <age>" belongs to this plan, and no Done When item verifies it. Also, no Done When item checks the Progress value (`4 commits · no PR yet`) or the Waits-on value (`no agent assigned`, the earlier slice). Item 1 only requires that each column holds one kind of value.

### 3. The fixer attempt depends on a reading the payload does not carry (verified by reading)

`WorkItemReading.corrections` exists (`packages/domain/src/rules/delivery-placement.ts:66`), and `DeliveryInput.correctionBudget` exists (`:116`). But the board mapper states that it sets no `corrections` "because the payload does not state them" (`packages/board/src/app/lib/agent-rows/delivery-readings.ts:254`). The row form gets no budget either: `itemRowCells(placement, facts)` (`delivery-row-form.ts:222`) receives no `DeliveryInput`, and `ItemRowFacts` (`:55-78`) has no attempt field. The payload's only fixer fact is `fixerInFlight`, which is read for planless open PRs only (`packages/board/src/contract/schema.ts:3324-3329`). The slice must add a payload reading (an attempt count from `.plot/state/fixer-attempts/<pr>.json` for slice PRs, which is not verified to carry a count) and pass the budget to the row form. The slice prose names neither. Also, `byAgents` names the cell after the first agent only (`delivery-row-form.ts:200-206`), so a fixer that is not first does not show its attempt. A builder sizing the slice from its marker underestimates it.

### 4. The gate links depend on a reading the board never sets (verified by reading)

`gateValue` and `gateLinks` read `facts.ciRun` (`delivery-row-form.ts:139-146, 228-233`). `delivery-row-facts.ts` sets `prReading`, `waitsOn` and `ageMinutes` (lines 47-52) and never sets `ciRun`. So a CI gate never links to a run at HEAD. The design's example `CI ✗ validate` also needs the failing check's name. `failingChecks` exists only on the reconcile drift row (`schema.ts:2511`), not on the agent row the Delivery tab reads. Done When item 2 (plan:49) requires "each linked to its run", so slice 1 must add a run id and a check name to the payload. Its prose and marker do not name this. Also, `gateValue` returns CI or review, never both (`delivery-row-form.ts:141-145`). The plan's "one glyph per gate" therefore changes an existing rule. That is in scope, but the slice should say so.

### 5. Both this plan and plan 4 build the role chip, and no wait orders them (verified by reading)

The subject says "The role chips are the ones plan 4 shows in Fleet; this plan adds them to the row form" (plan:40). Plan 4's `feature/delivery-fleet-agent-rows` (`delivery-fleet-rows-per-agent.md:75`) builds the role chip with eight roles (`:39`). `AgentRole` holds six of them at HEAD and lacks `design` and `verify` (`delivery-placement.ts:92`). Slice 2 waits only on `feature/delivery-section-header` (plan:74). If slice 2 lands first, it builds the chip that plan 4 claims, or it builds a six-role chip that plan 4 then extends. Add `<!-- waits: feature/delivery-fleet-agent-rows -->` to slice 2, or state which plan owns the chip and the `AgentRole` extension.

### 6. The Where column change is in no slice (verified by reading)

The Approach says that Where is "the PR, with the branch beneath it, written in full" (plan:40). At HEAD, `whereValue` joins `branch · #pr` into one cell value (`delivery-row-form.ts:190-198`), and a queued slice has no Where (`:274`). Neither slice's prose nor its marker names this change, and no Done When item checks it.

### 7. The open question names a file that holds no gate glyphs (verified by reading)

The open question (plan:59) asks which glyph in `glyphs.ts` stands for an unasked gate. `packages/board/src/app/lib/glyphs.ts:10-34` holds Octicon SVG paths keyed by item kind (ticket, plan, pr, …). The ✓ ⟳ ✗ marks are `GATE_MARK` in `packages/domain/src/rules/delivery-row-form.ts:91`. The design's own example already writes `review –` (design:111). So the question is answered, and only the file name is wrong.

### 8. Two behaviours are built by siblings, which is correct but not stated (verified by reading)

- "A closed PR or branch no plan names moves to You › Unblock" (plan:42) is built by plan 2 (`delivery-you-blocks-or-feeds.md:44`, slice `feature/delivery-you-plan-rows`).
- The **My sprint** scope over Work items (plan:43) is built by plan 1's `feature/delivery-my-sprint-scope` (`delivery-tab-header-and-my-sprint.md:99`).

This plan has no slice and no Done When item for either, and that is correct. But the Approach does not say "built by plan N", so a reader can take them for this plan's scope. The gate-or-blocks-delivery split (plan:39) is plan 2's PR rule (`delivery-you-blocks-or-feeds.md:40, 74`). No wait marker orders slice 1 after `feature/delivery-you-groups`. Slice 1 can still ship alone, because the gate rule at HEAD (`delivery-placement.ts:230-233`) already places a PR at a gate.

### 9. The not-started exclusion is built, and its Done When item is checkable (verified by reading)

At HEAD, `workGroup` places every `stage: 'queued'` item, and every `building` item with no live agent, in Queued (`delivery-placement.ts:234-237`). Slice 1 names "not-started slices out of the rows", and Done When item 4 checks it. Nothing more is needed here, except that the "no agent assigned" Waits-on value now applies only to an item that has a branch and no agent.

### Independence

Each slice can be delivered and verified alone against `feature/delivery-section-header`. Both slices edit `itemRowCells` in `delivery-row-form.ts`, so they can conflict when they merge, but neither needs the other. Only slice 2 has an unstated dependency (finding 5).

### Not verified

- Whether `.plot/state/fixer-attempts/<pr>.json` records an attempt count, or only `inFlight`.
- Whether the host listing the board reads carries a CI run id or a check name for slice PRs.
- The browser tests that select the current Work items columns.

## Position

Position: amend
