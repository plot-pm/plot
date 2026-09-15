# Decision panel — where does a `HEAD` segment belong?

Subject: `docs/plans/2026-09-15-a-slice-says-what-it-spent.md`
Lenses: attribution, reader, simplicity. Vocabulary: `none | nearest | own-record`.
Reconciliation: **divided — nearest=attribution,reader · none=simplicity**

**A decision panel, not a plan review.** The commitment is the design choice
itself; the mechanism took the caller's vocabulary and validated against it.

## The question was posed on a false premise, and all three jurors corrected it

**I told the jurors** *"`reset_desk` passes through detached between slices, so
`gitBranch` reads `HEAD`"*. That is **true of the code and false of the
transcript**, and the distinction decides everything.

`reset_desk` (`plot-worker-loop.sh:937`) runs `git checkout --detach` at `:962`
and re-attaches at `:967-968` — **two consecutive `git` calls inside one shell
function, with no agent turn emitted between them.** A transcript line carries
`gitBranch` as read when the turn is written, and the loop writes no turns
between prompts. **So the between-slice detach is invisible by construction.**

Measured by the moderator over 938 worker transcripts:

```
files with a HEAD segment        : 44
  with ONE real branch only      : 42
  HEAD returning to the SAME branch: 37   ← mid-slice baseline
  HEAD between DIFFERENT branches :  0   ← never happens
```

**Every HEAD segment that carries tokens is a mid-slice baseline** — an agent
detaching to A/B against main, which is this repo's own recommended practice.
It is not an orphan. **It is work done FOR the slice that surrounds it.**

The panel's round-2 sentence — *"a HEAD segment is not a branch that ran"* —
describes the event that produces **no data** and is false of the event that
produces **all** of it.

## The disagreement, named rather than counted

All three jurors agree on every fact above. They split on what follows, and the
split is a genuine values disagreement rather than a factual one.

**`attribution` and `reader` choose `nearest`** because the tokens are honestly
the slice's: the agent detached in service of that slice and returned to it, so
charging them elsewhere — or nowhere — tells a reader something false about work
that demonstrably belongs to one branch.

**`simplicity` chooses `none`** on cost and on precedent, and its two arguments
are the strongest single objections this panel produced:

1. **The estate refuses heuristics, repeatedly and by name.** `DeclarationReading`
   has no *inferred* arm. `plot-host.sh:1966` — *"a guess as a measurement.
   `unknown` is the honest word."* `plot-fleetctl.sh:578`, `plot-boardctl.sh:501`,
   `plot-deliverable-search.sh` (*"by measurement and never by a proxy for one"*),
   and `plot-open-pr.sh`'s entire design. **`nearest` is not in this estate's
   vocabulary.**
2. **`nearest` needs a lookahead that cannot exist at the write site.**
   `seal_declaration` runs at `:2092`; `--next` is asked at `:2196`. **At the
   moment the record is written, the "branch after" has not been chosen.**
   Implementing `nearest` as specified requires either deferring the record past
   the hop — destroying the subject argument the whole plan rests on — or
   redefining "the segment after" as "the rest of the file", which is a different
   rule wearing the same name.

## The moderator's reading: the measurement dissolves the objection

**`simplicity`'s lookahead objection is fatal to `nearest` AS I POSED IT, and the
measurement removes the need for the lookahead.**

`nearest` was defined as *"charge it to the slice it interrupts (the branch
before and after it, when they match), and only orphan it when they differ."*
The disagreeing case — **0 occurrences in 938 transcripts** — is what requires
the lookahead, the orphan path, and the untestable branch.

**Drop the disagreeing case and the rule becomes a one-sided test:** a HEAD
segment whose *preceding* real branch is the branch being sealed belongs to that
branch. No lookahead. No segmenter beyond what the plan already needs. No orphan
path for a case that has never occurred and, by the code above, **cannot occur**
— because a between-branch HEAD emits no turns.

That is neither of the options as I wrote them, and it is what both majority
jurors are actually arguing for.

## What `none` would cost, in the terms `simplicity` itself set

`simplicity` is right that `none` is the cheapest honest option, and right that
39 of 44 files make the question decorative. But its own framing answers against
it on the one case that matters: the measured mid-slice segment carries
**4,792,932 cache reads and 6,257 output tokens**, and under `none` those are
dropped from a slice that demonstrably incurred them — while the plan's headline
gate says *"the sum is over every turn of the run"*.

**`none` makes the plan's own gate false for 37 measured segments.** That is not
a cheaper honesty; it is a different inaccuracy, and an invisible one.

## The decision this panel supports

**Charge a HEAD segment to the branch it returns to, tested one-sidedly.**

- The rule is *"the preceding real branch is the branch being sealed"* — a
  backward test, computable at `seal_declaration` with no lookahead.
- **It is not a heuristic**, which answers `simplicity`'s precedent objection: the
  agent detached from a branch and returned to it, and both facts are in the
  transcript. Nothing is inferred.
- A HEAD segment with **no** preceding real branch belongs to no slice and is
  recorded as such — 4 files carry no real branch at all, and those are the real
  `none` case.
- The fixture must carry `B → HEAD → B`, which is the shape that actually occurs.
  The plan's demanded two-`gitBranch` fixture does not contain it.

**The plan must also drop the claim that a between-slice HEAD exists.** It does
not, in any transcript, and saying so would be the third measurement in this
document that describes something other than what it claims.
