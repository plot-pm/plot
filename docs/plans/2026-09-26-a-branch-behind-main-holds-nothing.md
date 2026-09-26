# A branch behind main holds nothing

> `branchState` returns `merged` for a branch that has a ref, carries no commits of its own, and does not point at the default branch. That shape has THREE sources and only one of them is landed work. Measured 2026-09-26: three approved slices read `merged` with `commits=0 prs=0 desks=0`, were absent from `--list-eligible`, and dispatch reported `dispatched=0 skipped=0` — the same output as a plan with nothing left to do.

## Status

- **State:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches
- **Sprint:** a-refusal-names-what-it-cannot-see
- **Issue:** #1002
- **Rounds:** 0

## Changelog

- A branch whose ref is behind the default branch and carries nothing of its own is no longer reported as `merged`. The fleet holds it with a named reason instead of settling its wave, so an approved slice cannot be silently withheld from dispatch.

Board impact: the board renders whatever state the scan reports, so a row that read `merged` will read as held. No board code changes.

## Motivation

**`branch-state.ts:264` answers `merged` on a reading that is entirely fresh.** Measured 2026-09-26 by driving `branchState` directly, host `ok`, no PR, no wait:

```
claimed   claim ref, claim commit PUSHED      refTip != mainTip, commitsAhead=1, real=0
merged    claim ref, NO commit                refTip != mainTip, commitsAhead=0, real=0   <-- :264
open      ref points AT main                  refTip == mainTip, commitsAhead=0
open      no ref at all                       refTip == null
```

Row 2 is the defect. **No staleness is involved** — this is what the rule returns for a current reading of a ref that is behind the default branch and holds nothing.

### The comment at `:239-250` names two shapes and there are three

The rule's own table:

| shape | ancestry says | truth |
|---|---|---|
| behind main | is an ancestor → merged | merged |
| reset to main | is an ancestor → merged | holds nothing |

The third shape is **cut from an older main and never committed to.** It is a ref that is a strict ancestor of the default branch, exactly like landed work, and it holds nothing, exactly like a reset. The discriminator at `:260` — equality of the two tips — separates *reset to main* from the other two and cannot separate those two from each other, because on both of them the tips differ.

**`plot-dispatch.sh --start` creates this shape as a matter of course.** A free agent's desk is cut detached at `origin/<main>`; its branch ref sits at whatever main was at cut time; main moves on; the ref is now behind it carrying nothing. CLAUDE.md records the detached cut as deliberate — this plan does not change it.

### What it costs, measured 2026-09-26

Three approved slices of three separate plans:

```
bug/the-rollup-is-asked-of-open-prs-only          commits=0  prs=0  desks=0  -> merged
bug/the-approval-reads-why-the-host-said-nothing  commits=0  prs=0  desks=0  -> merged
bug/a-wave-says-which-question-it-answered        commits=0  prs=0  desks=0  -> merged
```

None had ever carried a pull request. Deleting the three refs made all three dispatchable and agents took all three within two minutes.

**`merged` SETTLES a wave.** The rule's own comment says so at `:252`: the error *"does not stall the fleet — it advances it onto a seam nobody wrote."* Here it does something worse than advance: `plot-dispatch.sh` takes the scan's eligible list as a reading rather than deriving its own (`:3475`, `:3523`), so a slice the rule calls `merged` is offered to nobody. The plan stays Approved, the fleet reports no work, and the branch waits indefinitely.

**It also makes `dispatched=0` unreadable**, which is the operational cost. That output means *nothing to do* and *wrongly believed done* identically, so an operator cannot tell a finished plan from a hidden one without checking every branch by hand.

### Why this is separate from #995

`a-stale-pulse-keeps-the-sections-it-had` fixes the **board's render layer** — it carries a row's section forward rather than recomputing it from a pulse the banner has called stale. It deliberately does not reach the rule, and its *What this does NOT do* says so. The scan is stateless and re-derives from `origin/<main>` every run (`plot-fleet-scan.sh:3547`), so dispatch never reads a stale pulse: it reads this rule, fresh, and gets `merged`. Fixing the board does not make the withheld slice dispatchable.

## Design

### The rule

**A ref that is behind the default branch and carries nothing of its own answers `unknown`, not `merged` — unless the host says its pull request merged.**

`unknown` is not a new state and needs no new plumbing. The rule already returns it for the analogous case at `:195-206`, and the docstring makes the category explicit:

> `unknown` MARKS AN ABSENT READING, NEVER AN EMPTY ONE. A host that was never asked leaves `open`; a host that was asked and could not answer leaves `unknown`.

A branch of this shape is the same category read from git rather than from the host: the readings are present and they do not determine the answer. Two of the three sources mean *holds nothing* and one means *merged*, and nothing in `BranchReadings` separates them.

**Downstream behaviour is already defined, and it is the behaviour this wants.** `queue.ts:56` — *"`unknown` is a host that could not be asked, and it HOLDS the slice"* — and `:207` returns the `merge-unknown` hold. `plot-fleet-scan.sh:3380` — *"`unknown` IS OUTSTANDING, exactly as `open` is."* So the change converts a silent skip into a visible hold with an existing reason code.

### What promotes it to `merged`

The host, and only the host. `readings.pr === 'MERGED'` already overrides at `:231` for the `commitsAhead > 0` arm, for the resurrected-ref case; the same override applies here. A branch whose pull request the host reports merged is merged whatever its tips say.

**`mergeSubjectFound` does not apply.** It is read only where there is no ref (`:90`), and this shape has one.

### What this costs, stated

**A genuinely merged branch whose ref outlived the merge now reads `unknown` instead of `merged` when the host cannot confirm it.** That is a real regression in one direction, and it is the trade this plan makes deliberately: `unknown` holds a wave, `merged` settles it. Holding a finished wave wastes an operator's attention; settling an unfinished one withholds work nobody can see. Only the second is silent.

The population is bounded by `plot-release-refs.sh`, which deletes a delivered plan's merged refs — CLAUDE.md records 3 surviving merged refs on this estate against hundreds of merges.

### What this does NOT do

- **It does not add a host call.** `:258` refuses one for a measured reason — `plot-pr-merged.sh` answered *not merged* for three genuinely merged branches while throttled — and this rule must not inherit that failure mode. The host reading it consults is the one already in `BranchReadings`.
- **It does not add a staleness field.** `BranchReadings` has no concept of when a value was read, and this defect does not need one. A field the rule cannot use from evidence it does not have would be the wrong fix for the right symptom.
- **It does not change `plot-dispatch.sh`.** Taking the scan's verdict as a reading is correct — one derivation in one place — and a second opinion downstream would be the duplication the estate removes.
- **It does not change the detached cut in `--start`.** That shape is deliberate and documented; the rule is what misreads it.

## Done when

- A branch with a ref behind the default branch, no commits of its own, and no merged pull request answers `unknown`.
- The same branch with `pr: 'MERGED'` answers `merged`.
- A branch whose ref equals the default branch still answers `open`.
- A branch with a pushed claim commit still answers `claimed`.
- `:239-250`'s table names three shapes and says which the tip comparison can and cannot separate.
- A test covers the third shape by name.

## Slices

### A branch behind main holds nothing (Branch: `bug/a-branch-behind-main-holds-nothing`)

Change the `:264` return, extend the table comment to three shapes, and cover the four rows of the probe above as cases.

## Notes

The probe that produced the four rows drives `branchState` directly with host `ok`, `pr: 'none'`, `waits: null`, varying only `refTip`, `mainTip`, `commitsAhead` and `realCommitsAhead`. It belongs in the test file rather than staying a scratch script.

The three measured branches no longer reproduce the shape — they carry real work now, because deleting their refs let agents take them. The evidence for this plan is the probe, not a live branch.
