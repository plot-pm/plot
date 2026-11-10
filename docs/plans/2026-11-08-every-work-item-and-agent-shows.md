# Delivery tab: every work item and agent shows in one section

> A domain rule decides the section of every work item and every agent on the Delivery tab (You, Work items, Fleet, Machine, Release delivery), the groups inside each section, and the links between an item and the agent acting on it. The tab renders the new sections with the current row components.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** ship-2-32-0
- **Issue:** #3244
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**
- **Approved:** 2026-11-08, Jan Wloka, plan-PR #3248 merged
- **Started:** 2026-11-08, Jan Wloka, `feature/delivery-placement-rule`
- **Started:** 2026-11-08, Jan Wloka, `feature/delivery-tab-sections`

## Changelog

- The Delivery tab shows every work item and every agent once, in one of five sections: Release delivery, You, Work items, Fleet and Machine.
- A work item that an agent acts on shows under Work items and names the agent. The agent shows under Fleet and links to the item.

Board impact: this changes what the board renders on the Delivery tab and replaces `GROUPS` in `packages/board/src/app/lib/agent-rows/sections.ts` and `GROUP_ORDER` in `fleet.ts`. Rebuild the board artifact if the served payload changes.

## Motivation

Plan 1 of 3 in the Delivery tab design, [docs/superpowers/specs/2026-11-08-delivery-tab-design.md](../superpowers/specs/2026-11-08-delivery-tab-design.md), approved 2026-11-08. The design is canonical; this plan holds its "Placement" scope.

Measured on the running board, 2026-11-08 (from the design): one section list holds five row kinds, and section titles disagree with their rows. An agent row reading "waiting on you" sits under **Working**. Two idle desks reading "no manifest names this desk" sit under **Waiting on you**. The cause is structural: `GROUPS` sorts rows by what they ask of the person, while rows reach a section by the state of one branch or one process, so work and actors share one list.

## Design

### Approach

The design's rule, in the domain package under `packages/domain/src/`, taking readings as values (CLAUDE.md, "The Layering Rule"). It places:

- every work item once: under **You** where a person must act first, otherwise under **Work items**;
- every agent once, under **Fleet**, naming the work item it acts on;
- the link in both directions between an item and its agent;
- the group inside each section: **You** › Input to the fleet, Review a result, Unblock; **Work items** › At a gate, Being built, Queued; **Fleet** › Working, Blocked, Free;
- the Release delivery overview, outside the placement rule, scoped to the target release.

One group order replaces `GROUPS` and `GROUP_ORDER`, which must agree today. The tab renders the five sections with the current row components. Row forms, columns and the details popover belong to plan 2; tickets, the `People` identity extension and the loose-end controllers belong to plan 3. This plan reads only what the board reads today: the pulse, the PR index, `issues.json`, the agent registry and the machine readings.

Every rendered state is a domain property with a unit test (CLAUDE.md, "Every rendered state is a domain property"); the browser tests prove only that the sections show. Names of the rule and its types stay within the domain's terminology (Slice, Agent, Worker) and add no new use of `Wave` where `Slice` is meant. New functions are arrows.

### Left to the Builder

- Which existing browser tests move to unit tests.
- The order of groups inside **You**.
- How a link scrolls to and highlights its target.

## Slices

### Rule

- `feature/delivery-placement-rule` — the domain rule: section, group and both-way links for every work item and agent, with unit tests for each placement case in the design, replacing `GROUP_ORDER` in `fleet.ts` <!-- builds: a placement rule for Delivery tab sections --> → #3255

### Tab

- `feature/delivery-tab-sections` — the Delivery tab renders the five sections from the rule with the current row components, replaces `GROUPS` in `sections.ts`, and carries one browser test that shows the sections <!-- builds: Delivery tab section rendering --> → #3267

## Notes

- 2026-11-08, Jan Wloka: the served fleet payload gains two optional fields, `autoReview` and `correctionBudget`, read from `Auto-review` and `Correction budget` in `## Plot Config`, so the Delivery tab can place gate rows. This answers discovery 1 of PR #3267.
- Created from issue #3244 by an unattended run. The Type came from the prompt; the design question was unanswered, so the plan starts in Draft.
- Deliverable search for the rule found nothing in the estate by that name.
- Plans 2 (row forms) and 3 (tickets and loose ends) of the design are separate plans.
- Ruling, 2026-11-10, Jan Wloka: the Delivery tab renders plan and slice rows with their action menus (Approve, Dispatch, Deliver, Reslice, Implement) inside the five sections, because the design lists plan and slice as row KINDs. Browser tests that assert those rows keep their subject.
- Ruling, 2026-11-10, Jan Wloka: `phaseOf` maps the payload's workflow phases (Discovery, Design, Development, Testing, Released) case-correctly: Discovery and Design are input to the fleet, Development is a work item, Testing and Released are delivered. A unit test uses the payload's real phase words.
- Ruling, 2026-11-10, Jan Wloka: the host-freshness rules of the old Waiting on a machine section hold on the Machine line: a board that has not asked the host prints no `none`, a failed first call reads as an outage, and a host-fed reading never borrows the git scan's freshness.
- Ruling, 2026-11-10, Jan Wloka: rows of slices being built keep the row menu, the status words (someone is on it, no known worker) and the dispatcher-log button, and a merged live worker shows in Working.
- Ruling, 2026-11-10, Jan Wloka: rows use the design's KIND words (ticket, plan, slice, PR, branch) and carry no wave badge; a plan whose slices sit in two groups shows its head in each group.
- Ruling, 2026-11-10, Jan Wloka: the placement rule never puts an agent under You; a stopped agent with no ending read shows in Fleet as stopped and names what is unknown. Section tallies and the Sprint-only counters stay off the headers, and verify runs sit under Tickets and plan runs.
