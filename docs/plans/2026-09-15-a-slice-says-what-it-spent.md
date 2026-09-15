# A slice says what it spent

> A finished slice records the tokens its agent actually used, summed across the run rather than sampled from the last turn.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-plan-economics
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 2

## Changelog

- A slice records what its agent spent, in tokens, summed over the whole run. Plot could already source the number and never stated it.

<!-- Board impact: a new per-slice reading. Nothing in the plan format changes;
     the record is written beside the slice's other machine-local state. -->

## Design

**Plot can already source this and has never stated it.** That is the story's
own framing, and it is exactly right — but the gap is narrower and differently
shaped than *"nothing is recorded"*.

### What exists reads the LAST TURN, and that is deliberate

`readTranscriptFacts` returns four things: `model`, `contextTokens`,
`contextSpend` and `lastActivity`. The two numbers describe **one turn**:

- `contextTokens` — *"Tokens the last turn read back as context"*,
  `cache_read_input_tokens` alone, rendered by the board's panel since
  2026-08-19.
- `contextSpend` — *"Every input token the last turn carried"*, `input_tokens`
  plus both cache fields, *"the number a context ceiling is a fraction of"*.
  **It has no render site**: measured 2026-09-15, zero references in
  `packages/board/src/app`. It is computed and not yet shown.

The file keeps them apart on purpose. Neither answers *what did this cost*: both
are snapshots for a ceiling.

**AND `output_tokens` IS ALREADY EXCLUDED BY A REASONED RULE, which this plan
must not contradict silently.** `rules/spend.ts:79` defines
`CONTEXT_USAGE_FIELDS` as the three input fields and says why the fourth is
missing: *"`output_tokens` IS DELIBERATELY ABSENT. It is what the turn produced,
not what it carried in; counting it would charge the agent twice for text that
arrives as input on the next turn anyway."*

That reasoning is correct **for a context ceiling** and does not transfer to a
cost. Output tokens are generated once and billed once; the double-count the
rule avoids is a double-count of *context occupancy*, not of spend. So this plan
records `output_tokens` **and says so against that rule** rather than appearing
not to have read it.

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
transcript.

**AND WHERE IT IS WRITTEN IS THE UNRESOLVED QUESTION, not a detail.**
`.plot/state/` is **git-ignored** — measured 2026-09-15. A record written there
is machine-local exactly as the transcript is, so a colleague's checkout still
reads nothing and the plan would have moved the problem rather than solved it.
The two honest options are a committed record, which puts per-run numbers in
git history, or an openly machine-local one that says so. **This plan does not
settle it**, and the slice must not proceed until it does.

**The exit path is already crowded.** `plot-worker-loop.sh:1591` installs
`trap _cleanup_on_exit EXIT`, and the loop is bounded by `Worker bound` — 28800s
here. A second's scan added to a shutdown that also pushes and opens a PR is
affordable; a scan that runs on the ALRM path at the bound is not obviously so,
and the plan must say which exits it runs on.

**It is written once and never updated.** A spend is what a run cost; a second
run is a second record. That keeps the number a measurement rather than a
running total nobody can place in time.

### Four counters, kept apart — and a naive total is FORBIDDEN

`input_tokens`, `output_tokens`, `cache_creation_input_tokens` and
`cache_read_input_tokens` — the four a transcript carries, with the `model` per
turn. The record keeps them **separate rather than pre-summed**, and the reason
is stronger than *they price differently*.

**Measured 2026-09-15 over three real transcripts on this machine, cache reads
are 98.6%, 99.3% and 99.36% of a naive four-counter total.** The largest
session, re-measured after a panel disputed the first reading:

```
input_tokens                     86,922
output_tokens                22,016,579
cache_creation_input_tokens 117,015,335
cache_read_input_tokens  21,479,234,105     ← 99.36% of the sum
```

**So adding the four together answers nothing.** The result is a cache-read
count wearing a cost's name, and cache reads are the cheapest tokens there are —
a slice that re-read a large context cheaply would outrank one that generated
heavily. A single figure that a person can act on needs a **price-weighted**
sum, which needs a price table, which the story excluded by measurement on
2026-08-29 and which this plan does not add.

**A reader wanting one number should be given none.** Four fields, named, and
the plan says why a fifth summed field is not offered.

**The model is recorded beside them** for the same reason: the same count on two
models is two different costs, and a reader that has a price table needs to know
which.

### The scan is affordable exactly once, and never on a refresh

**`readTranscriptFacts` is bounded to a 256 KiB tail on purpose** — *"a
transcript grows without bound over a long run — six figures of tokens become
megabytes of JSONL"* — and it walks backwards (`transcript.ts:184`) to find the
last turn cheaply. A cost is the traversal that bound exists to prevent.

**Measured: the largest transcript here is 387 MiB (394 MB, 393,738,847 bytes),
and a full four-counter sum over its 43,488 turns took 885–1087 ms across
repeated runs.** State the range rather than one figure: the reading varies with
page cache and load, and a single number invites a budget nobody can hold. That
is invisible once per slice at worker exit and unacceptable on a board refresh
polled every few seconds.

So the full scan happens **once, at the end of a run**, and the record is what
every later reader consults. **The board must never re-derive it**, and the 256
KiB bound on the existing reader stays exactly as it is — this plan adds a
second, bounded-by-frequency path beside it rather than widening the first.

### What this plan does not do

**No price table, no francs.** The story narrowed itself on 2026-08-29 by
measurement — a transcript carries four token counters and **no monetary
field** — and that was re-checked on 2026-09-14 and still holds.

**No per-plan rollup.** That is the sprint's Should and depends on this; a sum
over slices is trivial once the slices carry a number, and worthless before.

## Open Questions

- [ ] **Where does the record live?** `.plot/state/` is git-ignored, so a record
  there is machine-local and a colleague reads nothing — the problem this plan
  set out to solve. Committed record, or openly machine-local and labelled?
  **Blocks the slice.**
- [ ] **Which exits does the scan run on?** `trap _cleanup_on_exit EXIT` is
  installed at `plot-worker-loop.sh:1591` and the loop is bounded at 28800s. A
  clean finish can afford a second; a bound-triggered ALRM path may not.

**No change to `contextTokens` or `contextSpend`.** They answer a ceiling
question, they are rendered today, and this plan adds a third reading beside
them.

## Slices

### A slice says what it spent (Branch: feature/a-slice-says-what-it-spent)

- `feature/a-slice-says-what-it-spent` — sum the four token counters and record the model across a run's whole transcript, write the record when the worker finishes, and read it back per slice without re-deriving

**Done when** a finished slice carries a record naming all four counters and the
model; the sum is over **every** turn of the run rather than the last; **no
summed fifth field is written**, and the plan's reason is carried into the code
that would otherwise invite one; the full scan runs only at worker exit and the
board reads the record rather than the transcript, pinned by a test that fails
if a refresh path opens a `.jsonl`; a run with
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
