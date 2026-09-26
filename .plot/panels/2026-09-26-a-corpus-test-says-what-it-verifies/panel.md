# Panel — a corpus test says what it verifies

**One lens, amend, executed.** Round 1. The juror built two mutants and ran each stale and rebuilt.

## The conclusion was right and the evidence was accidental

The plan's motivating mutant sat at `branch-state.ts:264`. **That arm is reached by 0 of 26 branches on this estate**, so the corpus passed because it was never executed — not because both sides agreed.

**The file already documents that category.** Its docstring at `:390` records a 2026-09-06 four-mutant survey with two marked *"PASSES — never reached"*. The plan presented a fifth instance of a documented category as a discovery of a different one.

## Mutant B isolates the real defect

`:187`, an arm **20 of 26** branches reach:

```
mutant applied, bundle stale     → corpus FAILS, naming twenty branches
mutant applied, bundle rebuilt   → corpus PASSES
```

Same broken rule, opposite verdicts, one variable. That is the tautology, on an arm that matters.

## The CI asymmetry nobody had noticed

The `corpus` job does not build the board, so it runs the committed bundle — **CI does catch rule drift from a contributor who forgets to rebuild.** `ci.yml:873` is a separate job that rebuilds and fails on a diff.

**So the tautology bites the contributor who follows the DoD and rebuilds.** The careless edit is caught; the careful one is not. Verified by the moderator.

## Two open questions were already closed on disk

- **Naming:** `sprint-score.corpus.test.ts:23` already carries the sentence this plan proposed to invent — *"SO WHAT THIS NOW HOLDS IS THE WIRE."* Adopt it.
- **Assertion:** `ci.yml:873` already gates freshness. A second assertion would duplicate a shipped gate.

The plan deferred both to a slice; neither needed deferring.

## The survey is done: one of nine

`branch-state` has the shape undocumented; `sprint-score` has it documented; `deliverable` is a genuine second implementation (`plot-ask.mjs deliverable`, *"its own arithmetic"*); the other six do not share it.

## Recommendation

**Amend, and the plan has been rewritten.** The distinction it draws is correct and worth writing down; its exhibit, its scope claim and its two open questions were all replaceable with what the juror measured.
