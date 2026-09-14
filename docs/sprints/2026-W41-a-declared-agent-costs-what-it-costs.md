# Sprint: A declared agent costs what it costs

> An agent kind is declared and dispatched by name, and a plan states what its agents spent.

## Status

- **State:** Planning
- **Start:** 2026-09-15
- **End:** 2026-10-06
<!-- No Release: yet. Neither story's shape is settled enough to promise a
     version, and a Release: field is a gate /plot-release enforces. It is
     added when the first plan is approved, not before. -->

## Sprint Goal

**Two stories that have been `draft` since 2026-08-27 with zero plans each, and
both are further along than their files say.**

**The first half of `plot-agent-identity` already shipped, under another name.**
The story drafted `.plot/roles/<slug>.md` carrying name, model, effort, tools
and command. What v2.17.0 delivered is the **charter** — `CharterSchema` carries
`name`, `harness`, `model`, `effort` and `capabilities`, and
`plot-dispatch.sh` reads them: measured 2026-09-14, **16 readers for `harness`,
14 each for `model` and `effort`, 7 for `capabilities`**.

**And nobody has declared one.** `.plot/charters/` holds **zero files** on this
estate. So the mechanism is complete and its adoption is nil — the defect class
CLAUDE.md names: *"Where a rule exists and nothing calls it, that is a defect to
report."* The story's remaining work is not to build the noun again; it is to
use it, and then to build the half that was never started — a slice saying what
kind of agent it needs.

**The second story has no foundation at all, and its scope is already narrowed
to what can be derived.** `plot-plan-economics` asks *what did this plan cost*.
`entities/budget.ts` sounds like the answer and is not: it carries `connector`,
`account`, `bucket`, `spent`, `limit`, `remaining` — an API rate-limit window,
not a token count. Nothing on this estate records what an agent spent. The story
narrowed itself on 2026-08-29 by measurement: a transcript carries all four
token counters and the model per turn, **and no monetary field**, so tokens are
a derivation and francs are not. This sprint stops at tokens.

**Both halves are measurable, which is why they are in one window.** An agent
declared by kind is the thing whose cost is worth attributing, and a cost
attributed to an undifferentiated worker answers a less useful question.

### Must Have

- [ ] **A charter exists and a dispatch honours it end to end** — at least one declared agent kind under `.plot/charters/`, dispatched, with `harness`, `model`, `effort` and `capabilities` all observed reaching the launch. Closes a zero-adoption gap on a mechanism that is already complete.
- [ ] **A slice names the agent kind it needs, and dispatch matches it** — the second half of `plot-agent-identity`, never started. The plan declares a kind; the fleet's capacity stops being one undifferentiated number.
- [ ] **A worker records what it spent** — the four token counters (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and the model, attributed to the slice. Without capture nothing else in `plot-plan-economics` is possible.

### Should Have

- [ ] **A plan states what its slices cost** — the per-plan rollup over the recorded counters. Reporting is worth less than capture and depends on it, so it is a Should rather than a Must.

### Could Have

<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

**Neither story's text has been updated since 2026-08-27, and both are stale in
ways that matter to whoever plans them.**

`plot-agent-identity`'s `## Current Plan` still describes `.plot/roles/<slug>.md`
and names a blocker — `the-domain-moves-out-of-the-board`'s Entities slice —
that is **released**. Read the charter before that section: the file describes a
design that was superseded while the story sat parked.

`plot-plan-economics` carries its own narrowing note from 2026-08-29 and that
note is still correct. Read it rather than re-deriving the francs question.

**No `Release:` is declared.** A sprint's `Release:` gates `/plot-release`, and
promising a version for work whose first plan is not yet written would be a gate
with nothing behind it. It is added when the shape is settled.

**Three Musts and one Should for a three-week window is deliberate.** Both
stories start with zero plans, so each Must carries its own `/plot-idea` and
interrogation before any code. The window is sized for shaping, not only for
building.

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->
