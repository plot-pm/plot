# The board says slice

> The board calls a slice a wave in 1,835 places. The domain settled the
> vocabulary a week ago and the rename stopped at the board's boundary.

## Status

- **Phase:** Draft
- **Type:** infra
- **Story:** the-master-agent-holds-the-fleet
- **Review:** pr
- **Impl:** own branches
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
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

### Every board use means slice, and this is provable rather than assumed

`entities/wave.ts:22` defines the legitimate Wave — *"what the fleet lands
together — slices drawn from several plans, assembled at dispatch and persisted
nowhere"* — and says of itself: *"Has no constructor: nothing forms one today…
no component sees eligible slices across plans."*

**The board imports it zero times.** So there is no site in the board where the
word is right, and the rename needs no per-site judgement about which meaning
was intended. That is what makes this mechanical rather than a redesign.

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

### The wire is already safe, and that is why this is possible

`entities/fleet.ts:549-566` accepts **both spellings** and rewrites `waves` to
`slices` on the way in — *"the scan still emits `waves`, so a board built from
this package must read either."* `plot-fleet-scan.sh:3856` still prints
`"waves"` in its summary.

**So the wire contract does not change in this plan.** The board renames what it
calls things internally and keeps reading what the scan sends. A later plan can
move the wire, once nothing depends on the old spelling.

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

- [ ] **Do the `data-wave-row` attributes move?** Browser tests bind to them,
      so renaming is a test change plus a selector change in lockstep. It may
      deserve its own slice rather than riding with the identifiers.
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
  is the failure that prompted this plan.

### Naming it

- `infra/the-board-names-slice-in-code` — the 192 identifiers: `WaveRow`,
  `waveGroupsFor`, `waveSummaryFor` and their kin. Mechanical, because
  `entities/wave.ts` is not imported here, so no site needs a judgement about
  which meaning was intended. **Asserted: the board imports no `Wave` from the
  domain**, the property that makes the rename safe, kept as a test rather than
  a note.

### Binding to it

- `infra/the-tests-select-slice` — `data-wave-row` and its siblings, with the
  browser tests that bind to them, moved in lockstep. Last because a selector
  and its test must change in one commit, and because the two slices above
  deliver the benefit without touching what tests grip.

## Notes

Written 2026-09-03, prompted by a real board message on
`the-domain-owns-the-agent-lifecycle`: the warning was right, the sentence was
wrong, and the plan it warned about had the same confusion in it.

**Scope.** The board only. `plot-fleet-scan.sh` (275 uses) and the wire key are
deliberately left — the reader already tolerates both spellings, and moving the
wire is a separate risk with a separate blast radius.
