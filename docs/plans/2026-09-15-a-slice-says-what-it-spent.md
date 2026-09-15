# A slice says what it spent

> A finished slice records the tokens its agent actually used, summed across the run rather than sampled from the last turn.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-plan-economics
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A slice records what its agent spent, in tokens, summed over the whole run. Plot could already source the number and never stated it.

<!-- Board impact: a new per-slice reading. Nothing in the plan format changes;
     the record is written beside the slice's other machine-local state. -->

## Design

**Plot can already source this and has never stated it.** That is the story's
own framing, and it is exactly right — but the gap is narrower and differently
shaped than *"nothing is recorded"*.

### What exists reads the LAST TURN, and that is deliberate

`readTranscriptFacts` returns three things: `model`, `contextTokens` and
`contextSpend`. Both numbers describe **one turn**:

- `contextTokens` — *"Tokens the last turn read back as context"*,
  `cache_read_input_tokens` alone, rendered by the board's panel since
  2026-08-19.
- `contextSpend` — *"Every input token the last turn carried"*, `input_tokens`
  plus both cache fields, *"the number a context ceiling is a fraction of"*.

The file keeps them apart on purpose. Neither answers *what did this cost*: both
are snapshots for a ceiling, and **`output_tokens` is read nowhere on the
estate**.

**So this is a new derivation, not an extended field.** A cost is a sum over
every turn of the run, including output. Widening `contextSpend` would break the
ceiling it exists for — the two numbers must stay apart.

### The chain from a slice to its transcript already exists

`transcriptDir(worktree)` resolves `~/.claude/projects/<slug>`, and
`registry.ts:137` documents `session` as *"the transcript join key"*. A desk maps
to a slice, so slice → session → transcript is a path Plot already walks.

**And the transcript outlives the desk.** It is written under `~/.claude/`, not
inside the worktree, so reaping a desk does not destroy the record. That is what
makes a reading after the fact possible at all.

### The record is written at the END of a run, and here is why

**A transcript is machine-local.** `~/.claude/projects/` is not in the
repository and not on any other clone — so a number derived on demand can be
read on the machine that ran the agent and nowhere else. A plan's cost read from
a colleague's checkout would be silently zero.

So the sum is computed **when the worker finishes**, on the machine that has the
transcript, and written where the slice's other machine-local state already
lives. A later reader gets a recorded fact rather than a derivation that only
works in one place.

**It is written once and never updated.** A spend is what a run cost; a second
run is a second record. That keeps the number a measurement rather than a
running total nobody can place in time.

### Four counters, and the sum states which

`input_tokens`, `output_tokens`, `cache_creation_input_tokens` and
`cache_read_input_tokens` — the four a transcript carries, with the `model` per
turn. The record keeps them **separate rather than pre-summed**: they price
differently, the story's own narrowing says tokens are a derivation and francs
are not, and a single number would force a price table to be invented later to
take it apart again.

**The model is recorded beside them** for the same reason: the same count on two
models is two different costs, and a reader that has a price table needs to know
which.

### What this plan does not do

**No price table, no francs.** The story narrowed itself on 2026-08-29 by
measurement — a transcript carries four token counters and **no monetary
field** — and that was re-checked on 2026-09-14 and still holds.

**No per-plan rollup.** That is the sprint's Should and depends on this; a sum
over slices is trivial once the slices carry a number, and worthless before.

**No change to `contextTokens` or `contextSpend`.** They answer a ceiling
question, they are rendered today, and this plan adds a third reading beside
them.

## Slices

### A slice says what it spent (Branch: feature/a-slice-says-what-it-spent)

- `feature/a-slice-says-what-it-spent` — sum the four token counters and record the model across a run's whole transcript, write the record when the worker finishes, and read it back per slice without re-deriving

**Done when** a finished slice carries a record naming all four counters and the
model; the sum is over **every** turn of the run rather than the last; a run with
no readable transcript records nothing and says so rather than recording zero;
`contextTokens` and `contextSpend` are unchanged and the board's panel still
renders what it rendered before; a second run of the same slice writes a second
record rather than mutating the first; and `pnpm run test:contracts` passes.

## Notes

**The third Must of sprint W41**, and the first plan of `plot-plan-economics` —
a story that has been `draft` with zero plans since 2026-08-27.

**Zero is the dangerous answer here.** A transcript that cannot be read, a desk
reaped on another machine, a run that never started — each must record *nothing*
and say so. A recorded zero is indistinguishable from a free run, and a per-plan
sum over a zero is wrong in the direction nobody checks.
