---
'@plot-pm/board': patch
---

`parseSprintContent` and `parseStoryContent` read a stated phase or status through the domain's `SprintStateSchema` and `StoryStatusSchema` and report `UNKNOWN` for anything else — the shape `plot-plan-meta.sh:338` has held for plan phases since it was written: an admitted list and a fall-through.

Measured 2026-09-06: three stories carried `status: archived` — a value #707 made unrepresentable in TypeScript — and one sprint carried `Phase: Planned`. Neither is in either schema, and nothing reported them. `plot-story-lint.sh` answered `0 finding(s)` over the three, the reconcile scan's thirteen sections never asked whether a state parses, and a person reading files found all four in one session.

`UNKNOWN` is a reading, not an error: nothing downstream is refused and the consumer decides, the same direction `unaskable` takes for a host. A sprint file with no `Phase:` line still parses to `null`, which says the file is not a sprint rather than that its state is wrong.

`SPRINT_PHASES` derives from the domain instead of hand-copying four values. It was the last state list `contract/schema.ts` declared for itself, after `BOARD_PHASES` (#721) and `STORY_LIFECYCLE` went the same way.

The shell readers gain nothing here and that is stated rather than hidden: `plot-story-lint.sh` and the reconcile scan keep reading what the file says.
