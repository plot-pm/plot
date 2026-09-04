---
title: The domain knows what Plot knows
author: jwloka
status: draft
created: 2026-09-04
updated: 2026-09-04
---

# The domain knows what Plot knows

## Objective

Make every element Plot works with a **domain concept with a lifecycle a test
enforces** — so that what the system knows is stated once, in code, and a rule
refuses when the code disagrees with the design.

Today the elements travel as strings between shell scripts, and the rules about
them live in prose. That is not a gap in the design: the specs are careful. It
is that **nothing refuses.**

## Why Now

Three measurements taken on 2026-09-04, each a consequence of the same absence.

**Four of Plot's most-used words have a design spec and no type.**

| concept | `DESIGN-*.md` | domain type |
|---|---|---|
| Branch | yes | **none** |
| Plan | yes | **none** |
| Slice | yes | **none** |
| Review | yes | **none** |

`grep "^export \(interface\|type\) Branch\b"` over `packages/domain/src` returns
nothing, and the same for the other three — while 23 entities exist, including
`channel-message` and `subscription`. `SourceBranchSchema:125` opens
`branch: z.string()`.

**Twenty-one state enums, one transitions rule.** `AgentState`, `BranchState`,
`WorktreeState`, `StoryStatus`, `ReleaseState`, `BuildState` and fifteen more
each declare a set of states. Exactly one — `transitions/plan.ts` — says which
transition is legal. `WorktreeState` reads `created → occupied → finished →
reapable → gone`, and nothing refuses `gone → occupied`.

**And the estate cannot leave GitHub.** `plot-pr-merged.sh` is 12 lines of code
under 75 lines of reasoning, sourced by ten scripts and read by three domain
files, and both its functions call `gh` directly. On a Bitbucket project `gh` is
absent; the script's own contract answers *not merged*; the fleet then never
reaps a worktree, never releases a ref, never advances a slice — **and reports
nothing**, because failing safe is what it was built for.

That last one is the story in miniature: a rule with no home lands in a script,
the script reaches one vendor's CLI, and the fail-safe hides it.

### CLAUDE.md already names the failure mode

> *"If your skill includes a MUST or NEVER instruction, ask: is this enforced by
> a hook, or just written in prose? **If prose-only, it's a rule and will
> eventually be violated.**"*

**Measured this session, three prose-only lifecycle rules violated:**

- an agent terminates **itself** (`plot-worker-loop.sh:626` SIGKILLs its own
  process group) while `DESIGN-agent.md:220` assigns the manifest — and the
  declaration — to the Registry. `registry.ts` holds no `kill` and no write.
- one agent reads **two states at once**: `finished` from the scan, `stalled`
  from the registry, from one function called two ways.
- **four state vocabularies** coexist — 8, 8, 8, and 5 at `registry.ts:35` —
  which `DESIGN-agent.md:797` already records as an open point.

None is a coding mistake. Each is a lifecycle nobody could enforce.

## Design

**A concept becomes a type. Its lifecycle becomes a rule. The rule refuses, and
a test proves each refusal.** The script keeps only the reading.

The shape already exists twice over and was never generalised:

- **`transitions/plan.ts`** — `Precondition`, `RefusalReason`, `Decision`,
  `TransitionResult`, with **41 tests and 24 refusal assertions**, called from a
  bundle by `plot-approve.sh`, `plot-deliver.sh` and `server/entry/transition.ts`.
- **Five domain bundles** — `plot-verdicts.mjs`, `plot-transition.mjs`,
  `plot-movable.mjs`, `plot-monitor.mjs`, `plot-prompt.mjs` — rules compiled and
  called from shell. `plot-fleet-scan.sh:3436` pipes readings into one.

**The rules take readings as values.** `reap(readings, input)`, the shape
`rules/reapable.ts` already uses: nothing awaits, nothing spawns, the caller
reads and the rule judges.

### A state enum is not always a lifecycle

`SprintState` is `must | should | could | deferred` — a **priority**, and a Could
Have becoming a Must Have is re-prioritisation. `PrState` is `mergeable |
conflicting | unknown`, a **reading of a moment**.

So the completing gate reads a **declaration, not a heuristic**: an entity has a
`transitions/<name>.ts`, or its enum carries one line saying it does not
transition and why. A gate that guessed would refuse a priority for lacking a
transition it cannot have, and the fix would be a rule that lies.

### What stays in shell

**A script survives when it IS a process.** Measured across all 36:
`plot-worker-loop.sh` alone qualifies — 3 traps, 4 background launches, 4 signal
kills. It is the process bracket, and only its rules leave.

`plot-config.sh` and `plot-host.sh` are pure adapter: no rule to extract. They
go when their callers are gone, not before.

## Jobs to be done

- **A rule refuses an illegal transition, and a unit test proves it** — for the
  three lifecycles measurably violated first: Agent, Worktree, Slice.
- **An element is a type rather than a string** — Branch, Plan, Slice, so a
  question about one is asked of the domain rather than re-derived from fields.
- **Plot runs on a host that is not GitHub** — the merge question answered
  without `gh`, which is the single thing blocking a Bitbucket project today.
- **Nothing hides a lifecycle again** — a ratchet counting state enums with
  neither a rule nor a stated reason, starting at the measured 21 and falling.

## Excluded from Scope

**Not a rename.** `the-board-says-slice` moved the board's vocabulary from 1,835
`wave` to 364; this gives that vocabulary something to refer to.

**Not the supervisor's questions.** `the-master-agent-holds-the-fleet` asks what
a supervisor can find out, and says of itself: *"Plot has 22 helper scripts and
they are good. This story is not about missing capability."* This story makes the
opposite claim about the same scripts — that they are where the rules wrongly
live — so the two must not share a slug.

**Not scheduling.** Declaring agents and typing branches makes *choosing* one
possible; it does not perform it. `hasRoomToDispatch`
(`entities/machine.ts:99`) is a boolean about headroom, not a choice among
candidates.

**Not `plot-worker-state.sh`.** `the-domain-owns-the-agent-lifecycle` owns its
migration and started 2026-09-04. Two plans converting one script is how the
duplication this repo measured on 2026-08-18 — five of six states carried twice
— comes back.

## Open Points

- **Does every entity earn a transitions file?** `Person`, `Version` and
  `Identity` may have no transitions at all. A file per entity is a shape, not a
  quota — which is why the gate reads a declaration.
- **Where does a refusal surface?** The board renders some, a hook blocks
  others, a script exits non-zero. The rule answers; who acts on the answer may
  not be uniform.
- **Which document is wrong, where they disagree?** Three cases are known.
  `DESIGN-agent.md:787` calls a synthesized entry *"a defect, not a category"*
  while `entities/agent.ts:29` encodes it as an identity — and **the code is
  currently right**, because nothing can be declared. Each disagreement is a
  decision, and neither answer is free.

## Session Log

**2026-09-04** — Written after a review of the fleet layer (Machine, Registry,
Board) and four rounds of interrogation across two plans. Every count measured
on `main` that day: 36 scripts, 7,795 lines of code, 23 entities, 21 state
enums, 1 transitions rule, 5 existing bundles.

The story was extracted from `the-master-agent-holds-the-fleet` after that
story's own objective was read back: it is about the questions a supervisor
asks, and explicitly not about the scripts. Two plans already written under it —
`every-element-is-a-domain-concept` (#693) and
`a-lifecycle-is-enforced-by-a-test` (#698) — belong here instead.
