# A state is a word, not a sentence

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

### Not chosen: splitting `running` into finer states

The measurement above shows `running` covering at least three conditions
(thinking, between waves, idle-with-a-live-child). Tempting, and rejected here:

- It needs a **new source of truth** — CPU-to-elapsed ratio, or the child's
  command — where this plan needs one word.
- `AgentStateSchema`'s size is **pinned by a test**, deliberately, so a sixth
  state is a schema change with its own consumers.
- `isLiveState` is a denylist and `isBrokenState` an allowlist; a new state
  lands differently in each, which is a decision needing its own argument.

A finer vocabulary may well be right. It is a separate plan, and it starts from
a measurement this one supplies rather than from a rename.

### Not chosen: keeping the sentence and adding a state word beside it

Two fields saying nearly the same thing is how they drift. The column is the
state; the reassurance was never a state.

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
5. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by a reader, not by a test

The board's own tests assert the phrase renders — and it does. Nothing asserted
that the column's five values belong to one vocabulary, which is the property
that was broken.

That is the fourth defect this sprint found by someone looking at a running
board rather than by CI, and the third whose fix is *make the field answer the
question its column asks*.
