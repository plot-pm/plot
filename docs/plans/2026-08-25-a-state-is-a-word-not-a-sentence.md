# A state is a word, not a sentence

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** 2026-08-25
- **Released:** 2026-08-26, 2.9.0
- **Started:** 2026-08-25, Jan Wloka, `bug/a-running-agent-reads-running`
- **Started:** 2026-08-25, Jan Wloka, `feature/a-running-worker-says-if-it-is-idle`

## Changelog

An agent's state column reads a state. `running` says so in the vocabulary its
four siblings use, rather than in a sentence about a person.

## Motivation

### The measurement

Reported from a running board on 2026-08-25, in the reader's own words:
*"'someone is on it' is no agent status."*

`agentStateStatus` (`tuple-row.ts:829`) maps five registry states to five
display words. Four of them return their own name:

| state | renders |
|---|---|
| `waiting` | `waiting on you` |
| `stalled` | `stalled` |
| `finished` | `finished` |
| `unknown` | `unknown` |
| **`running`** | **`someone is on it`** |

Four answer *what state is this agent in?* One answers *should you worry about
this row?* — a different question, in a different grammar.

### The column carries no information where it is used

Measured on the same board: WORKING held **11 rows, every one `running`**, so
the column read `someone is on it` eleven times. A field identical on every row
in the section that renders it is not describing anything.

That is worse than it looks, because the section is where a reader goes to ask
*which of these needs me?* — and eleven identical answers say *none of them*,
whether or not that is true.

### The docstring argues the case against itself

`agentStateStatus` states its own rule:

> a row whose usual state is a lie teaches its reader to ignore the row

Correct, and the same sentence condemns a word that is *always* the same: it
teaches the reader to ignore the column by being uninformative rather than by
being false. The rule wants **every state to say its own condition plainly**,
and four of five already do.

### `running` is also coarser than what it describes

Measured across the eleven live workers, comparing the loop shell's CPU time to
its elapsed time and reading the child process:

- **9 of 11** loop shells at **0.01s CPU** over hours, each with a live `claude`
  child holding 1.5+ minutes of CPU — a worker that had merged its PR and moved
  on to the next wave.
- **2 of 11** with CPU on the shell itself.

Every one reports `running`, which is true and tells a reader nothing about
whether the worker is thinking, building, waiting on CI, or between waves. This
plan does **not** fix that — see *Not chosen* — but it is the reason the
one-word rename is worth doing on its own: the word should be honest about being
coarse rather than dressed up as a reassurance.

## Design

### `running` renders `running`

One line in `agentStateStatus`. The five states then share one vocabulary, and
the column answers exactly one question.

### The contract this changes, and where

`someone is on it` is asserted in **18 places across 8 files** — not an
oversight, a deliberate contract:

| file | refs |
|---|---|
| `src/app/lib/tuple-row.ts` | 3 |
| `src/app/lib/agent-rows/rows.tsx` | 2 |
| `src/app/lib/agent-rows/row-identity.ts` | 1 |
| `test/unit/tuple-row.test.ts` | 5 |
| `test/integration/working-shows-every-agent.browser.test.ts` | 2 |
| `test/integration/agents-tab.browser.test.ts` | 2 |
| `test/integration/unreachable-overlay.browser.test.ts` | 1 |
| `test/integration/wave-in-working.browser.test.ts` | 1 |

**The tests are rewritten, not deleted.** Several assert the phrase *on
purpose* — `working-shows-every-agent` has a case literally named *reads
"someone is on it" for a running worker*. That test documents the behaviour this
plan reverses; it becomes the assertion that a running worker reads `running`,
with its docstring saying why the earlier contract was withdrawn.

This is the same anti-contract shape `plan-row-wave-actions` needed when the
second `⋯` was removed.

### The row says when a running worker is idle

`running` is honest and coarse. A second, secondary cue says which kind of
running this is — **without adding a sixth state**.

The signal is already on the process table and needs no new bookkeeping.
Measured on `bug/a-ready-pr-asks-for-you`, 2026-08-25:

```
shell pid 75455    cpu 0:00.01   elapsed 09:54:42     ← parked
its claude child   cpu 1:06.77   elapsed 09:54:42     ← thinking
```

The loop shell is *always* near-zero CPU — it waits on its child — so the shell
alone says nothing. **The child's CPU is the discriminator**, and reading it is
what separates *a worker mid-thought* from *a worker whose child has gone*.
Measured across the fleet: 9 of 11 shells at 0.01s, every one with a live child
holding 1.5+ minutes.

`plot-worker-state.sh` is the ONE answer to *is a worker running in this
worktree?* and already answers eight states including `waiting` and `stalled`.
The idle cue belongs there, not in a second implementation on the board — the
board renders what the script reports.

**It is a cue, not a state.** `AgentStateSchema` stays five, `isLiveState` and
`isBrokenState` are untouched, and a row reads `running` with a mark beside it
rather than a new word nothing else understands.

### Not chosen: a sixth state in the enum

The obvious alternative — `idle` beside `running`. Rejected on three counts:

- `AgentStateSchema`'s size is **pinned by a test**, deliberately, so a sixth
  member is a schema change with its own consumers.
- `isLiveState` is a **denylist** and `isBrokenState` an **allowlist**, so a new
  state is live-by-default and broken-never — it would silently join WORKING and
  never WAITING ON YOU, which may be right but is a decision needing its own
  argument.
- An idle worker with a live child **is** running. Promoting a temporary
  condition to a peer of `stalled` overstates it.

### Not chosen: keeping the sentence and adding a state word beside it

Two fields saying nearly the same thing is how they drift. The column is the
state; the reassurance was never a state.

## Slices

### Worded (Branch: bug/a-running-agent-reads-running, PR: #421)

`agentStateStatus` returns `running` for a running agent, and the 18 assertions
of `someone is on it` are rewritten to the new contract.

### Marked (Branch: feature/a-running-worker-says-if-it-is-idle, PR: #424)

`plot-worker-state.sh` reports whether a running worker's CHILD is doing work,
the fleet payload carries it, and the row wears a secondary cue — no sixth state.

## Done when

1. A `running` agent's row reads `running`. Asserted at the unit level on
   `agentStateStatus` and in a browser test on a rendered row.
2. **All five states still render their own distinct word**, asserted over the
   whole `AgentStateSchema` enum with its size pinned — a sixth state must not
   be able to appear without this failing.
3. No occurrence of `someone is on it` remains in `src/` or `test/`. This is the
   assertion a partial implementation fails: changing the function while leaving
   the browser tests asserting the old string leaves a green suite over a
   contradiction.
4. The tests that asserted the phrase are **rewritten to assert the new
   contract**, with docstrings saying why it changed — not deleted, and not
   loosened to match whatever the code now emits.
5. **A running worker whose child is doing work reads differently from one whose
   child is not.** Asserted on both, because a cue that never fires and a cue
   that always fires are equally useless — and the shell's own CPU is near-zero
   in BOTH cases, so an implementation reading the shell passes neither.
6. **`AgentStateSchema` still has exactly five members**, with its size pinned.
   This is the assertion that keeps the cue a cue: an implementation that adds
   `idle` as a sixth state satisfies item 5 and changes what `isLiveState` and
   `isBrokenState` classify.
7. A worker with no live child at all is unaffected — it is `stalled` or
   `unknown` by the existing rules, and this plan does not touch them.
8. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by a reader, not by a test

The board's own tests assert the phrase renders — and it does. Nothing asserted
that the column's five values belong to one vocabulary, which is the property
that was broken.

That is the fourth defect this sprint found by someone looking at a running
board rather than by CI, and the third whose fix is *make the field answer the
question its column asks*.
