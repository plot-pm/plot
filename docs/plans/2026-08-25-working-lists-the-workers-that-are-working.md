# WORKING lists the workers that are working

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

WORKING lists the agents that are actually working, and its count says how many
those are. A registry entry for a session that has ended is not a worker.

## Motivation

### The measurement

Found walking the v2.9.0 endgame checklist, Stop 4, 2026-08-25. The item's own
wording is the assertion that fails:

> **Working carries a parallel-agents stepper**, reading `N parallel agents · M
> working`. Check **M matches the agents you can actually see running** — not
> the registry's size.

From `/api/fleet` on a complete pulse, with the board restarted on current
`main` and the artifact rebuilt:

```
header:            10 parallel agents · 16 working
registry entries:  16
running:            4
```

`working` **is** the registry's size — the exact thing the item says it must not
be. Twelve of the sixteen rows are sessions that have ended:

| state | count |
|---|---|
| running | **4** |
| unknown | 7 |
| stalled | 5 |

Verified against the machine: four processes were alive.

### Why this is not a regression in #403

`the-working-count-is-the-rows` (#403) changed `working` from
`liveAgentCount(...)` to `entry.agents.length` (`fleet.ts:5279`), and it was
right to: the count and the rendered rows were two derivations that could
disagree, and now they cannot. `WORKING (16)` over sixteen rows is internally
honest.

**The rows are what is wrong, and the count faithfully reports them.** #403
answered *does the number match the section?* — it does. This plan answers the
question underneath: *should the section contain those rows at all?*

### The definition already exists, and is being contradicted

`auto-dispatch.ts:82` states which registry states mean a live worker:

```ts
const LIVE_STATES = new Set<AgentEntry['state']>(['running', 'waiting']);
```

That is the dispatcher's own rule — the one deciding whether a slot is free.
`AgentStateSchema` has five states: `running`, `waiting`, `finished`,
`stalled`, `unknown`. Three of them are not live, and the section lists all
five.

So the board disagrees with the dispatcher about what a worker is, in the one
place a reader goes to ask.

### Why `stalled` and `unknown` are not merely stale bookkeeping

**`unknown` is the honest answer to a question that could not be asked** — the
pid is gone and no exit code was recorded, so the session's fate is unknown. It
is emphatically not *running*.

**`stalled` says the opposite of working**: a worker that stopped with
uncommitted work on the floor. It needs a person, which makes it real and worth
seeing — but WAITING ON YOU is the section for *needs a person*, and calling it
`working` tells a reader the machine has it in hand.

Neither is noise to be deleted. Both are facts that belong somewhere other than
a list of who is working right now.

### What `the-registry-drops-a-settled-worker` already fixed, and did not

#407 drained the registry from 41 entries to 16 — every `finished` entry and 15
of 22 `unknown`. That is the reconciliation working.

The twelve that remain are held by **one tracked test fixture**,
`packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`, which
every board suite rewrites. #407's scratch filter names `.playwright-mcp`,
`.plot/agents` and `.omc/state` but not this path, so a worker that did nothing
but run its tests keeps a permanently dirty worktree and is never dropped.
Measured: **8 of 15 dirty worktrees are blocked by that path alone**. Reported
on the PR (#407 comment) rather than blocking its merge.

**Draining faster is not the fix, though — it is a second fix.** Even a
perfectly reconciled registry answers *which sessions exist*, and WORKING asks
*which are working*. A section must not depend on a cleanup job having run
recently to be true.

## Design

### WORKING renders the live states

`workingAgentRows` takes the registry and filters it to `LIVE_STATES` —
`running` and `waiting` — importing the set rather than restating it, so the
board and the dispatcher cannot drift on the definition of a worker.

The count follows the rows, exactly as #403 established: `working` is the length
of what WORKING renders. That property is preserved, not undone.

### A non-live entry is not lost

- **`stalled`** — a stopped worker with work on the floor — belongs in
  **WAITING ON YOU**. It is the definition of needing a person.
- **`unknown`** and **`finished`** carry no outstanding claim on anyone and need
  no row of their own; they drain through the reconciliation #407 added.

This is the same move `every-section-has-one-subject` made for an agent in
WAITING ON A MACHINE: the row was not deleted, it was put where its subject
belongs.

### Not chosen: filter the count, keep the rows

Sixteen rows under a header reading `4 working` reintroduces exactly the
disagreement #403 removed. The count is not the thing to change.

### Not chosen: rely on the registry being drained

Tempting, since #407 already drains it and a fixture-filter fix would drain more.
But then WORKING is true only as long as reconciliation has run recently, and a
section whose correctness depends on a cleanup job's timing is one that will be
wrong again. `LIVE_STATES` is true at the moment of render.

### Also: the fixture belongs in the scratch filter

Independent of the above, `PLOT_TOOL_SCRATCH` should name the tiny-garden pulse
file. It is the one tracked path the tests themselves mutate, and excusing it
does not weaken the gate — any *other* dirty path still keeps the entry.

## Waves

### Live (Branch: bug/working-lists-the-live-agents)

WORKING renders only `LIVE_STATES` entries, importing the set from
`auto-dispatch.ts` rather than restating it, and its count follows those rows.

### Stalled (Branch: bug/a-stalled-worker-needs-a-person)

A `stalled` entry reaches WAITING ON YOU, where *needs a person* is the
section's subject.

### Scratch (Branch: bug/the-scratch-filter-knows-the-fixture)

`PLOT_TOOL_SCRATCH` names the tiny-garden pulse fixture, so a worker that only
ran the test suite reconciles like any other.

## Done when

1. With a registry holding entries in all five states, WORKING renders exactly
   the `running` and `waiting` ones, and the header equals that number.
   Asserted over the whole `AgentStateSchema` enum, with its size pinned — a
   sixth state must not be able to appear without this failing.
2. **`working` still equals the number of rows WORKING renders**, in every
   fixture. This is #403's property, and re-asserting it is what stops this fix
   from reintroducing the mismatch it replaced.
3. `liveAgentCount` is unchanged and still feeds `auto-dispatch.ts`. The board
   consumes `LIVE_STATES`; it does not get its own copy.
4. A `stalled` entry appears in WAITING ON YOU — and **nowhere else**. The
   assertion a naive implementation passes without: filtering WORKING while
   forgetting the destination silently deletes the row that most needs a person.
5. A worktree dirty *only* with the tiny-garden pulse fixture reconciles as
   clean; a worktree dirty with anything else does not.
6. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by walking the checklist, not by running it

Stop 4's item is precise — *"not the registry's size"* — and it named this
before any test could. The board's own tests assert the count matches the rows,
which it does; nothing asserted that the rows are workers.

That is the third instance tonight of one rule: **a section's contents must
answer the section's question, and its count must answer to its contents.**
`every-section-has-one-subject` said it for an agent in WAITING ON A MACHINE,
`a-count-answers-to-its-section` says it for the header numbers, and this says
it for WORKING itself.

### The endgame checklist earned its keep here

Seven of this sprint's defects came from someone looking at a running board. This
one came from someone reading the checklist *against* a running board, which is a
cheaper way to find the same class of thing — and an argument for walking it
before the release rather than after.
