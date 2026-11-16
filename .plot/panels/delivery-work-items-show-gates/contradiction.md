# Contradiction juror: delivery-work-items-show-gates

Lens: does the plan disagree with a sibling plan, with the design spec, or with a decision this repo already made? Every finding below names what I read. Where I did not verify something, the finding says so.

## Findings

### 1. Role chips: two plans claim them and neither waits on the other

The subject says: "The role chips are the ones plan 4 shows in Fleet; this plan adds them to the row form in `packages/domain/src/rules/delivery-row-form.ts`" (Design › Approach, **By** bullet). Plan 4 (`delivery-fleet-rows-per-agent.md`, Approach) defines the chip set (loop, reviewer, fixer, approver, idea, brief, design, verify) and says that every role is "built on the agent row form in `packages/domain/src/rules/delivery-row-form.ts`". Both plans therefore put the role-chip fact into the same file. Neither plan states which one owns the fact.

The subject's slice `feature/delivery-work-items-by-chips` declares only `<!-- waits: feature/delivery-section-header -->`. It does not wait on plan 4's `feature/delivery-fleet-agent-rows`. The plan uses "the ones plan 4 shows" as an input, but its slice can start before plan 4 builds them.

The chip set also does not exist at HEAD. `AgentRole` is `'loop' | 'fixer' | 'reviewer' | 'approver' | 'idea' | 'brief'` (`packages/domain/src/rules/delivery-placement.ts:93`). That is six roles, and `design` and `verify` are missing. Today the role is a plain word in the agent row's Kind cell (`delivery-row-form.ts:376`, `kind: link(placement.role ...)`). The item row's By cell holds agent ids and no role (`byAgents`, `delivery-row-form.ts:205-210`). Neither plan names a slice that widens `AgentRole`. Verified by reading.

Required change: name one owner for the role-chip fact and the `AgentRole` widening. Then either make `feature/delivery-work-items-by-chips` wait on plan 4's slice, or move the chip fact into this plan and make plan 4 read it.

### 2. Queued "waits on the earlier slice" contradicts the not-started exclusion and plan 5

The subject's Queued column shows "`no agent assigned`, or the earlier slice". The same plan says "A slice that has not started (no branch, no agent) is not a row here". Its Done When says "No slice without a branch or an agent shows as a Work items row". A slice that waits on an earlier slice usually has no branch and no agent yet, so the exclusion removes exactly the rows that would show "the earlier slice". Plan 5 (`delivery-release-progress-per-plan.md`, Approach) puts that value in its opened list instead: "**To do** (○ waits, and what it waits for, "after Reads")".

The design carries the same tension: Work Items gives the Queued example "or the earlier slice", and Release Delivery says "A slice that has not started … is not a row under Work items". The plan copies both statements and does not reconcile them. At HEAD, `workGroup` sends `stage: 'queued'` to Queued (`delivery-placement.ts:218-219`). `itemRowCells` renders `waits on <slice>` for `slice-queued` (`delivery-row-form.ts:248-249`). Today's rows therefore include the not-started slices that this plan removes. Verified by reading.

Also, "Done When" says "no slice without a branch **or** an agent". The Approach says "(no branch, no agent)", which means both are missing. Under the Done When wording, a slice that has a branch but no agent also leaves Work items. That slice is the `no agent assigned` row the Queued column exists to show. The two statements contradict each other.

Required change: state which queued slices stay as rows (for example, a branch with no agent). State whether "the earlier slice" remains a Work items value or belongs to plan 5 only. Make Done When use the Approach's "and".

### 3. Queued also holds tickets and plans today, and the plan does not say what happens to them

`workGroup` puts tickets (`kind === 'ticket'`), Draft and Design plans, and items with `approvalOwed` into Work items › Queued (`delivery-placement.ts:205-207`). A ticket that is not the reader's places there whenever the Mine mode admits it (`placeDelivery`, `:326-341`). The design calls Work items "Items in flight that do not need the developer". Plan 6 makes the Tickets section the place for tickets (`delivery-machine-tickets-footer.md:38`). The subject's Queued column ("no agent assigned, or the earlier slice") has no value for a ticket or for a Draft plan. No plan, this one included, says whether those placements leave Queued. Verified by reading. The design's Non-goals limit placement changes to those listed under "Changes to the 2026-11-08 Design", and that list does not include this one. So removing them conflicts with the design, and keeping them conflicts with the one-kind-per-column rule.

Required change: name what Queued does with tickets, Draft and Design plans and approval-owed items, and name which plan owns that change.

### 4. The gate rule belongs to plan 2, and the subject does not wait on it

The subject defers the PR's placement to "plan 2's PR rule" (Gates bullet). Plan 2 builds that rule in `feature/delivery-you-groups` (`delivery-you-blocks-or-feeds.md`, Slices), in `delivery-placement.ts`. The subject's `feature/delivery-work-items-gates` waits only on `feature/delivery-section-header`. Ownership is consistent: plan 2 owns the rule and this plan only renders it, which is correct. The sequencing is undeclared, though. Until plan 2 lands, `youCase` still sends a green PR to You › Review a result when `Auto-review` is off (`delivery-placement.ts:189-191`), and that group does not exist in the new design. Plan 2's own Open Points name the same file collision (`delivery-row-form.ts`, `delivery-placement.ts`, `AgentList.tsx`). Verified by reading.

The same applies to plan 1. `feature/delivery-tab-header-cards` removes the release row from Work items › At a gate. At HEAD that row is `RowShape` `'release'`, and it renders its gate in the same status cell (`delivery-row-form.ts:52`, `:254-256`). The subject rewrites the At a gate column and does not mention the release shape or wait on plan 1's slice.

Required change: either add `waits:` on `feature/delivery-you-groups` (and on `feature/delivery-tab-header-cards` for the release row), or state that the gates slice renders whatever the placement rule returns at the time, and say what At a gate shows for a `release` row until plan 1 removes it.

### 5. The open glyph question points at the wrong table and conflicts with the row form's null-cell contract

The Open Question asks "Which glyph in `glyphs.ts` stands for a gate nobody has asked yet ("review –")?". `packages/board/src/app/lib/glyphs.ts` holds Octicon SVG paths keyed by item kind (ticket, plan, pr, build, agent, branch, release, wave, story, sprint). It holds no gate mark. The marks ✓ ⟳ ✗ are text characters in `GATE_MARK`, in the domain (`delivery-row-form.ts:96`). The design's rule "an icon the glyph table does not hold" therefore does not decide this question, and the question as written cannot be answered from `glyphs.ts`. Verified by reading.

The row form's contract also says: "A fact nobody read yields a `null` cell, never a default word" (`delivery-row-form.ts:221-222`). `PrReading.review` separates `'none'` (asked, nothing found) from `'unread'` (nobody asked) (`delivery-placement.ts:40`). "A gate nobody has asked yet" rendered as `review –` is a default mark for an `unread` reading, and the contract forbids that. A `–` for `'none'` does not conflict.

Required change: move the question to `GATE_MARK`. State that `–` stands for `review: 'none'`, and that an `unread` gate renders nothing, or record the decision to change the contract.

### 6. "Rebuild the board artifact with each slice" contradicts CLAUDE.md

The subject's Board impact line says "Rebuild the board artifact (`pnpm build:board`) with each slice that changes the board." CLAUDE.md (Testing) says that a PR's diff must carry no generated bundle (`scripts/check-no-bundle-diff.sh`). It also says to run `pnpm build:board` "only to test the result locally". Plan 1's and plan 2's panels have already flagged this line in their own plans. Verified against CLAUDE.md, not against the script.

Required change: say that the rebuild is a local test and never part of the commit.

### 7. The story link resolves to no file

`Story: delivery-tab-reads-at-a-glance` and the Motivation link point at `docs/stories/delivery-tab-reads-at-a-glance/STORY-delivery-tab-reads-at-a-glance.md`. That directory does not exist on this branch (checked with `ls`). The siblings share the defect, and plan 1 already lists it. This is a cosmetic issue.

### Checked and consistent

- **Slice branch names and `waits:`.** `feature/delivery-work-items-gates` and `feature/delivery-work-items-by-chips` do not collide with any sibling's branch. Both wait on `feature/delivery-section-header`, which plan 1 declares. Verified.
- **Scope.** "Mine narrows Work items; My sprint applies here too" agrees with the design ("Mine narrows Work items and Release delivery only"; "One scope rule for every section"). Plan 1's `feature/delivery-my-sprint-scope` claims to apply the scope to Work items. This plan builds no scope slice, so no one builds the scope twice. Verified.
- **Closed PR or unnamed branch to You › Unblock.** This plan assigns the move to plan 2, and plan 2 claims it. Loose items already go to Unblock at HEAD (`delivery-placement.ts:194`). The closed-PR reading does not exist yet, and plan 2 owns it. This plan does not contradict that.
- **Terminology.** The plan uses Slice (not Wave) and Agent (not Worker) throughout. It adds no process-side state. The design gives no layering instruction that the plan breaks, because every value is declared a domain property.
- **Fixer attempt.** `WorkItemReading.corrections` exists (`delivery-placement.ts:63`), and `correctionBudget` is on `DeliveryInput` (`:112`). "1/2" therefore has its readings. Plan 4 writes the same fact as "attempt 1 of 2" in Doing now. The design uses both forms in their own sections, so the difference is not a contradiction.
- **Columns.** Kind · Item · Where · (group column) · By · Age replaces today's `status` cell, which holds the gate (`ROW_COLUMNS`, `delivery-row-form.ts:13`). Plan 2 keeps `status` and `do` for You. The two column sets can coexist in one row form. Both plans edit the same `ROW_COLUMNS` and `itemRowCells`, which is the collision named in finding 4.

Not verified: the board-side readers (`packages/board/src/app/lib/agent-rows/delivery-row-facts.ts`) that would supply `corrections`, CI run ids and review links to the row form. I did not read them.

## Position

Position: amend
