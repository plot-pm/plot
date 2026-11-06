Position: amend

Lens: board operator, the person who reads the Tickets, Stories and Plans cards every day to decide what to work on next.

## Findings

### 1. Decisions the Spec leaves open, by slice

**Tracer (Plans)**
- **Facts on today's plan card with no place in `CardFacts`.** `PlanCard.tsx:383-487` renders the type badge, *Ready*, the refuted-verification badge, the rounds badge (`not interrogated` / `N rounds`), the cost badge, *not pushed*, the plan path (`:489`) and the spike-state line (`:567-571`). `identity` has no `type`. `Alert` has two kinds, both for stories. Nothing holds rounds, cost, not-pushed or spike state. The builder must either invent facets or drop facts an operator uses for triage today (*has anyone questioned this?*, *can anyone else see it?*). The Notes say this plan "changes their layout, not what they fixed", but the type badge from `2026-10-15-discovery-and-planning-cards-show-the` has no field.
- **The Start-work disabled reasons do not match the real ones.** Today's refusals come from `startRefusal` (`StartWorkButton.tsx:59-68`): the dispatch is unavailable (`dispatch.reason`, a server sentence), *waiting for the first fleet scan*, or *no branch is eligible to start*. The `Reason` union holds `waits-on | started | awaits-spike | …` and covers none of them. Worse, `started` as a reason contradicts the code. `PlanCard.tsx:520` shows Start work whenever `controls.dispatch` holds, started or not, because on a plan with several slices the button dispatches the next wave (`StartWorkButton.tsx:214-221`). If `started` disables the primary, every in-progress plan loses the action the operator uses most. *Waiting for the first fleet scan* is an unknown, not a reason, and the union has no unknown arm.
- **Where `changedAt` comes from for a plan is not named.** The Motivation says a plan card shows no freshness today. A git-log read per plan would break "no projection adds a read".

**Stories**
- **The objective preview has nowhere to go.** `StoriesTab.tsx:585-589` shows a 4-line objective. Invariant 1 forbids any free-text field except `title`, so the preview is dropped by construction. Nothing says whether that is intended. For the Stories reader it is the main text on the card.
- **"Its lifecycle action, if any"** (Approach table, story with plans): no story `ActionKind` exists, so the answer is always *none*. Say so.
- **"Live" story is not defined** against `StoryStatusSchema` (`entities/story.ts:15`: draft, ready, active, in-review, paused, done). Do `paused` and `draft` stories receive new plans?

**Tickets**
- **Ticket → story through the ticket's plan.** The ticket → story index reads only a story's `issue:`. A ticket whose plan has `Story: X`, where story X names no ticket (the normal case: a story with 62 plans names at most one issue), falls in the row *a plan, no story*. It offers *Create story* although its work already sits in a story. That is the 3102 defect again, for stories, on most tickets on this estate. Decide whether `lineage` takes the story through the plan.
- **No ticket detail view exists.** `identity.opens` is the board's own detail view for every kind. The ticket title links to the host today (`StoriesTab.tsx:496`), and the app has no ticket detail or modal component (grepped `packages/board/src/app`). No slice builds one.
- **Plans that could not be read.** `ticketPlansOf` returns `null` when plan metas cannot be read (`fleet.ts:1714-1715`), and `ticket-lanes.ts:58` carries `plans: … | null`. `lineage` is `Ref[]` with no `Unknown` arm, so an unread plan list looks like *no plan*, and Invariant 4 then offers *Create plan*. Invariant 5 asks for exactly this case to be `Unknown`, and the type cannot express it.
- **Create-button refusals are missing from `Reason`.** `CreatePlanButton.tsx:80` already refuses on `createFromIssueVerdict(idea, issueAnswer, …)`: the idea command is unavailable or the tracker cannot be asked.
- **Ticket progress is undefined** for a ticket with 0, 1 or several plans. `ticketPhase`'s *in progress 2/3* is the only progress a ticket shows today.
- **Which date fills `changedAt`** for a ticket: opened or updated.

**All boards**
- **The `board` input to `presentCard` does not match the real tabs.** The code has `BoardTab = discovery | planning | delivery` (`rules/board-tab.ts:2`) and `DiscoveryShow = tickets | stories | both` (`rules/discovery-groups.ts:4`). `PlanCard` also renders in `Swimlanes.tsx`, where `showStory`/`showSprint` hide the swimlane's own story. The Spec gives no mapping for `both`, for Delivery, or for context suppression.

### 2. Spec contradicted by today's code
- `Reason.started` disables Start work. The code keeps Start work available on started plans: `PlanCard.tsx:520`, `StartWorkButton.tsx:214-221`.
- The Motivation says the disabled Start work "gives no reason". A reason exists, on hover only (`StartWorkButton.tsx:331`, `title={refusal ?? …}`). The real defect is that the reason is hidden behind hover.
- "Computed on the server … where `planCardView` and `cardControls` run today" holds for plans (`board.ts:2676`, `:2687`) and stories (`board.ts:2306`). `ticketCardView` runs in the browser: `StoriesTab.tsx:488`, with `Date.now()`. The Tickets slice is therefore a relocation, not just a projection change.
- `identity.opens` for tickets assumes a detail view that does not exist.
- The Notes promise to keep what earlier plans fixed, but the type badge (`PlanCard.tsx:383`, `StoriesTab.tsx:498-505`) has no field in `CardFacts`.
- Citations that check out: `ticket-card.ts:87`, `card-controls.ts:62` (nine flags), `story.ts:468` (`statusDrift` returns `BEHIND[derived]`), `entities/story.ts:56`, `StoriesTab.tsx:556` (⚠ with `title` only), `fleet.ts:1710`. Story 3170 has `issue:` (`STORY-nothing-changed-nothing-runs.md:4`), and the template writes `jira:` (`skills/story-tracking/STORY-template.md:4`).

### 3. Does each slice's "Done when" prove the slice?
- **Tracer: no.** It could pass while the card drops the type, rounds, cost, not-pushed and spike facts, and while every started plan's Start work is disabled as `started`. None of the three Motivation defects for plans is a criterion: the `no story` chip, the `not measured here` chip, and the disabled reason being visible without hover.
- **Stories: partly.** It proves the 3170 link and the alert label. Collapse is untested for the real worst case, a story with 62 plans and 9 sprints. Progress (*delivered out of total*, the Stories reader's emphasised facet) has no criterion.
- **Tickets: partly.** #3102 passes. With plans unread (`null`), *Create plan* still returns, so the defect survives throttling. A ticket whose plan sits in a story with no `issue:` still offers *Create story*, the story form of the same defect, and no criterion names it.

### 4. Changes before approval
- **blocking:** Account for every fact today's plan, story and ticket cards show: type, rounds, refuted verification, cost, not pushed, spike state, Ready, path, story objective. Give each a typed field, or drop it explicitly with a reason.
- **blocking:** Rebuild `Reason` from the real refusals: dispatch unavailable, no pulse yet, no eligible branch, idea or story command unavailable, tracker unaskable. Add an unknown arm. Remove `started` as a disable for Start work, or justify the behaviour change.
- **blocking:** Let `lineage`, or the projection inputs, express *plans or stories not read*. A ticket in that state must not offer *Create plan* or *Create story*. Add this to Invariant 4.
- **blocking:** Decide ticket → story through the plan's `Story:` field. Add the case to the Approach table and to Tickets Done-when.
- **blocking:** Decide what a ticket title opens: build a ticket detail view (in which slice?) or open the host issue.
- **should:** Map `board` onto discovery/tickets/stories/both, planning, delivery and swimlanes, including hiding the lineage item the swimlane already shows.
- **should:** Put the collapse rule on the lineage line too (sprints and plans live in `lineage`, but `presentCard` places expanders only on progress). Raise the threshold above 1 so a plan with 2 PRs keeps its PR links and checks visible at a glance.
- **should:** Name the `changedAt` source per kind. Define *live story*. Define ticket progress for 0, 1 or several plans.
- **should:** Add Done-when items for the three plan defects in the Motivation, for preservation of existing facts, and for a fixture of 62 plans and 9 sprints.
- **could:** Say *none* for the story lifecycle action. Specify when `deliver` is enabled: it is a new card action, and no plan card offers Deliver today.

### 5. What I did not check, and my evidence
- **Evidence:** I read the plan and code in this worktree: `PlanCard.tsx`, `StartWorkButton.tsx`, `StoriesTab.tsx`, `CreatePlanButton.tsx`, `card-controls.ts`, `ticket-card.ts`, `ticket-phase.ts`, `plan-card.ts`, `story-card.ts`, `transitions/story.ts`, `entities/story.ts`, `fleet.ts` (`ticketPlansOf`, `ticketLaneData`), `App.tsx`, `index.ts`, the board-tab and discovery-groups rules, the story files and the template.
- **Not checked:** I ran nothing and did not look at a live board. I did not read `release-smoke.sh` or the `plot-ask.mjs board` consumers of the old fields. I did not read `menus.tsx` or `agent-rows/rows.tsx`, which reuse `roundsBadgeText` from `PlanCard` and are affected when those fields go. I did not read the `mock-fleet.ts` shapes, the idea agent's brief path for `Story:`, or the `issue:` parser's host and tracker config inputs. I did not measure card heights.
