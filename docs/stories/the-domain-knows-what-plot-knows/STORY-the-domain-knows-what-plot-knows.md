---
title: The domain knows what Plot knows
author: jwloka
status: draft
created: 2026-09-04
updated: 2026-09-04
---

# The domain knows what Plot knows

## Objective

Give **every element Plot works with a lifecycle the domain owns**: a type, a
rule that refuses an illegal transition, and a test that proves each refusal.
Then hold it with a gate, so an element added later cannot arrive without one.

The elements exist. The lifecycles are written down carefully, in
`DESIGN-*.md`, in `CLAUDE.md`, in skill prose. What is missing is anything that
**refuses** — so the documents and the code drift, and the drift is discovered
by a person reading a diff.

## Why Now

**35 state enums. One transitions rule.** Measured on `main`, 2026-09-04:
`packages/domain/src` declares 35 named `z.enum` state sets across 20 files, and
`transitions/plan.ts` is the only file that says which move between states is
legal. `WorktreeState` reads `created → occupied → finished → reapable → gone`
and nothing refuses `gone → occupied`.

**A lifecycle already answers two ways, and both are self-consistent.**
`StoryStatusSchema` (`entities/story.ts:10`) admits six states, `archived` not
among them; the domain says archiving is two writes that must agree —
`status: done` **and** an `archived:` date — and asserts it as an invariant
(`story.ts:74`). Meanwhile `deriveStoryStatus` (`board.ts:1363`) returns a
seventh status string, `'archived'`, whenever every plan is released — a rule
the domain never states, producing a value its type cannot hold.

Neither side is sloppy. They are two careful answers to one question, which is
what a lifecycle with no owner looks like.

**The cost is paid by people, not by CI.** That same disagreement was met on
2026-09-04 while consolidating the story estate: five stories were marked
`done`, three of them wrongly, and what caught it was the board rendering a ⚠️
and a human reading it. A rule would have refused the write.

**And the estate cannot leave GitHub.** `plot-pr-merged.sh` is 12 lines of code
under 75 lines of reasoning, sourced by ten scripts and read by three domain
files, and both its functions call `gh` directly. On a host without `gh` its own
contract answers *not merged*, so the fleet never reaps a worktree, never
releases a ref, never advances a slice — **and reports nothing**, because
failing safe is what it was built for.

It is the worst of seven, not the only one. Measured 2026-09-04, six further
scripts reach `gh` without going through `plot-host.sh`:
`plot-reconcile-scan.sh` (two live `gh pr list` calls, `:291` and `:302`),
`plot-update-board.sh`, `plot-budget.sh`, `plot-agent-monitor.sh`,
`plot-worker-monitor.sh` and `plot-pr-state.sh`. The others break loudly on a
host without `gh`; this one goes quiet, which is why it is named first.

**And the failure mode is already named in this repo.** `CLAUDE.md`:

> *"If your skill includes a MUST or NEVER instruction, ask: is this enforced by
> a hook, or just written in prose? **If prose-only, it's a rule and will
> eventually be violated.**"*

Three prose-only lifecycle rules, measured violated this session:

- an agent terminates **itself** — `plot-worker-loop.sh:626` SIGKILLs its own
  process group — while `DESIGN-agent.md:220` gives the Registry the manifest
  and the declaration. `registry.ts` holds no `kill` and no write.
- one agent reads **two states at once**: `finished` from the scan and
  `stalled` from the registry, out of one function called two ways.
- **four state vocabularies** coexist — 8, 8, 8, and 5 at `registry.ts:35` —
  which `DESIGN-agent.md:797` already records as an open point.

None is a coding mistake. Each is a lifecycle nobody could enforce.

## Design

**A concept becomes a type. Its lifecycle becomes a rule. The rule refuses, and
a test proves each refusal.** The script keeps only the reading.

### The shape exists; it was never generalised

`transitions/plan.ts` is the template, and its three exports per transition are
the load-bearing part:

```
approvable(plan)            → boolean          the predicate
approve(plan, input)        → TransitionResult the transition
TransitionResult = Decision | Refusal          the union
```

A refusal is a **value the caller must destructure**, never an exception it can
forget to catch. `isDecision` / `isRefusal` are type guards, so reading
`decision.writes` without first proving it was not a refusal is a compile
error. That is the gates-over-rules principle reached through the type system:
the compiler refuses, so no reviewer has to remember.

It carries **41 tests, 24 of them refusal assertions**, and is called from a
bundle by `plot-approve.sh`, `plot-deliver.sh` and `server/entry/transition.ts`
— one rule, three entrances, no second implementation.

**The rules take readings as values.** `reap(readings, input)`, the shape
`rules/reapable.ts` already uses: nothing awaits, nothing spawns; the caller
reads and the rule judges. Five bundles already ship this way
(`plot-verdicts.mjs`, `plot-transition.mjs`, `plot-movable.mjs`,
`plot-monitor.mjs`, `plot-prompt.mjs`), so a shell caller is a solved problem
rather than a reason to leave the rule in shell.

### Not every enum is a lifecycle, and the gate must not guess

Of the 35, three kinds are present and only one transitions:

| kind | asks | example | owes a rule? |
|---|---|---|---|
| **lifecycle** | what may happen next? | `WorktreeState`, `ReleaseState`, `StoryStatus`, `BuildState` | **yes** |
| **reading** | what is true right now? | `MergeabilitySchema`, `HeadroomSchema`, `AgentActivity` | no — a moment, not a move |
| **classification** | which kind is this? | `MoscowTier`, `IdentityKind`, `MonitorName` | no — re-labelling is not a transition |

`MoscowTier` (`must | should | could | deferred`) is the clarifying case: it
looks ordered and is not. A Could Have becoming a Must Have is
re-prioritisation, and a transition rule over it would refuse a legitimate
planning act.

**And its neighbour is the trap.** `SprintStateSchema` — `Planning | Committed |
Active | Closed` — sits **one line above it in the same file** and *is* a
lifecycle. Two enums, adjacent, opposite kinds, and the names give no hint: an
earlier draft of this story cited `SprintState` for the priority example and was
wrong. If a careful reader misreads it while writing the story about it, a
heuristic will misread it too.

**So the gate reads a declaration, never a heuristic.** An enum either has a
`transitions/<name>.ts`, or carries one line saying which kind it is and why it
does not transition. A gate that inferred the kind would demand a rule from a
priority and get a rule that lies.

**And it must count `z.enum` occurrences, not exported names.** Measured
2026-09-04: 37 occurrences, **35** of them named exports. The other two —
`charter.ts:81` (`atCeiling`) and `fleet.ts:702` (`host`) — are inline field
enums with no name to hang a declaration on. A gate written against
`export const …Schema = z.enum(` would report a clean estate while skipping
them, which is the blind-spot shape [`a-nul-byte-blinds-a-grep-gate`] already
cost this repo six gates. An anonymous enum either gets a name or is declared
where it sits.

### The harness

Three pieces, in this order — each useless without the one before it:

1. **The inventory**, generated rather than typed: every state enum, its file,
   its declared kind, and whether a transitions file exists. It is the thing the
   gate counts and the thing a reviewer reads.
2. **The rule per lifecycle**, in `transitions/`, shaped like `plan.ts`, with a
   named `RefusalReason` per illegal move and a test per refusal.
3. **The ratchet**: `allowed=N` in CI over *undeclared* enums, starting at the
   measured count and only ever falling — the pattern four gates in
   `.github/workflows/ci.yml` already use, each with a dated comment recording
   what moved it.

**The ratchet counts the gap, not the good thing.** The vocabulary gate at
`ci.yml:431` records why this matters: it once counted the *correct* name, made
using it expensive, and a worker got past it by renaming the right entity to
`Cohort`. A gate teaches whatever it makes cheap. This one must make declaring a
lifecycle the cheap act and leaving one undeclared the expensive one.

### What stays in shell

**A script survives when it IS a process.** Measured across all 36:
`plot-worker-loop.sh` alone qualifies — 3 traps, 4 background launches, 4 signal
kills. It is the process bracket; only its rules leave.

`plot-config.sh` and `plot-host.sh` are pure adapter — no rule to extract. They
go when their callers are gone, not before.

## Jobs to be done

- **Every state enum declares its kind** — lifecycle, reading, or
  classification — so the inventory is complete and the gate has something true
  to count.
- **Every lifecycle has a transitions rule that refuses**, with a test per
  refusal, shaped like `transitions/plan.ts`.
- **The elements are types rather than strings** — Branch, Plan, Slice, Review —
  so a question about one is asked of the domain rather than re-derived from
  fields.
- **One answer per lifecycle** — the `StoryStatus` / `deriveStoryStatus`
  disagreement resolved in the domain, and the board reading the answer rather
  than computing a second one.
- **A ratchet holds it**, starting at the measured count of undeclared enums and
  falling to zero, so an element added later cannot arrive without a lifecycle.
- **Plot runs on a host that is not GitHub** — every script that asks the host
  asks it through `plot-host.sh`. Seven reach `gh` directly today;
  `plot-pr-merged.sh` is first because it fails silently where the others fail
  loudly.

## Excluded from Scope

**Not a rename.** `the-board-says-slice` moved the board's vocabulary from 1,835
`wave` to 364; this gives that vocabulary something to refer to.

**Not the supervisor's questions.** `the-master-agent-holds-the-fleet` asks what
a supervisor can find out, and says of itself: *"Plot has 22 helper scripts and
they are good. This story is not about missing capability."* This story makes the
opposite claim about the same scripts — that they are where the rules wrongly
live — so the two must not share a slug.

**Not scheduling.** Declaring agents and typing branches makes *choosing* one
possible; it does not perform it. `hasRoomToDispatch` (`entities/machine.ts:99`)
is a boolean about headroom, not a choice among candidates.

**Not `plot-worker-state.sh`.** `the-domain-owns-the-agent-lifecycle` owns its
migration and started 2026-09-04. Two plans converting one script is how the
duplication measured on 2026-08-18 — five of six states carried twice — comes
back.

**Not a rewrite of the board.** Where the board computes a lifecycle answer it
should read, the fix is to move that one computation. The 507 `function`
declarations stay as they are; the repo already measured what a style sweep
costs.

## Open Points

- **Does every entity earn a transitions file?** `Person`, `Version` and
  `Identity` may have no transitions at all. A file per entity is a shape, not a
  quota — which is why the gate reads a declaration rather than counting files.
- **Where does a refusal surface?** The board renders some, a hook blocks
  others, a script exits non-zero. The rule answers; who acts on the answer may
  not be uniform, and that is probably correct.
- **Which document is wrong, where they disagree?** Three cases are known.
  `DESIGN-agent.md:787` calls a synthesized entry *"a defect, not a category"*
  while `entities/agent.ts:29` encodes it as an identity — and **the code is
  currently right**, because nothing can be declared. Each disagreement is a
  decision, and neither answer is free.
- **Is `archived` a seventh state or a derived view?** The board says state, the
  domain says `done` plus a date. Both are defensible; the story needs one.

## Plans

| Plan | Status | What it covers |
|------|--------|----------------|
| [every-element-is-a-domain-concept](../../plans/2026-09-04-every-element-is-a-domain-concept.md) | Draft, PR #693 open | The TYPES: Branch, Plan and Slice stop being strings. Carries the host work — one slice per failure mode, because the four scripts that ask `gh` directly do not fail alike |
| [a-lifecycle-is-enforced-by-a-test](../../plans/2026-09-04-a-lifecycle-is-enforced-by-a-test.md) | Draft, PR #698 open | The RULES: `transitions/` for Agent, Worktree, Slice and Story, each refusing with a test per refusal, plus the ratchet that stops the next lifecycle hiding |

Both links resolve once the plan PRs merge — a plan reaches `docs/plans/` on the
default branch by being approved, so until then the file lives on its `idea/`
branch and the PR number is how to read it.

**The two are independent and either may land first.** Types and rules meet
only where a rule judges an entity, and the rules take readings as values
(`reap(readings, input)`), so a transition can be written and tested before the
thing it judges is a named type. Sequencing them would be ceremony.

### What they do not yet cover

Six Jobs, two plans, and the fit is not exact. Read against the Jobs above:

| Job | where |
|---|---|
| Every state enum declares its kind | `infra/a-state-declares-its-lifecycle` (#698) |
| Every lifecycle has a refusing rule | four slices in #698 |
| Elements are types rather than strings | three slices in #693 |
| One answer per lifecycle | `feature/a-story-lifecycle-refuses` (#698) |
| A ratchet holds it | `infra/a-state-declares-its-lifecycle` (#698) |
| Plot runs on a host that is not GitHub | three slices in #693 |

**Every Job is claimed, and that is not the same as finished.** #698 takes four
entities of the ten-odd that have lifecycles, and says so: Agent, Worktree and
Slice because they were measurably violated, Story because it is declared three
times over. The rest follow the same shape once these prove it, and the ratchet
is what makes their absence visible rather than forgotten — which is the whole
argument for building the harness before the remaining rules.

## Session Log

**2026-09-04** — Written after a review of the fleet layer (Machine, Registry,
Board) and four rounds of interrogation across two plans. Counts measured on
`main` that day: 36 scripts, 7,795 lines of code, 23 entities, **35 named state
enums across 20 files**, 1 transitions rule with 41 tests, 5 existing bundles,
4 existing CI ratchets.

Extracted from `the-master-agent-holds-the-fleet` after that story's own
objective was read back: it is about the questions a supervisor asks, and
explicitly not about the scripts. Two plans already written under it —
`every-element-is-a-domain-concept` (#693) and `a-lifecycle-is-enforced-by-a-test`
(#698) — belong here instead.

Re-framed the same day from *"every element is a domain concept"* to *"every
lifecycle is owned and enforced"*: the first framing named three lifecycles to
fix by hand, which leaves the thirty-second one to be found by a person reading
a diff. The inventory and the ratchet are what make it a harness rather than a
list.

**2026-09-04, challenged.** One round against the code, and it found three
errors in the story's own claims — all three in the direction of overstating how
clean the estate is.

1. **The priority example named the wrong schema.** `SprintStateSchema` is
   `Planning | Committed | Active | Closed` — a lifecycle. The priority enum is
   `MoscowTierSchema`, one line below it in the same file. The argument survives
   and is now stronger: two adjacent enums of opposite kinds, whose names give
   no hint, is the case for a declaration over a heuristic.
2. **The count was of names, not of enums.** 37 `z.enum` occurrences, 35 named
   exports; the two inline ones have nothing to declare a kind against.
3. **`plot-pr-merged.sh` is not the single GitHub blocker.** Six further scripts
   call `gh` outside `plot-host.sh`, two of them live on the reconcile path.

The pattern is worth keeping: every error was a claim that the problem was
smaller and tidier than it is. A story arguing that prose drifts from code
drifted from the code within a day of being written.
