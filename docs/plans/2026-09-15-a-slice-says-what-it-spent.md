# A slice says what it spent

> A finished slice records the tokens its agent actually used, summed across the run rather than sampled from the last turn.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:** a-declared-agent-costs-what-it-costs
- **Story:** plot-plan-economics
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 3

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

**IT IS WRITTEN MACHINE-LOCAL, UNDER `.plot/state/`, AND THE PLAN SAYS SO
PLAINLY.** Settled 2026-09-15 by the operator. `.plot/state/` is git-ignored
(`.gitignore:35`), so the record is machine-local exactly as the transcript is —
and **that is a stated limit rather than a solved problem**:

- A colleague's checkout reads **nothing**, not zero. The absence must be
  legible as *not measured here*.
- The record is **destructible**. Transcripts are machine-local and unbacked, so
  a desk reaped on a machine nobody returns to takes its number with it.

**The alternative was weighed and declined.** A committed record would be
readable from any checkout and would make a per-plan rollup trivial — at the
price of per-run token counts entering the repository's permanent history, for a
number whose only consumer today does not exist yet. **A reading that is cheap
to re-take does not earn permanent storage in git.**

So this plan writes where the transcript already lives, and **the honesty is the
deliverable**: a reader who sees nothing must be told the difference between *no
record here* and *a free run*.

**The exit path is already crowded.** `plot-worker-loop.sh:1591` installs
`trap _cleanup_on_exit EXIT`, and the loop is bounded by `Worker bound` — 28800s
here. A second's scan added to a shutdown that also pushes and opens a PR is
affordable; a scan that runs on the ALRM path at the bound is not obviously so,
and the plan must say which exits it runs on.

**It is written once and never updated.** A spend is what a run cost; a second
run is a second record. That keeps the number a measurement rather than a
running total nobody can place in time.

### The record has TWO subjects, and both are named

**A panel found both undefined, and each is a way to pass every gate and be
wrong.**

**Whose branch — the SLICE, not the worker.** `plot-worker-loop.sh:2088-2297` is
the finish path and **it does not exit**: it seals a declaration, clears the
manifest branch, blocks in `wait_for_work`, resets the desk, and loops. The
loop's own comment at `:1044` states the rule:

> *"a declaration is about a BRANCH, and a worker hops, so one worker writes
> several. An ending happens once, to the worker, and the branch it held at the
> time is a field rather than the subject."*

Measured: of the 12 largest worker transcripts, **3 already span two branches**,
and one desk directory holds 49 session files. So a sum taken at worker exit
charges every slice the worker ever held to whichever branch it held last.

**The record is therefore written per slice, at `seal_declaration`** — `:2088-2093`
is explicit that it runs *before* the hop moves `$PLOT_BRANCH`, precisely so it
names the branch that finished. The transcript carries `gitBranch` per line, so
the partition is readable.

**Whose session — PER SESSION, NEVER PER WORKTREE.** `spend.ts:42-50` already
settled this and measured it:

> *"one project directory measured 2026-09-03 held 45 session files, 30 of them
> subagents, and a sum across them belongs to no one."*

Re-measured on this project: **604 session files, 421 of them `agent-*` subagent
transcripts, 370 with zero main-session turns.** A caller that cannot name the
session passes `null` rather than reaching for the newest file.

**Neither subject is optional.** A record that is silent about either is a number
nobody can place.

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
last turn cheaply. That bound exists for the **master agent's** transcript, which
does grow without bound; a worker's is bounded in practice by its slice.

**The scan is cheap, and an earlier draft of this plan measured the wrong
population.** That draft timed a 394 MB transcript at 885–1087 ms and argued the
cost was the reason to write once at exit. **That file is the master agent's own
console, not a worker's.** Re-measured over the population this plan is about —
1,966 worker transcript files:

```
largest      8,111,230 bytes   (7.7 MiB)
median           7,084 bytes   (6.9 KiB)
```

A full four-counter sum over the **largest worker transcript in the estate**
takes **90–250 ms**; the median will sum in single-digit milliseconds.

**So cost is not the argument for writing once, and the plan no longer makes
it.** The argument is the subject: the reading must be taken while the worker
still holds the slice it describes, because `seal_declaration` is the only moment
that knows which branch just finished. **A cheap scan at the right moment beats
an expensive one at the wrong moment**, and the 256 KiB bound on the existing
reader stays exactly as it is.

So the full scan happens **once per slice, as that slice is sealed**, and the
record is what every later reader consults. **The board must never re-derive
it** — a per-refresh scan of even a 7 KB file is a `.jsonl` opened on a path
that must not open one.

### What this plan does not do

**No price table, no francs.** The story narrowed itself on 2026-08-29 by
measurement — a transcript carries four token counters and **no monetary
field** — and that was re-checked on 2026-09-14 and still holds.

**No per-plan rollup.** That is the sprint's Should and depends on this; a sum
over slices is trivial once the slices carry a number, and worthless before.

## Open Questions

- [x] **Where does the record live?** *Answered 2026-09-15:* machine-local under
  `.plot/state/`, with the plan stating plainly that a colleague's checkout reads
  nothing and that the record is destructible. See Design.
- [x] **Which exits does the scan run on?** *Answered:* the question was mis-posed.
  `_on_alarm ALRM` (`:1546`) and `_cleanup_on_exit EXIT` (`:1591`) are **two traps,
  not alternatives**, and EXIT runs on every termination including the bound. The
  scan does not hang off either — it runs at `seal_declaration`, per slice.

**No change to `contextTokens` or `contextSpend`.** They answer a ceiling
question, they are rendered today, and this plan adds a third reading beside
them.

## Slices

### A slice says what it spent (Branch: feature/a-slice-says-what-it-spent)

- `feature/a-slice-says-what-it-spent` — sum the four token counters and record the model across a run's whole transcript, write the record when the worker finishes, and read it back per slice without re-deriving

**Done when** a finished slice carries a record naming all four counters and
every model it used; **the record's subject is the SLICE** — a worker that hops
between two branches writes **two** records, each covering only its own turns,
pinned by a fixture transcript carrying two `gitBranch` values; **the sum is per
SESSION, never per worktree**, pinned by a fixture directory holding a main
session beside `agent-*` subagent transcripts, where the record counts the main
session's turns and not the subagents'; **no summed fifth field is written**,
pinned by a **key-set assertion** rather than prose, since `contextSpend` is
already on the wire schema and a fifth field beside it is a two-line change no
review would flag; the scan runs at `seal_declaration` and the board reads the
record rather than the transcript, pinned by a test that fails if a refresh path
opens a `.jsonl`; a run with no readable transcript **records nothing and says
so** rather than recording zero; **a reader on a machine that holds no record is
told it was not measured here**, never shown a zero; `contextTokens` and
`contextSpend` are unchanged and the board's panel still renders what it
rendered before; a second run of the same slice writes a second record rather
than mutating the first; and `pnpm run test:contracts` passes.

## Notes

**The third Must of sprint W41**, and the first plan of `plot-plan-economics` —
a story that has been `draft` with zero plans since 2026-08-27.

**Amended 2026-09-15 after a three-lens panel**
(`.plot/panels/2026-09-15-a-slice-says-what-it-spent/`), which found two
undefined subjects, a timing measurement taken from the master agent's own
transcript rather than a worker's, and an unacknowledged `spend.ts` rule about
subagent sessions. The operator settled the record's home.

**Zero is the dangerous answer here.** A transcript that cannot be read, a desk
reaped on another machine, a run that never started — each must record *nothing*
and say so. A recorded zero is indistinguishable from a free run, and a per-plan
sum over a zero is wrong in the direction nobody checks.
