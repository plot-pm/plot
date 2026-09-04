# A lifecycle is enforced by a test

> Plan's lifecycle is a domain rule with 41 tests and 24 refusal assertions.
> The other twenty-two entities have their lifecycles in prose, and prose is a
> rule that eventually gets violated.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <branch>
-->

## Changelog

- Each core element's lifecycle becomes a domain rule that refuses illegal
  transitions, with a unit test per refusal. An agent cannot be terminated by
  something that never declared it, a worktree cannot be reaped while it holds
  unlanded work, and a slice cannot start before its prerequisite merged —
  because the rule refuses, not because a script remembered to check.

<!-- Board impact: the board reads the same refusals it renders. No plan-format
     change. -->

## Motivation

**One lifecycle is owned by the domain, and it works.**
`packages/domain/src/transitions/plan.ts` carries `Precondition`,
`RefusalReason`, `Decision` and `TransitionResult`. Its test file holds **41
tests with 24 refusal assertions** — assertions about what may NOT happen — and
it is called from a bundle by both `plot-approve.sh` and `plot-deliver.sh` and
by `server/entry/transition.ts`.

**Measured 2026-09-04: 23 entities, 1 transitions file.** The pattern was built
once and never generalised.

### The other lifecycles live in prose, and their specs say so at length

| entity | lifecycle mentions in its `DESIGN-*.md` | transitions rule |
|---|---|---|
| `issue` | 47 | **none** |
| `story` | 28 | **none** |
| `budget` | 16 | **none** |
| `worktree` | 15 | **none** |
| `agent` | 14 | **none** |
| `pulse` | 10 | **none** |
| `machine` | 9 | **none** |
| `sprint` | 8 | **none** |
| `slice` | 7 | **none** |
| `release` | 7 | **none** |

These are not gaps in the design. The specs describe each lifecycle carefully —
`DESIGN-agent.md` gives the eight states and which component owns each,
`DESIGN-worktree.md` settles that *"the agent creates or resets its desk and
owns it"*. **What is missing is anything that refuses when the code disagrees.**

### CLAUDE.md already names this failure mode

> *"If your skill includes a MUST or NEVER instruction, ask: is this enforced by
> a hook, or just written in prose? **If prose-only, it's a rule and will
> eventually be violated.**"*

And it names the exact instance:

> *"The four phase guardrails… are currently rules embedded in spoke commands."*

**Measured this session, three violations of prose-only lifecycle rules:**

- An agent was terminated by **itself** (`plot-worker-loop.sh:626` SIGKILLs its
  own process group) while `DESIGN-agent.md:220` assigns the manifest — and the
  agent's declaration — to the Registry. `registry.ts` contains no `kill` and
  no write at all.
- The same agent read **two different states** at once: `finished` from the
  scan, `stalled` from the registry, because one caller passes a PR fact and the
  other deliberately does not.
- Four state vocabularies coexist — 8, 8, 8, and **5** in `registry.ts:35` —
  which `DESIGN-agent.md:797` already records as an open point.

None of those is a coding mistake. Each is a lifecycle nobody could enforce.

### Why this is a better unit than the scripts

An earlier framing counted **36 scripts and 7,795 lines**. That is a measure of
where the code sits, not of what it decides — and it produces a migration
ordered by file size, which is why `plot-fleet-scan.sh` (3,945 lines) looked
like the priority and `plot-pr-merged.sh` (12 lines of code, 13 consumers,
blocking every non-GitHub host) did not.

**A lifecycle is the unit that has a test.** `plot-reap.sh`'s five refusals and
`plot-release-refs.sh`'s guards are the same question about a Worktree, and
moving them together is what lets one rule answer it.

## Design

### Approach

**Per entity: a `transitions/<entity>.ts` shaped like `transitions/plan.ts`, and
a test asserting every refusal.** The existing file is the template rather than
an inspiration — same `Precondition` / `RefusalReason` / `Decision` shape, so a
caller that reads one reads them all.

**The refusals come from the specs, not from the code.** Each spec already names
what must not happen; the rule states it and the test proves it. Where code and
spec disagree the plan says which is wrong — `DESIGN-agent.md:787` calls a
synthesized entry *"a defect, not a category"* while `entities/agent.ts:29`
encodes it as an identity, and **the code is currently right** because nothing
can be declared.

### What a lifecycle rule is not

**Not a state machine that owns the world.** The rules take readings as values —
`reap(readings, input)`, the shape `rules/reapable.ts` already uses — so nothing
awaits and nothing spawns. The caller reads; the rule judges.

**Not a replacement for the gates.** `plot-phase-gate.sh` is a PreToolUse hook
and stays one. A domain rule makes the hook's answer testable; it does not make
the hook unnecessary.

### Not chosen: one transitions file for everything

A single `transitions.ts` would put an Agent's refusals beside a Sprint's, and
the two share nothing but a shape. The per-entity file is what lets a reader
find the lifecycle they are asking about.

### Not chosen: start with the entity whose spec says most

`issue` has 47 lifecycle mentions and is the least urgent — nothing is blocked
on it. **Order by what is being violated**, which is Agent and Worktree.

### Open Questions

- [ ] **Does every entity earn a transitions file?** `Person`, `Version` and
      `Identity` may have no transitions at all. A file per entity is a shape,
      not a quota.
- [ ] **Where does a refusal surface?** The board renders some; a hook blocks
      others; a script exits non-zero. The rule answers; who acts on the answer
      is per entity and may not be uniform.
- [ ] **Do the specs need amending as this lands?** Three disagreements are
      already known. Each is a decision about which document is wrong, and
      neither answer is free.

## Branches

### The agent's lifecycle

- `feature/an-agent-lifecycle-refuses` — `transitions/agent.ts`. The eight
  states `DESIGN-agent.md` names, and the refusals it already states: an agent
  is terminated by the Registry, a manifest belongs to the Registry, `elsewhere`
  means no worktree on this machine. **Asserted: an agent cannot terminate
  itself** — the rule that `plot-worker-loop.sh:626` violates today, so the
  first test written fails against current behaviour and says why.

### The worktree's lifecycle

- `feature/a-worktree-lifecycle-refuses` — `transitions/worktree.ts`. The five
  measurements `plot-reap.sh` already refuses on and the five guards
  `plot-release-refs.sh` applies are one question about a desk. **Asserted: a
  reaped checkout is re-creatable and a deleted ref is not** — the asymmetry
  that makes those two scripts refuse differently, currently held only in their
  comments.

### The slice's lifecycle

- `feature/a-slice-lifecycle-refuses` — `transitions/slice.ts`. Eligible,
  claimed, waiting, merged, deferred — and the `waits:` prerequisite
  `a-slice-can-wait-on-another-plan` introduced. **Asserted: a prerequisite that
  merged and was then reaped still clears**, the deadlock that plan was
  corrected to avoid, now enforced rather than remembered.

## Notes

Written 2026-09-04. Counts measured on `main` that day: 23 entities, 1
transitions file, 41 tests and 24 refusal assertions in the one that exists.

**Three entities, not ten, and deliberately.** Agent, Worktree and Slice are the
three whose lifecycles were measurably violated this session. The remaining
seven follow the same shape once these prove it — and `issue`, whose spec says
most, is last because nothing is blocked on it.

**Related and separate.** `every-element-is-a-domain-concept` (#693) gives
Branch, Plan and Slice a TYPE. This gives them a LIFECYCLE. The types can land
first, but neither blocks the other: a transitions rule can take readings as
values before the entity it judges is a named type.
