# A corpus test says what it verifies

> `branch-state.corpus.test.ts` promises the rule is *"VERIFIED rather than reviewed"* and cannot verify it: both sides compute state with the same code, so a broken rule goes green once the bundle is rebuilt. **It does verify something real** — that the scan gathers the right readings — and the gap is between what it checks and what it says.

## Status

- **State:** Draft
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1011
- **Sprint:** plot-works-in-the-repos-that-adopt-it
- **Rounds:** 1

## Changelog

- The branch-state corpus test says which half of its comparison is independent, and records that CI catches the careless edit while the tautology bites the careful one. A reader stops taking its green as evidence the rule is right.

Board impact: none. Test documentation only — round 1 closed the two questions that might have added an assertion.

## Motivation

### The measurement that isolates the defect

**Mutant B — `branch-state.ts:187`, `'merged'` → `'wip'`, an arm 20 of 26 branches reach:**

| | corpus result |
|---|---|
| mutant applied, **bundle stale** | **fails**, naming twenty branches |
| mutant applied, **bundle rebuilt** | **passes** |

Same broken rule, opposite verdicts, and the only variable is whether the artifact was rebuilt. That is the tautology, demonstrated on an arm that matters.

The corpus compares `branchState` against `plot-fleet-scan.sh --json`, and the scan's only branch-state answer comes from `node board/plot-branch-state.mjs` (`plot-fleet-scan.sh:3620`) — a bundle built from that same rule.

### An earlier draft used the wrong exhibit

That draft rested on a mutant at `:264`. **Line 264 is reached by 0 of 26 branches on this estate**, so the corpus passed because the arm was never executed — not because both sides agreed. Right about the green, wrong about the cause.

**The file already documents that category.** Its docstring at `:390` records a 2026-09-06 four-mutant survey with two marked *"PASSES — never reached"*, attributed to estate coverage. The earlier draft presented a fifth instance of a documented category as a discovery of a different one.

**Arm coverage, measured 2026-09-26:** 4 branches reach `:183`, **20 reach `:187`**, 2 the has-ref arm, **0 reach `:264`**. That last number is a fact `a-branch-behind-main-holds-nothing` needs about its own blast radius, and this plan is what measured it.

### What it does verify, and this is not nothing

> | | reads | answers with |
> | **production** | `plot-fleet-scan.sh --json` | the `state` on every branch |
> | **the rule** | git refs, the merge walk, one `pr-list`, the plan's own annotations | `branchState(readings)` |

**The readings path is genuinely independent.** The corpus gathers refs, the merge walk and a `pr-list` itself. A reading the scan collects wrongly — a wrong ref, a missed merge subject, an unjoined PR row — makes the two sides disagree.

So it is a real comparison of **input gathering** and a tautology about **the decision**.

### The CI asymmetry, which inverts the intuition

The `corpus` job does **not** build the board, so it runs against the committed bundle. **CI's corpus tier therefore does catch rule drift** — from a contributor who edits the rule and forgets to rebuild.

`ci.yml:873` is a separate job that rebuilds and fails on any diff under `skills/plot/scripts/board/`.

**So the tautology bites precisely the contributor who follows the Definition of Done and rebuilds.** The careless edit is caught; the careful one is not. That is the non-obvious half and it is what the docstring most needs to say.

### Why it matters now

`a-branch-behind-main-holds-nothing` proposes changing `branch-state.ts:264`. Anyone making that change will run this test, see green, and — reading the docstring — conclude the rule was verified against production.

### The estate converted a real pair into this shape on purpose

`sprint-score.corpus.test.ts` records it: two implementations *"until 2026-09-08, when `a-sprint-item-has-one-scorer` deleted the second and made the script ASK for the answer."*

**A script asking the rule is a deliberate direction** and this plan does not argue against it. One rule with one implementation is the goal; what changes is that a test comparing against a bundle of that rule must not claim to verify the rule.

## Design

### The change

**The docstring states which half is independent, and names the CI asymmetry.** The comparison verifies that the scan gathers the readings the rule needs and passes them correctly; it does not verify what the rule decides. CI catches an unrebuilt edit; a rebuilt one goes green.

One paragraph, where the *"VERIFIED rather than reviewed"* claim sits.

### The wording already exists next door

`sprint-score.corpus.test.ts:23` says what this plan proposes to say:

> **SO WHAT THIS NOW HOLDS IS THE WIRE** … A field dropped or transposed on that wire shows up as a disagreement … the two can still part, just at the seam rather than in the rule.

**Adopt it rather than inventing a second phrasing.** An earlier draft left the naming as an open question for the slice; the estate had already settled it.

### No second assertion, and no rename

**Freshness is already gated.** `ci.yml:873` runs `pnpm run build:board` and fails on a diff under `skills/plot/scripts/board/`, naming the stale files. A second assertion inside the corpus test would duplicate a shipped gate.

**No rename.** The corpus tier is a named concept and `sprint-score.corpus.test.ts` holds the same shape with honest wording, so the fix is the wording rather than the filename.

Both were open questions in an earlier draft and both are closed here, on evidence, rather than deferred to a slice.

### One file of nine, and the survey is done

- `branch-state.corpus.test.ts` — this shape, undocumented. **The subject.**
- `sprint-score.corpus.test.ts` — this shape, **already documented**. The model.
- `deliverable.corpus.test.ts` — **not** this shape: it calls `plot-ask.mjs deliverable`, which its docstring names as carrying *"its own arithmetic"* — a genuine second implementation.
- The remaining six — checked, none shares the shape.

An earlier draft said the survey was out of scope while its own `Done when` required it. It is done.

### What this does NOT do

- **It does not delete the test.** The readings comparison is a real check and the stale-bundle case is real.
- **It does not add a second implementation of `branchState`.** That is the duplication `a-sprint-item-has-one-scorer` deliberately removed.
- **It does not change `branch-state.ts`.** The rule's correctness is `a-branch-behind-main-holds-nothing`'s question.
- **It does not add a freshness assertion.** Already gated at `ci.yml:873`.

## Done when

- The docstring names the independent half, the dependent half, and the CI asymmetry.
- It adopts `sprint-score.corpus.test.ts:23`'s wording rather than a second phrasing.
- The arm coverage — 4 / 20 / 2 / **0 at `:264`** — is recorded where the next reader of `branch-state.ts` will find it.
- No rename, no new assertion, no other corpus file touched.

## Slices

### A corpus test says what it verifies (Branch: `infra/a-corpus-test-says-what-it-verifies`)

The docstring correction, adopting the existing wording, plus the arm-coverage note.

## Notes

Round 1 replaced this plan's central evidence. The first draft's mutant sat on an arm **no branch reaches**, so it proved non-coverage rather than the tautology — a fifth instance of a category the file's own docstring already documents. The juror built a mutant on the arm 20 branches reach and ran it stale and rebuilt, which is the pair that isolates the defect. It also closed both of this plan's open questions from evidence already on disk.
