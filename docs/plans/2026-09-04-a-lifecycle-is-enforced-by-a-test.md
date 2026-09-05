# A lifecycle is enforced by a test

> Plan's lifecycle is a domain rule with 41 tests and 24 refusal assertions.
> The other twenty-two entities have their lifecycles in prose, and prose is a
> rule that eventually gets violated.

## Status

- **Phase:** Approved
- **Type:** feature
- **Sprint:** the-domain-owns-the-lifecycle
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-04, Jan Wloka, plan-PR #698 merged
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <branch>
- **Started:** 2026-09-05, Jan Wloka, `feature/a-story-lifecycle-refuses`
- **Started:** 2026-09-05, Jan Wloka, `feature/an-agent-lifecycle-refuses`
- **Started:** 2026-09-05, Jan Wloka, `feature/a-worktree-lifecycle-refuses`
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

- **An agent ends itself.** `plot-worker-loop.sh:1270` writes its own ending —
  `write_ending … bound bound` — and calls `exit 124` when it decides its bound
  expired, while `DESIGN-agent.md:220` gives the Registry the manifest and the
  agent's declaration. `registry.ts` holds no `kill` and no write at all.
- The same agent reads **two different states** at once: `finished` from the
  scan, `stalled` from the registry, because one caller passes a PR fact and the
  other deliberately does not.
- **A lifecycle is declared three times and the declarations disagree** — the
  Story case below, still live, and the one that cost a person an hour.

None of those is a coding mistake. Each is a lifecycle nobody could enforce.

**Two earlier entries in this list were re-measured on 2026-09-04 and no longer
hold.** They are removed rather than quietly corrected, because how they failed
matters to the argument.

The plan cited `plot-worker-loop.sh:626` as an agent SIGKILLing *its own process
group*. Reading every kill and exit in that script: all seven `_kill_tree` calls
target a **named child** — the prompt child, the watchdog, the monitor watcher,
the wait sleep. None touches the loop's own group. The violation is real but it
is a different act, at `:1270`, and stated above as what it is.

The plan also cited *"four state vocabularies — 8, 8, 8, and 5 at
`registry.ts:35`"*. There are now **two declarations and one source**:
`registry.ts:44` reads `export type AgentState = ContractAgentState`, and
`schema.ts:2916` builds the board's enum as `...DomainAgentStateSchema.options`
plus `unknown` — a deliberate extension rather than a copy. The estate fixed
that one, in exactly the direction this plan argues for, while the plan sat
unapproved.

**That is evidence for the approach rather than against it** — and it is why the
ordering below now leads with the disagreement that is still live.

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

**Per entity: a `transitions/<entity>.ts`, and a test asserting every refusal.**
`transitions/plan.ts` is the template for the refusal half — the same
`Precondition`, `RefusalReason` and `Refusal`, so a caller that reads one reads
them all.

**But there are two shapes, not one, and the difference is in the spec.**
`DESIGN-plan.md:810`: *"Plan and Story are the only two entities whose state is
a stated fact rather than a derived relation."*

| | stated state | observed state |
|---|---|---|
| entities | Plan, Story | Agent, Worktree, Slice |
| the state lives in | a file Plot writes | disk, refs, the process table |
| a transition is | **writes the caller performs** | **a verdict on a change that already happened** |
| the decision carries | `{ slug, phase, field, record }` | the judgement, and nothing to write |

`Decision` as it stands is plan-specific to its bones: `field` is typed
`'Approved' | 'Delivered' | 'Released'` and `record` is the text of a
`## Status` line. An Agent has no `## Status` section; nothing anywhere writes
a `WorktreeState`. Asking one `Decision` to serve both would abstract over a
distinction the spec calls fundamental — so the refusals are shared and the
decisions are not.

**This was found by interrogation rather than at implementation**, which is the
point of asking: the plan promised one shape and would have discovered the
second in its second slice, after the first had set a precedent that did not
fit.

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

**Five slices do not finish this.** Nineteen entities remain, and the failure
this plan exists to fix — a lifecycle nobody could enforce — recurs the moment a
new state enum lands without a rule beside it.

**Measured 2026-09-04: 37 `z.enum` occurrences, 1 transitions file.**
`AgentState`, `BranchState`, `WorktreeState`, `StoryStatus`, `ReleaseState`,
`BuildState` and thirty-one more each declare a set of states, and thirty-six of
them say nothing about which transition is legal. (An earlier count said 21; the
re-count is in the ratchet slice below, along with why it counts occurrences
rather than exported names.) `WorktreeState` reads `created →
occupied → finished → reapable → gone` and nothing refuses `gone → occupied`.

**So the last slice is a gate, in the estate's own ratchet form**
(`ci.yml:230` holds direct spawns at `allowed=28` and moved 65 → 19 one slice at
a time). It counts state enums with no transitions rule, fails when the number
GROWS, and never when it falls.

**A state enum is not always a lifecycle, and the gate must not pretend
otherwise.** `MoscowTier` is `must | should | could | deferred` — a
**priority**, and a Could Have becoming a Must Have is a re-prioritisation
rather than a transition. `Mergeability` is `mergeable | conflicting | unknown`,
a **reading of a moment** that nothing moves between.

**This paragraph named the wrong enum twice, and the mistake is the argument.**
It cited `SprintState`, which is `Planning | Committed | Active | Closed` — a
lifecycle — and `PrState`, which is `OPEN | MERGED | CLOSED` and is about the
clearest lifecycle in the repo. Both corrections were found by reading the
source on 2026-09-04, after the same two errors were caught in the story.

`entities/pr.ts` is why it happened: four enums in one file, of which
`PrState` transitions and `Mergeability`, `Checks` and `ReviewVerdict` do not.
Reaching for the file and taking the first enum finds the exception. **A
heuristic reads exactly that way** — which is the case for the declaration,
made here by a writer who twice got it wrong while arguing for it.

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
      `MoscowTier` is a priority and `Mergeability` a reading; neither
      transitions. An entity has a rule or says why it has none.
      *(This answer originally cited `SprintState` and `PrState`, both of which
      are lifecycles. The conclusion is unchanged and the evidence for it is
      stronger: a writer arguing for a declaration picked the wrong enum twice.)*
- [ ] **Where does a refusal surface?** The board renders some; a hook blocks
      others; a script exits non-zero. The rule answers; who acts on the answer
      is per entity and may not be uniform.
- [ ] **Do the specs need amending as this lands?** Three disagreements are
      already known. Each is a decision about which document is wrong, and
      neither answer is free.

## Slices

### The story's lifecycle

- `feature/a-story-lifecycle-refuses` — `transitions/story.ts`. **The one
  lifecycle that is already declared three times, disagreeing.** — PR #707
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
### The agent's lifecycle

- `feature/an-agent-lifecycle-refuses` — `transitions/agent.ts`. The eight
  states `DESIGN-agent.md` names, and the refusals it already states: an agent
  is terminated by the Registry, a manifest belongs to the Registry, `elsewhere`
  means no worktree on this machine. — PR #710

  **Asserted: an agent cannot end itself on a bound** — `plot-worker-loop.sh:1270`
  does exactly that today, writing `write_ending … bound bound` and calling
  `exit 124`, so the test fails against current behaviour and names the line.

  **The assertion is narrow on purpose.** An earlier draft asserted that an agent
  cannot terminate itself at all, citing a SIGKILL of its own process group that
  does not exist: all seven `_kill_tree` calls in that script target a named
  child. A test written against the general claim would have **passed on the day
  it was written** — a refusal that refuses nothing, which is the shape a gate is
  supposed to prevent. Verify which exit is the violation, then assert against
  that exit.

### The worktree's lifecycle

- `feature/a-worktree-lifecycle-refuses` — `transitions/worktree.ts`. The five
  measurements `plot-reap.sh` already refuses on and the five guards
  `plot-release-refs.sh` applies are one question about a desk. **Asserted: a
  reaped checkout is re-creatable and a deleted ref is not** — the asymmetry
  that makes those two scripts refuse differently, currently held only in their
  comments. — PR #716


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

  **The declaration sits at the enum, and the file is checked separately.**
  A file cannot carry it: `entities/sprint.ts` holds **three** enums —
  `SprintState` is a lifecycle, `MoscowTier` and `ItemStatus` are not — so a
  `transitions/sprint.ts` would satisfy the gate for all three, including the two
  that must never have one. `rules/verdict.ts` is worse: it holds
  `StartabilityVerdict` and `BriefState`, for entities that do not share its
  name. **There is no reliable enum → entity mapping**, so the unit is the enum,
  which is also the thing that can hide.

  **The pattern exists in this repo already.**
  `scripts/check-ancestry-decisions.sh` bans an *undeclared decision* rather than
  a call, requiring `# plot-ancestry: prefilter|evidence` within five lines of
  each ancestry call — because no grep can tell the two kinds apart and the
  difference is what the answer flows into. This gate is the same act: a marker
  within N lines of each `z.enum` saying `lifecycle`, `reading` or
  `classification`, and a dedicated script rather than an inline `grep` in
  `ci.yml`.

  **Where the marker says `lifecycle`, the gate also requires the rule.**
  Marker alone would let a lifecycle be declared and never written; the file
  check alone cannot see which enum it covers. Together they answer both halves,
  and neither can be satisfied by accident.

  **Its job is to stop 38, not to reach 0.** Four rules land in this plan, so the
  count ends near 33 and the target stays debt. That is the point: every enum
  added after it must declare its kind, which is the failure this story exists to
  prevent — and the 37 declarations are themselves the review that finds the next
  lifecycle nobody had noticed.

### The slice's lifecycle

- `feature/a-slice-lifecycle-refuses` — `transitions/slice.ts`. Eligible,
  claimed, waiting, merged, deferred — and the `waits:` prerequisite
  `a-slice-can-wait-on-another-plan` introduced. **Asserted: a prerequisite that
  merged and was then reaped still clears**, the deadlock that plan was
  corrected to avoid, now enforced rather than remembered.

## Notes

Written 2026-09-04. Counts measured on `main` that day: 23 entities, 1
transitions file, 41 tests and 24 refusal assertions in the one that exists.

**Story is first, because it is the disagreement still standing.** The plan
ordered by what was being violated; two of those three were fixed while it sat
unapproved, and the one that remains is Story — the domain admitting six states
with an archival invariant while `deriveStoryStatus` returns a seventh its type
cannot hold. It is also the cheapest of the four to prove.

**The vocabulary lands first, in its own plan.**
`the-workflow-owns-the-word-phase` gives the development workflow its five
phases and renames the plan's `Phase` to `PlanState`. These four rules are
written after it, in the corrected vocabulary — writing them first would copy
the conflation into four new files, and renaming them afterwards would be a
second pass over work that had just landed.

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

**Interrogated 2026-09-04, one round**, and it found the motivation had gone
stale in the days the plan sat unapproved.

**Two of the three cited violations no longer hold.** `registry.ts` no longer
declares its own `AgentState` — `:44` imports it, and `schema.ts:2916` extends
the domain's options with `unknown` rather than copying them, so the *"four
vocabularies, 8/8/8/5"* is now two declarations and one source. And no kill in
`plot-worker-loop.sh` targets the loop's own process group: all seven
`_kill_tree` calls name a child.

**The kill finding changed an assertion rather than just a citation.** The plan
asserted *an agent cannot terminate itself* as a test that would fail against
current behaviour. Against the code as written, it would have **passed on day
one** — a refusal that refuses nothing. Reading every exit path found the real
violation at `:1270`: the loop writes its own ending and calls `exit 124` when it
decides its bound expired. The assertion now names that exit.

**And the ordering moved.** The plan orders by what is being violated; with two
violations gone, Story leads — the domain admitting six states with an archival
invariant while `deriveStoryStatus` returns a seventh its type cannot hold, which
cost a person an hour that same day.

That two violations were fixed in the direction this plan argues for is evidence
for the approach. It is also the argument for the ratchet: the estate corrects
what it can see, and a lifecycle nobody can see stays broken.

**Round 2, 2026-09-04.** Two findings, both about mechanics the plan had
asserted rather than checked.

**There are two transition shapes, not one.** The plan said all four files would
be *"shaped like `transitions/plan.ts`"*. Its `Decision` is plan-specific to its
bones — `field` typed `'Approved' | 'Delivered' | 'Released'`, `record` the text
of a `## Status` line — and `DESIGN-plan.md:810` already says why: Plan and Story
state their own state, while an Agent's, a Worktree's and a Slice's are observed.
Nothing writes a `WorktreeState`. The refusals stay shared; the decisions
diverge, and the plan says so before the second slice discovers it.

**The ratchet cannot key on a file.** It promised to count enums lacking
`transitions/<entity>.ts`, but `entities/sprint.ts` holds three enums of two
kinds and `rules/verdict.ts` holds enums for entities that do not share its name
— there is no reliable enum → entity mapping. The declaration moves to the enum,
following `scripts/check-ancestry-decisions.sh`, which bans an undeclared
decision for the same reason: no grep can tell the kinds apart. Where a marker
says `lifecycle`, the gate additionally requires the rule to exist, so neither
half can be satisfied alone.

Both were reachable only by reading the code the plan proposed to change. The
first would have surfaced in slice two, after slice one had set a precedent that
did not fit.
