# Sprint: An agent is declared and corrected

> A fleet whose every failure ends at a person is parallel and supervised, not autonomous. This sprint fixes what the fleet got wrong while it was watched, then makes an agent declarable as a kind of worker and a stopped one recoverable without a person reading `ps`.

## Status

- **State:** Active
- **Start:** 2026-09-12
- **End:** 2026-10-03
- **Release:** 2.17.0

## Sprint Goal

**An agent can be declared as a kind of worker, and a fleet notices when one stops.**

**The window opened with four defects the fleet had already produced, and they are the first tier.** They are listed as complete because they are: each landed on 2026-09-12, before this sprint was written. A sprint that recorded only the work still ahead would describe half a window and hand the release gate half a record. They belong to four different stories — a story holds an argument, a sprint holds a timebox, and work done in one window belongs to that window whatever it advances.

Then two halves, and neither is expressible today.

**Declared** means a charter's `harness`, `model`, `effort` and `capabilities` reach the launch. `CharterSchema` has carried all four since it was written; measured 2026-09-12, readers on the estate are **0, 0, 0 and 0**, and charters are **0**. The prompt half is wired end to end while the invocation still comes from one global `Worker command` at `plot-dispatch.sh:749`. This is the defect class CLAUDE.md names: *"Where a rule exists and nothing calls it, that is a defect to report."*

**Corrected** means a stopped agent is noticed and its slice handed on, and a failing build reaches the agent that caused it. Measured 2026-09-11, in one session: **four agents ended mid-slice**. None failed a build, none wrote a `PLOT-BLOCKED` marker, and every one reported `running`. Three left **8 commits and 9 uncommitted files**, each with an unstaged changeset — one step from done. Every one sat untouched until a person read `ps`.

**Four conditions, all of which must hold.**

| condition | what it rules out |
|---|---|
| A charter's `harness` and `model` reach the launch | An agent differentiated only by prompt text, which is a rule an agent can reason past |
| `capabilities` bounds the tools the harness permits | A reviewing agent that edits what it reviews, with nothing recording that it did |
| A stopped agent is noticed and its desk handed on | Finished work sitting on a desk until somebody happens to look |
| A panel's verdict is a file carrying a committed position | A review that reports nothing when its agent returns an empty message — measured twice on 2026-09-11 |

**What this sprint does not do.** It does not make agents share a desk: `DESIGN-worktree.md` makes the worktree the fleet's unit of isolation, and two incidents on this estate are post-mortems of accidental sharing. It does not add a step list; Plot's slices fan out in parallel with dependency ordering and a merge queue. It does not add a second scheduler.

### Must Have

- [x] [the-scan-drift-counter-is-acted-on](../plans/2026-09-11-the-scan-drift-counter-is-acted-on.md) — `sprint_drift=` splits into the three findings it counted as one. The number read 27 when the split was filed and 57 when that sprint closed with it unbuilt (story: `plot-gates`)
- [x] [a-merge-without-a-changeset-is-named](../plans/2026-09-11-a-merge-without-a-changeset-is-named.md) — the scan names a merge that shipped code and added no changeset, read from the merge parents so it needs no host call (story: `plot-gates`)
- [x] [one-cap-holds-across-boards](../plans/2026-09-11-one-cap-holds-across-boards.md) — the parallel-agent cap holds across every board on one repository; the in-flight set moves out of one process's memory (story: `the-master-agent-holds-the-fleet`)
- [x] [the-board-answers-where-the-browser-asks](../plans/2026-09-11-the-board-answers-where-the-browser-asks.md) — the board binds both loopback families, and one plan renders as one card. Both were open points the 2026-09-11 sweep confirmed against current code (story: `plot-board`)
- [x] [an-agent-declares-what-it-runs](../plans/2026-09-12-an-agent-declares-what-it-runs.md) — the charter's `harness`, `model` and `effort` reach `start_worker`, and a harness this machine cannot run refuses rather than falling back
- [x] [a-charter-bounds-what-an-agent-may-touch](../plans/2026-09-12-a-charter-bounds-what-an-agent-may-touch.md) — `capabilities` becomes a tool scope the harness enforces, which is the only differentiation that is a gate rather than a rule
- [ ] [a-failed-gate-becomes-a-correction](../plans/2026-09-12-a-failed-gate-becomes-a-correction.md) — an absent agent is noticed and its slice handed on under `--restart`'s own guards; a failing build becomes a correction in the agent's session; every marker names its writer

### Should Have

- [ ] [a-panel-questions-one-plan](../plans/2026-09-12-a-panel-questions-one-plan.md) — the panel mechanism: fan-out over one prompt, verdict files, a commitment gate, a moderator
- [ ] [a-plan-is-questioned-before-it-is-approved](../plans/2026-09-12-a-plan-is-questioned-before-it-is-approved.md) — the Draft panel gating on a verdict, and the delivery panel that shares its mechanism

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close -->

## Notes

**Why the two panel plans are Should and not Must.** The sprint goal is that an agent can be *declared* and a stopped one *corrected*. A panel improves how plans are questioned, which is worth doing and is not what the goal says. `a-plan-is-questioned-before-it-is-approved` also consumes the panel mechanism, so it cannot start until `a-panel-questions-one-plan` lands.

**The story is [an-agent-is-declared-and-corrected](../stories/an-agent-is-declared-and-corrected/STORY-an-agent-is-declared-and-corrected.md)**, and every plan here belongs to it. The sprint is the timebox; the story holds the argument.

**Two findings from the session that wrote this sprint have no plan yet**, and are candidates for Could Have rather than assumptions:

- The board runs from the plugin marketplace checkout, not the repository's own artifact. `plot-boardctl.sh --start` resolves it without saying so, so a merged board fix stays invisible until that checkout is pulled. Cost three wrong diagnoses on 2026-09-12.
- A board started from a non-interactive shell dies when that shell's session ends, and the log simply stops — no error, no shutdown line. `plot-boardctl.sh` deliberately does not detach, for a reason its own comment states, so this is a trade rather than a bug.

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->
