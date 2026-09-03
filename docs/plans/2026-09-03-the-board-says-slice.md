# The board says slice

> The board calls a slice a wave in 1,835 places. The domain settled the
> vocabulary a week ago and the rename stopped at the board's boundary.

## Status

- **Phase:** Approved
- **Type:** infra
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-03, Jan Wloka, pr
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
- **Started:** 2026-09-03, Jan Wloka, `infra/the-board-reads-slice-to-people`
- **Started:** 2026-09-03, Jan Wloka, `infra/the-board-names-slice-in-code`
- **Started:** 2026-09-03, Jan Wloka, `infra/the-tests-select-slice`
-->

## Changelog

- The board says *slice* where it means slice. A message that told an operator
  *"a wave is carried out in one branch, so this plan needs slicing"* now names
  the thing it is talking about, and the vocabulary the domain settled on
  2026-08-28 reaches the layer people actually read.

<!-- Board impact: this IS the board. No plan-format or helper-script change;
     the wire contract is untouched, because the reader already accepts both
     spellings. -->

## Motivation

**CLAUDE.md states the rule and names the debt:** *"The code still says `Wave`
where it means `Slice` — that is a known defect with its own plan, and no new
code may add to it."* Measured 2026-09-03, the debt is not a residue:

| | `Wave`/`wave` | `Slice`/`slice` |
|---|---|---|
| `packages/domain/src` | 21 | 234 |
| `skills/plot/scripts` | 275 | 86 |
| **`packages/board/src`** | **1,835** | **225** |

The domain was converted on 2026-08-28 and **the rename stopped at the board's
boundary.** 1,643 of the board's uses are prose and comments; 192 are
identifiers (`WaveRow`, `waveGroupsFor`, `data-wave-row`), across **52 files**,
concentrated in six: `rows.tsx` (245), `AgentList.tsx` (179), `schema.ts`
(175), `sections.ts` (161), `fleet.ts` (154), `tuple-row.ts` (89).

### The board has a `Wave`, and it is a Slice

**Round 1 corrected this section.** Its first draft argued *"the board imports
no `Wave` from the domain, so no use means one"* — true and beside the point.
The board **defines its own**, at `contract/schema.ts:1659`, and
`AgentList.tsx:7` imports it. The question is not whether a Wave exists here but
whether the one that does is named correctly.

**It is not.** `WaveSchema` is `{ plan, name, branches }` — *"WHICH PLAN this
wave belongs to"*, named by *"its `### ` heading in the plan file"*. Belonging
to one plan and named by a heading is the definition of a **Slice**
(`DESIGN-slice.md`). The domain's Wave is the opposite: *"slices drawn from
several plans, assembled at dispatch and persisted nowhere"*
(`entities/wave.ts:22`), and it *"has no constructor: nothing forms one today."*

**Measured 2026-09-03 across the whole estate: 58 waves, and every one holds
exactly one branch.** Not one has ever held the many that would make it a
cohort. So the board's `Wave` is a Slice in every instance that exists, and the
rename is a correction rather than a redefinition.

**The `branches` array is the tell, and it survives the rename.** A Slice holds
one branch; the field is plural because the parser accepts a heading with
several and the board must render what it finds — which is exactly the *"wave
not sliced"* warning's job. Renaming the type does not make that array
singular, and this plan does not try to.

### The cost is not tidiness; it is that the board teaches the wrong model

Measured 2026-09-03 on a real plan. `the-domain-owns-the-agent-lifecycle` had
two branches under one heading, and the board said:

> **wave not sliced** — one wave, 2 branches: … — *a wave is carried out in one
> branch, so this plan needs slicing*

**The warning was correct and its sentence contradicts the spec.** A Slice holds
exactly one branch; a Wave spans plans and is *supposed* to hold many. Read
literally, the message says a wave must hold one branch — which is the opposite
of what a wave is. An operator learning the model from the board learns it
wrong, and the plan author (this one) had already made that exact mistake in the
plan the message was about.

Other user-visible strings carry it too: `"3 waves"`, `"a plan with no
subheadings is one wave"`, `"how many of my waves are not here"`, `"prepare the
whole wave"`.

## Design

### Approach

**Three passes, smallest blast radius first: the words people read, then the
names the code uses, then the attributes tests bind to.** Each is separately
reviewable, and the first delivers the whole user-facing benefit.

### The wire moves, and it moves the way the domain already moved it

`WaveSchema` is not an internal name: the server emits it and the client parses
it, so a renamed field means an old client and a new server disagree at runtime
and say nothing. **That is why the rename carries the reader with it.**

`entities/fleet.ts:563` is the precedent and it is seven lines —
`readEitherSpelling` rewrites `waves` to `slices` before parsing, so the parsed
object exposes one spelling while the wire may send either. The same
preprocessor serves the board's payload.

**Emit the new spelling, read both.** The board serves its own client, so the
disagreement window is one deploy rather than a release cycle — but the reader
is what makes the window survivable rather than lucky, and it is the difference
between a rename and an outage.

**`plot-fleet-scan.sh` still emits `waves` and is out of scope**
(`:3856`). The domain's reader already absorbs that, and this plan does not
touch the script — its 275 uses are a separate blast radius with a separate
argument.

### Not chosen: one sweeping rename commit

`sed -i 's/wave/slice/g'` over 52 files would produce a diff nobody can review,
destroy `git blame` for 1,835 lines, and — measured on this repo — break the
one place the word is correct. CLAUDE.md's own conversion rule applies: *"The
unit is the function, not the file… If you are writing the body, it is an
arrow; if you are passing through, leave it."* The same discipline scopes this.

### Not chosen: rename the domain's `Wave` away

It is the only correct use in the repo and the spec depends on it
(`DESIGN-slice.md`). A rename that removed it would make the fleet's cohort
unnameable, which is the concept `parallel agents (cap)` on the board already
implies.

### Open Questions

- [x] **Do the `data-wave-row` attributes move?** *Answered round 1:* yes, in
      their own slice, because a selector and the test gripping it must change
      in one commit.
- [x] **Does `branches` become singular?** *Answered round 1:* no. The array is
      what lets the board DETECT an over-full slice; making it singular would
      remove the evidence behind the *"wave not sliced"* warning, and this plan
      would break its own worked example.
- [ ] **Does `plot-fleet-scan.sh` follow?** Its 275 uses are the other half of
      the debt, and its `"waves"` JSON key is the wire. Out of scope here; this
      plan proves the reader tolerates both.

## Branches

### Saying it

- `infra/the-board-reads-slice-to-people` — every user-visible string and every
  comment: `"wave not sliced"` becomes a sentence that names a slice, and the
  five strings above stop teaching the wrong model. **No identifier changes**,
  so the diff is reviewable as prose and `git blame` moves for text only.
  **Asserted: the message a two-branch heading produces names a slice**, which
  is the failure that prompted this plan. → #678

### Naming it

- `infra/the-board-names-slice-in-code` — the type and the 192 identifiers.
  `WaveSchema` (`contract/schema.ts:1659`) becomes `SliceSchema`, and
  `WaveRow`, `waveGroupsFor`, `waveSummaryFor` and their kin follow it.
  **The type is the point rather than a side-effect:** it is what carries the
  wrong name into every consumer, which is why round 1 moved it out of the
  prose slice.
  **The wire moves with a reader, never without one.** The payload emits
  `slices` and accepts `waves`, using the `readEitherSpelling` shape
  (`entities/fleet.ts:563`, seven lines). **Asserted: a payload carrying the
  old spelling still parses**, because that assertion is the only thing
  standing between a rename and a silent runtime disagreement. → #680

### Binding to it

- `infra/the-tests-select-slice` — `data-wave-row` and its siblings, with the
  browser tests that bind to them, moved in lockstep. Last because a selector
  and its test must change in one commit, and because the two slices above
  deliver the benefit without touching what tests grip. → #682

## Notes

Written 2026-09-03, prompted by a real board message on
`the-domain-owns-the-agent-lifecycle`: the warning was right, the sentence was
wrong, and the plan it warned about had the same confusion in it.

**Scope.** The board only. `plot-fleet-scan.sh` (275 uses) and the wire key are
deliberately left — the reader already tolerates both spellings, and moving the
wire is a separate risk with a separate blast radius.
