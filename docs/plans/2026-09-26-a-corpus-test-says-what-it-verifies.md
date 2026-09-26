# A corpus test says what it verifies

> `branch-state.corpus.test.ts` promises the rule is *"VERIFIED rather than reviewed"* and cannot verify it: both sides compute state with the same code, so a juror's deliberate change to `branch-state.ts:264` left it green while the unit tests caught it 4-of-42. **It does verify something real** — that the scan gathers the right readings — and the gap is between what it checks and what it says.

## Status

- **State:** Draft
- **Type:** infra
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1011
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Rounds:** 0

## Changelog

- The branch-state corpus test says which half of its comparison is independent. A reader stops taking its green as evidence the rule is right, and keeps taking it as evidence the scan reads the right inputs.

Board impact: none. Test documentation and, if the slice decides so, one assertion.

## Motivation

### Measured 2026-09-26

A juror applied a deliberate change to `branchState` and ran both suites:

```
test/branch-state.test.ts            4 failed / 38 passed   caught it
corpus/branch-state.corpus.test.ts   5 passed, 72 s         did not
```

The corpus passed **with the mutant applied**, because it compares `branchState` against `plot-fleet-scan.sh --json`, and the scan's only branch-state answer comes from `node board/plot-branch-state.mjs` (`plot-fleet-scan.sh:3620`) — a bundle built from that same rule. Rebuild the bundle, both sides move together.

### What it does verify, and this is not nothing

The file's own table:

> | | reads | answers with |
> | **production** | `plot-fleet-scan.sh --json` | the `state` on every branch |
> | **the rule** | git refs, the merge walk, one `pr-list`, the plan's own annotations | `branchState(readings)` |
>
> The readings are taken HERE, from the same sources the scan reads

**The readings path is genuinely independent.** The corpus gathers refs, the merge walk and a `pr-list` itself. If the scan collects a reading wrongly — a wrong ref, a missed merge subject, a PR row it failed to join — the two sides disagree and the test fails.

So it is a real comparison of **input gathering**, and a tautology about **the decision**.

### The gap is between that and what it promises

> `branch_state()` is 183 lines with ten call sites in a 4,194-line script … So the move is **VERIFIED rather than reviewed**: a disagreement here is either a bug in the new rule or a defect in the old one.

A disagreement cannot be a bug in the rule, because the rule appears on both sides. That sentence describes a comparison of two implementations; the file compares one implementation against itself over independently-gathered inputs.

**An earlier reading of this, filed on #1011, said it "cannot catch drift" — too broad.** It catches reading drift and not rule drift, and that distinction is the whole plan.

### Why it matters now

`a-branch-behind-main-holds-nothing` proposes changing `branch-state.ts:264`. Anyone making that change will run this test, see green, and — reading the docstring — conclude the rule was verified against production. The juror who found this was running a mutant deliberately; a person shipping the change would not be.

### The estate converted a real pair into this shape on purpose

`sprint-score.corpus.test.ts` records it: it compared two implementations *"until 2026-09-08, when `a-sprint-item-has-one-scorer` deleted the second and made the script ASK for the answer."*

**So a script asking the rule is a deliberate direction**, not an oversight, and this plan does not argue against it. One rule with one implementation is the goal; what changes is that a test comparing against a bundle of that rule must not claim to verify the rule.

## Design

### The change

**The docstring states which half is independent.** The comparison verifies that the scan gathers the readings the rule needs and passes them correctly; it does not verify what the rule decides, because the scan asks the rule.

One paragraph, where the *"VERIFIED rather than reviewed"* claim currently sits.

### Open: whether the name should change too

`branch-state.corpus.test.ts` sits beside `sprint-score.corpus.test.ts`, which compares an adapter against production — a different question with the same suffix. Whether this file should be renamed for what it checks, or keep its name with a corrected docstring, is the slice's call.

**Against renaming:** the corpus tier is a named concept in CLAUDE.md and a file leaving it is a signal in itself.
**For renaming:** the reader who needs this is the one who did not open the file.

### Open: whether an assertion should carry it

A comment can be skipped. **A test that fails when the bundle is stale would make the build-freshness half explicit** — the one thing this comparison genuinely cannot get wrong. Whether that is worth a second assertion, or is already covered by CI's build check, is measurable and the slice measures it.

### What this does NOT do

- **It does not delete the test.** A stale bundle is a real failure mode this repo has hit, and the readings comparison is a real check.
- **It does not add a second implementation of `branchState`.** That is the duplication `a-sprint-item-has-one-scorer` deliberately removed.
- **It does not change `branch-state.ts`.** The rule's correctness is `a-branch-behind-main-holds-nothing`'s question.
- **It does not touch the other corpus files.** Whether they share this shape is worth asking and is not asked here.

## Done when

- The docstring names the independent half and the dependent half, and no longer claims the rule is verified.
- A reader who changes `branch-state.ts` and runs this test learns from the file what its green means.
- The other corpus files are checked for the same shape and the finding is recorded, whether or not it is acted on.

## Slices

### A corpus test says what it verifies (Branch: `infra/a-corpus-test-says-what-it-verifies`)

The docstring correction, the name decision with its argument, and the survey of the sibling corpus files.

## Notes

Found by the juror on `a-branch-behind-main-holds-nothing`, which is the plan that would change the rule this test claims to verify. It reported the finding unprompted while measuring the blast radius of the fix — the value of a juror that executes rather than reads.
