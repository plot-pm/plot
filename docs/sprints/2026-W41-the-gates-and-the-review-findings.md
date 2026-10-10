# Sprint: The gates and the review findings

> The five gates are launchers, and the fleet, the controllers, the channel and the tests close their review findings.

## Status

- **State:** Planning
- **Start:** 2026-10-10
- **End:** 2026-10-23
- **Release:** 2.26.0

## Sprint Goal

The shell migration converts the five PreToolUse gates to launchers over domain rules, and four plans close the review findings that the 2.25.0 release train left open.

On `main` at `eb4bda159`, 2026-10-10, `skills/plot/scripts/README.md` lists 15 *decision* rows, and the five gates are 554 code lines of them. About 60 `ai-generated` review-finding issues are open; the four Should Have plans answer 30 of them.

### Must Have

<!-- An item is `- [ ] <description>`. A leading `[<plan-slug>]` names the plan
     it commits to, and only a plan slug is read as one: `- [ ] [#123](url) …`
     names an issue, so it is an item with no plan and is scored on its
     checkbox. Strike a reference — `~~[<plan-slug>]~~` — to mark an item that
     left the sprint; the plan's own state then says whether it was withdrawn. -->

- [ ] [the-gates-are-launchers](../plans/2026-10-10-the-gates-are-launchers.md) — one hook entry runs the five gates through `plot-gate.mjs`, and each `plot-*-gate.sh` is a launcher (#1341, #1449). <!-- pr: #1494, branch: feature/one-entry-reads-the-hook -->

### Should Have

- [ ] [the-fleet-closes-its-review-findings](../plans/2026-10-10-the-fleet-closes-its-review-findings.md) — fleet and supervisor findings (#1436–#1454, #1487, #1503).
- [ ] [the-controllers-close-their-review-findings](../plans/2026-10-10-the-controllers-close-their-review-findings.md) — approval, implement lock and merge controller findings (#1447, #1458, #1483). <!-- pr: #1498, branch: bug/the-approval-asks-the-domain -->
- [ ] [the-channel-closes-its-review-findings](../plans/2026-10-10-the-channel-closes-its-review-findings.md) — default-branch reading, channel, board page and mod findings (#1437, #1463–#1481). <!-- pr: #1497, branch: bug/a-stale-default-branch-reading-holds-nothing -->
- [ ] [the-tests-and-gates-close-their-review-findings](../plans/2026-10-10-the-tests-and-gates-close-their-review-findings.md) — decision gate, reaper and test hygiene findings (#1412, #1415, #1433, #1434, #1461, #1473, #1485, #1489). <!-- pr: #1495, branch: bug/a-bundle-declaration-is-one-build-call -->

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-10: Created with five plans in the tiers that jwloka chose: the gates as Must Have, the four review-finding plans as Should Have.

<!-- Session log, decisions, links -->
