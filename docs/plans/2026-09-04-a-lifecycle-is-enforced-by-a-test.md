# A lifecycle is enforced by a test

> Plan's lifecycle is a domain rule with 41 tests and 24 refusal assertions.
> The other twenty-two entities have their lifecycles in prose, and prose is a
> rule that eventually gets violated.

## Status

- **Phase:** Draft
- **Type:** feature
- **Story:** the-domain-knows-what-plot-knows
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

### Nothing may hide a lifecycle, and a gate says so

**Three slices do not finish this.** Twenty-two entities remain, and the failure
this plan exists to fix — a lifecycle nobody could enforce — recurs the moment a
new state enum lands without a rule beside it.

**Measured 2026-09-04: 21 state-shaped enums, 1 transitions file.**
`AgentState`, `BranchState`, `WorktreeState`, `StoryStatus`, `ReleaseState`,
`BuildState` and fifteen more each declare a set of states, and twenty of them
say nothing about which transition is legal. `WorktreeState` reads `created →
occupied → finished → reapable → gone` and nothing refuses `gone → occupied`.

**So the last slice is a gate, in the estate's own ratchet form**
(`ci.yml:230` holds direct spawns at `allowed=28` and moved 65 → 19 one slice at
a time). It counts state enums with no transitions rule, fails when the number
GROWS, and never when it falls.

**A state enum is not always a lifecycle, and the gate must not pretend
otherwise.** `SprintState` is `must | should | could | deferred` — a
**priority**, and a Could Have becoming a Must Have is a re-prioritisation
rather than a transition. `PrState` is `mergeable | conflicting | unknown`, a
**reading of a moment** that nothing moves between.

**The discriminator is a declaration, not a heuristic.** An entity either has a
`transitions/<name>.ts`, or its enum carries one line saying it does not
transition and why. **Measured: zero entities say so today**, so the gate starts
by making twenty of them state which they are — and that statement is the
review, in the place a reader meets the enum.

A gate that guessed would be worse than none: it would refuse a priority for
lacking a transition it cannot have, and the fix would be a rule that lies.

### Open Questions

- [x] **Does every entity earn a transitions file?** *Answered while writing:*
      no, and the gate must therefore read a declaration rather than guess.
      `SprintState` is a priority and `PrState` a reading; neither transitions.
      An entity has a rule or says why it has none.
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

### The story's lifecycle

- `feature/a-story-lifecycle-refuses` — `transitions/story.ts`. **The one
  lifecycle that is already declared three times, disagreeing.**
  `entities/story.ts:10` admits six states and no `archived`, and states the
  archival rule as an invariant: `done` and an `archived:` date are two writes
  that must agree (`archivalIsConsistent`, `:74`). The board's
  `contract/schema.ts:225` declares the same six **again, by hand**, importing
  nothing. And `deriveStoryStatus` (`board.ts:1363`) returns a **seventh**
  value, `'archived'`, that neither list admits — it types as `string`, so
  nothing objected.

  The duplicated six are the more dangerous half: they agree today, so nothing
  looks wrong, and they drift the moment one is edited. `deriveStoryStatus` is
  that drift, already happened.

  **Asserted: a status the domain cannot represent is a compile error**, which
  fails today at `board.ts:1371`. And **asserted: `archived` is derived, never
  stored** — the board's rule (every plan released) becomes a domain function
  over a story's plans, so the board reads the answer instead of computing a
  second one.

  A fourth reader has to agree too: `plot-story-lint.sh:91` decides S3 —
  *status done but not archived* — from its own parsing, and it is the check
  that catches a half-archived story today.

  **Measured 2026-09-04, and it cost a person rather than CI:** five stories
  were marked `done` while consolidating the estate, three of them wrongly. What
  caught it was the board rendering a warning and a human reading it; the two
  the lint then rejected went back to `active`. Every step was a correct reading
  of a different declaration.

### Refusing the next hidden one

- `infra/a-state-declares-its-lifecycle` — the ratchet. Counts state-shaped
  enums with neither a `transitions/<entity>.ts` nor a stated reason they do not
  transition; fails when the count grows. **Asserted: the gate fails on a new
  enum added without either**, because a ratchet nobody can trip is a comment.
  Starts at the measured number rather than zero — **37 `z.enum` occurrences,
  1 rule**, re-counted 2026-09-04 — so the migration lowers it slice by slice
  and the target is stated as a debt.

  **It counts occurrences, not exported names.** 35 of the 37 are named exports;
  `charter.ts:81` and `fleet.ts:702` are inline field enums with no name to hang
  a declaration on. A gate matching `export const …Schema = z.enum(` would
  report a clean estate while skipping them — the blind spot a NUL byte already
  cost this repo across six gates.

### The slice's lifecycle

- `feature/a-slice-lifecycle-refuses` — `transitions/slice.ts`. Eligible,
  claimed, waiting, merged, deferred — and the `waits:` prerequisite
  `a-slice-can-wait-on-another-plan` introduced. **Asserted: a prerequisite that
  merged and was then reaped still clears**, the deadlock that plan was
  corrected to avoid, now enforced rather than remembered.

## Notes

Written 2026-09-04. Counts measured on `main` that day: 23 entities, 1
transitions file, 41 tests and 24 refusal assertions in the one that exists.

**Four entities, not ten, and deliberately.** Agent, Worktree and Slice are the
three whose lifecycles were measurably violated this session. Story joined them
on 2026-09-04, when the story review found it declared **three times** — the
domain's six states, the board's hand-copied six, and a seventh the board
derives that neither admits. It is the cheapest of the four to prove, because
the disagreement is already visible and already cost a person an hour.

The remaining six follow the same shape once these prove it — and `issue`, whose
spec says most, is last because nothing is blocked on it.

**Related and separate.** `every-element-is-a-domain-concept` (#693) gives
Branch, Plan and Slice a TYPE. This gives them a LIFECYCLE. The types can land
first, but neither blocks the other: a transitions rule can take readings as
values before the entity it judges is a named type.
