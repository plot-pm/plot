# Sprint: The board shows the strategic layer

> The board shows plans and agents but not the stories that organize them. A
> reader who wants the big picture — why are we doing all this? — has to open
> story files by hand. This sprint adds the Stories tab, completing the
> strategy → artifacts → execution funnel.

## Status

- **Phase:** Closed
- **Start:** 2026-09-01
- **End:** 2026-09-05
- **Release:** 2.12.0

## Sprint Goal

**The board shows stories as the strategic layer above plans.**

A reader can:
1. See all stories organized by status (Draft/Active/Done/Archived)
2. Navigate from story to its plans and back
3. Spot status drift (story says "active" but all plans are released)
4. Browse topics via tag cloud

The tab order becomes Stories · Plans · Agents — strategy at the top, execution
at the bottom.

## Story

- [the-master-agent-holds-the-fleet](../stories/the-master-agent-holds-the-fleet/STORY-the-master-agent-holds-the-fleet.md)

## MoSCoW

### Must Have

- [x] [the-board-shows-stories] Stories tab with columns by status, story cards, tag cloud, archived toggle, empty-state redirect — **UI wave in progress** <!-- status: delivered -->

### Should Have

- [x] [the-domain-moves-out-of-the-board] Extract domain entities to `@plot-pm/domain` package — foundation for testable rules <!-- status: delivered -->
- [x] [the-domain-speaks-slices] Domain objects express slice boundaries for fleet orchestration <!-- status: delivered -->

### Could Have

- [ ] [production-calls-the-domain-one-rule-at-a-time] Production code migrates to domain layer incrementally <!-- status: draft -->
- [ ] [the-domain-runs-the-workflows-in-a-sandbox] Sandbox testing for domain workflows <!-- status: draft -->

## Notes

### Closed 2026-08-30 against 2.12.0 -- ahead of its own dates

**Phase: Closed, Release: 2.12.0.** The Must Have and both Should Haves are
delivered and shipped; the sprint is finished by its contents rather than by its
clock.

| tier | item | state |
|---|---|---|
| MUST | `the-board-shows-stories` | Released 2.12.0 |
| SHOULD | `the-domain-moves-out-of-the-board` | Released 2.12.0 |
| SHOULD | `the-domain-speaks-slices` | Delivered -- `infra`, live on merge |

`the-domain-speaks-slices` stays Delivered rather than Released on purpose:
/plot-release skips docs/infra plans, because /plot-deliver already tells their
authors they are live when merged. The release gate reads it as done regardless.

**The dates say 2026-09-01..09-05 and were never reached.** They are kept as
written rather than rewritten to today: the plan was to run this window, and
the work landing early is the fact worth recording, not a date to tidy away.

**The two open Could Haves are not dropped.** Both are also members of
`the-domain-is-one-implementation`, which stays Active until 2026-09-12:

- `the-domain-runs-the-workflows-in-a-sandbox` -- Draft, 4 slices, no branch
  exists; its blocker is met, so it is startable
- `production-calls-the-domain-one-rule-at-a-time` -- Draft, 5 slices, no branch
  exists; still blocked on the former

Neither was started, so nothing is left half-done by closing here.

### Three of its items shipped in 2.12.0 before this sprint opened — 2026-08-29

This sprint starts 2026-09-01 and its `Release:` is still an empty placeholder,
so the release gate correctly reads it as having no target and did not consult
it for `v2.12.0`.

Its Must Have and both Should Haves are nevertheless **Released** already:
`the-board-shows-stories`, `the-domain-moves-out-of-the-board` and
`the-domain-speaks-slices` are all shared with `the-domain-is-one-implementation`,
which did target 2.12.0. Two sprints naming one plan is legitimate — the gate
answers to both — and the shared items are simply finished before this timebox
begins.

What remains here is the two Could Haves, both Draft with no branch on the
remote: `the-domain-runs-the-workflows-in-a-sandbox` (now startable, its blocker
released) and `production-calls-the-domain-one-rule-at-a-time` (still blocked on
the former).

### Why this sprint focuses on Stories tab

The story `the-master-agent-holds-the-fleet` has five plans and spans domain
extraction, fleet orchestration, and board UI. **The board-shows-stories plan
is the one closest to landing** — Schema and Backend waves are merged, UI wave
is in progress with 3 branches claimed.

Completing it delivers immediate value: the strategic view that's been missing.
The domain extraction plans are foundational but larger scope.

### What "the strategic layer" means

Stories are the **problem space** — they answer "what are we trying to solve?"
Plans are the **solution space** — they answer "how do we solve it?"
Agents are **execution** — they answer "who is doing the work right now?"

The board had artifacts and execution but not strategy. This sprint completes
the funnel.

### Scope Changes

<!-- logged here as the sprint's contents change -->
