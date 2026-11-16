# Estate juror: delivery-work-items-show-gates

Lens: does what the plan proposes already exist, and does what it depends on exist or is a sibling promising it. Read at HEAD `a1bbe74ca`.

## Findings

### 1. The gate glyphs already exist in the domain, and the plan's Notes say they do not

Verified by reading. `packages/domain/src/rules/delivery-row-form.ts:91` declares `GATE_MARK = { running: '⟳', failed: '✗', passed: '✓' }`. `gateValue` (`delivery-row-form.ts:139-146`) renders `CI ✓/⟳/✗ <run>` and `review ⟳/✗/✓`. `itemRowCells` (`delivery-row-form.ts:227-243`) puts it in the STATUS cell of a `slice-at-a-gate` row with `ci-run` and `review` link targets. The Released plan `docs/plans/2026-11-08-rows-share-seven-columns-and-link.md:39` built this, and its scope included "STATUS to the CI run or review". The plan's Notes (line 79) say a search for "gate glyphs" found no artifact. The artifact exists under the names `GATE_MARK` and `gateValue`. The plan must state that it extends `gateValue`, and it must say what changes in that function.

Two concrete gaps against the plan's example `CI ✗ validate · review –`, both verified:
- `gateValue` returns one gate only. It returns CI when CI was read, and the review only when CI is `unread` (`delivery-row-form.ts:141-145`). The plan wants both gates on one row.
- A review that is `none` or `unread` gives `null` (`delivery-row-form.ts:145`). The "review –" case is the `PrReading.review === 'none'` value (`delivery-placement.ts:40`, from `plotReview: 'absent'`, `delivery-readings.ts:122`).

### 2. The Open Question points at the wrong file

Verified by reading. `packages/board/src/app/lib/glyphs.ts:10-34` holds only Octicon SVG paths keyed by item kind: ticket, plan, pr, build, agent, branch, release, wave, story, sprint. It holds no gate state glyph. ✓ ⟳ ✗ are text characters in `delivery-row-form.ts:91`. The question "which glyph in `glyphs.ts` stands for review –" therefore asks about a table that holds no gate glyphs. The question belongs to `GATE_MARK`.

### 3. The gate links resolve to nothing today, and the payload carries no run identity

Verified by reading.
- `ci-run` resolves to `{ kind: 'none' }` (`packages/board/src/app/lib/agent-rows/delivery-link-targets.ts:71-73`).
- The tab passes `prUrl: () => null` (`packages/board/src/app/components/AgentList.tsx:1097`), so `pr` and `review` targets also resolve to none (`delivery-link-targets.ts:45-50`).
- `itemRowFactsOf` never sets `ciRun` (`packages/board/src/app/lib/agent-rows/delivery-row-facts.ts:32-55`).
- `AgentRow.pr` carries `url`, `ciChecks` and `plotReview`, but no run id, run URL or check name (`packages/board/src/contract/schema.ts`, `AgentRowSchema` from line 2623, `pr` fields from about line 2808). Failing check names exist only on `StuckSchema.failingChecks` (`schema.ts:2511`), and `checksUrl` exists only on `CardPrSchema` (`schema.ts:312`).

"Each linked to its run or review" and the name `validate` therefore need a payload reading that does not exist. No sibling promises it. The design's Non-goals and plan 4's *Readings* bullet forbid new host reads, so the plan must name which existing reading supplies the run link and the check name, or name the gap.

### 4. Role chips have no role reading to show

Verified by reading. `AgentEntrySchema` (`schema.ts:3954-4075`) has no `role` field. `delivery-readings.ts:302` maps every agent as `role: agent.role ?? 'loop'`, so every agent reads `loop` at HEAD. `AgentRole` (`delivery-placement.ts:92`) has six values: loop, fixer, reviewer, approver, idea, brief. The design and plan 4 list eight, adding design and verify (`delivery-fleet-rows-per-agent.md`, Columns). Neither this plan nor plan 4 names adding a role to the payload, or widening `AgentRole`. Not verified: whether fleetd fixers and reviewers appear as registry entries at all. If they do not, a "fixer" row in By has no agent to name.

### 5. This plan and plan 4 both build the role chip, and neither waits on the other

Verified by reading. This plan says "The role chips are the ones plan 4 shows in Fleet; this plan adds them to the row form in `delivery-row-form.ts`" (line 40). Plan 4 builds "role chip" on "the agent row form in `packages/domain/src/rules/delivery-row-form.ts`" (`delivery-fleet-rows-per-agent.md`, Approach and slice `feature/delivery-fleet-agent-rows`). Both slices wait only on `feature/delivery-section-header`. The two plans name one artifact in one file, and neither names the owner or the order. The plan must name the plan that defines the role chip, and it must make the other slice wait on that plan.

### 6. The fixer attempt has no reading in the payload, and the budget has two sources

Verified by reading. `WorkItemReading.corrections` exists (`delivery-placement.ts:66`), and `DeliveryInput.correctionBudget` exists (`delivery-placement.ts:113`). The board mapper states that it "sets no ... `corrections`, because the payload does not state them" (`delivery-readings.ts`, doc of `deliveryMapping`). `AgentRow` carries only `fixerInFlight: boolean` (`schema.ts`, about line 3329). So "1/2" needs a new payload fact, and the plan does not name it. The domain also counts attempts against the constant `FIXER_ATTEMPTS_BUDGET = 2` (`packages/domain/src/rules/fixer-attempts.ts:5`), separately per kind (`high` and `ci`, `fixer-attempts.ts:33-36`). The Done When names the `Correction budget` config key. The plan must say which denominator it shows and which kind of attempt it counts.

### 7. Removing not-started slices also removes today's Start control, and no sibling picks it up

Verified by reading. Today unbegun slices render under Queued as a plan head in `start` mode (`packages/board/src/app/lib/agent-rows/delivery-view.ts:268-272`), and that row carries the `dispatch` control (`AgentList.tsx:1202, 1219`). The plan removes slices "with no branch, no agent" from Work items and sends them to plan 5's opened list. Plan 5's opened list shows "○ waits, and what it waits for", and it names no Start or dispatch control (`delivery-release-progress-per-plan.md`, Approach). The plan must name where Start goes.

The board already has a not-started predicate, `isUnbegun` (`packages/board/src/app/lib/agent-rows/row-identity.ts:77`), which reads the server's `unbegun` ("no commits, no claim, no PR", `schema.ts`, about line 2957). The plan's definition, "no branch, no agent", is a different test. It must say whether it reuses `isUnbegun` or replaces it. Also, "waits on the earlier slice" applies mostly to slices that have not started. Once those leave the rows, it is not clear which Queued rows still show that value.

### 8. Loose items already go to You › Unblock

Verified by reading. `looseOf` and `youCase` place a loose PR or branch under `unblock` with the reason `loose` (`delivery-placement.ts:180-191, 218`), and CLAUDE.md records this. The plan's bullet "A closed PR or branch no plan names moves to You › Unblock (plan 2), not Queued" already holds for loose items at HEAD. Plan 2 owns the rest (`delivery-you-blocks-or-feeds.md`, Unblock bullet). This is a restatement, not new work. The plan must mark it as plan 2's, or as existing, so that no builder rebuilds it.

### 9. The parts that exist already

Verified by reading.
- The three groups and their order: `DELIVERY_LAYOUT` (`delivery-placement.ts:16`).
- Group labels: `delivery-view.ts:35-37`.
- The group header with a count: `groupHeader` (`delivery-row-form.ts:406-419`).
- The `waits on <slice>` value linked to the slice: `delivery-row-form.ts:237`.
- The By cell linking to the agent's Fleet anchor: `byAgents` (`delivery-row-form.ts:201-206`), resolved to `agentAnchor` in `delivery-link-targets.ts:60`.
- The age value: `ageValue` (`delivery-row-form.ts:99-104`).

The plan builds on these, as design Approach A says. The plan must still name them, so that the slices extend them and do not duplicate them. Today the tab renders only the By cell of the row forms (`AgentList.tsx:1090-1107`). The STATUS cell is computed and never shown.

Not found in the estate, and not promised by a sibling: a commit count per slice for "4 commits · no PR yet". `localAhead` counts unpushed commits only (`schema.ts`, about line 3051). Not verified: whether a server-side reading of commits ahead of base exists outside `AgentRowSchema`.

## Summary

The plan has the right direction, but its estate claims are wrong in three places. It claims the gate glyphs do not exist; they do (finding 1). It points its open question at `glyphs.ts`, which holds no gate glyphs (finding 2). It builds the role chip in parallel with plan 4, with no owner named (finding 5). It also depends on four readings that the payload does not carry, and it does not name them: the run link and check name, the agent role, the fixer attempt count, and the commit count (findings 3, 4, 6 and 9). It drops the Start control and no sibling picks it up (finding 7). These need named changes to the plan, not a rewrite.

## Position

Position: amend
