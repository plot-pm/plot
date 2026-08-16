# The board asks git about work in flight

> Three numbers the board gets wrong, all because the card asks the plan file
> about facts that live in git refs.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:**
- **Story:** plot-board
- **Review:** pr
- **Impl:** own branches

## Changelog

- Plan cards report how many branches are claimed and how many are eligible to
  start, read from the same git state the Agents tab reads — so a card and a
  row can no longer disagree about whether work is in flight.
- `/plot-dispatch` records a `Started:` entry when it fans out, the way
  `/plot-implement` already does, so a dispatched plan reads as started.

Board impact: **yes, and it is most of the plan.** `WaveSummarySchema` gains a
field and its source changes; no plan-format change and no new helper script.
The artifact is rebuilt, so the Definition of Done's no-diff gate applies.

## Motivation

Watching a real dispatch on 2026-08-16 produced three wrong readings within an
hour, and they turned out to be one mistake wearing three hats: **the card asks
the plan file about facts that only git knows.**

**A card's `claimed` count is always 0.** `summariseWaves` counts `b.claimed`,
a field `plot-plan-meta.sh` parses from a *plan-file annotation nobody writes*.
Claims are pushed as git refs — an empty `plot: claim <branch>` commit — which
is Principle 1 working exactly as designed. So the count is not merely stale;
it can never be anything but zero. The Agents tab, reading the fleet scan, saw
the claim the same second the card denied it.

**The card cannot say whether anything is eligible.** `WaveSummary` carries
`waves / branches / claimed / deferred` and no `eligible`, which is why the
board-acts-through-plot plan had to leave "should *Start work* be disabled when
nothing can start?" unanswered. The fleet scan has computed the answer all
along: `verdict=eligible` per wave.

**`/plot-dispatch` starts work and does not record it.** The string `Started:`
appears **zero times** in `plot-dispatch.sh`. `/plot-implement` writes that
record in its step 5; dispatch never got the equivalent. So a fanned-out plan
sits in Design badged *Ready* while an agent edits its branch — the board's two
tabs disagreeing by construction, because `toBoardPhase(phase, started)` reads
the plan and the fleet reads refs.

All three share a shape this repo keeps meeting: **a zero that means "I looked
somewhere the answer is not kept", indistinguishable from "there is nothing
there."** The board was not lying about the work; it was answering a different
question and presenting the answer as this one.

## Design

### Approach

**`waveSummary` comes from the pulse, not the plan.** The fleet cache already
holds a parsed `FleetPulse` per plan — the same object the Agents tab
classifies from — carrying each branch's real `state` (`open`/`wip`/`claimed`/
`merged`/`deferred`) and each wave's `verdict`. The card builder reads that
instead of `meta.waves`.

    claimed  = branches whose git state is `claimed`
    eligible = branches in a wave whose verdict is `eligible`, still `open`

`summariseWaves(meta.waves)` is then deleted rather than left beside its
replacement. A function that reads a field nobody writes is a trap for the next
person, and keeping both would invite exactly the disagreement being removed.

**The pulse may be absent, and absent is not zero.** The cache is empty for the
first seconds after start-up, and a scan can fail. `claimed: 0` and *"I have no
pulse yet"* must not render identically — that is the very confusion this plan
exists to remove. So both counts are optional in the contract, and a card
without a pulse omits them rather than showing zeros. The wave and branch
counts stay plan-derived and keep rendering: those genuinely do come from the
plan file, and they are still true when git is unreadable.

**`/plot-dispatch` records what it started.** After a successful claim, append
one line per dispatched branch:

    - **Started:** <date>, <who>, `<branch>`

Same shape `/plot-implement` writes, so nothing downstream learns a second
format. It is written **after** the claim push succeeds, never before: a
`Started:` record for a branch another dispatcher won would be a lie in the
file, and the claim is the only thing that decides who owns the branch.

Where the plan cannot be written — the plan lives on the default branch, and
the push may be refused — the dispatch still stands. The claim and the worktree
are the real state; the record is bookkeeping about it. The script reports the
failure and continues rather than unwinding a fan-out that already happened.

**Manifesto check.** Principle 1: every number the card now shows is derived
from refs rather than from a note about refs. Principle 3: the board reads the
scan's output; it does not re-implement wave arithmetic. Principle 12: the
counts are read back from git rather than assumed from what a plan said.

### Open Questions

- [ ] Should the *Start work* button now use `eligible` to disable itself? The
      data will exist for the first time, but the plan that owns the button is
      delivered — this plan supplies the number and leaves the decision to
      whoever wires it.
- [ ] `/plot-dispatch --dry-run` writes nothing today and must keep writing
      nothing. Worth a test rather than a note?

## Branches

### Fixes

- `bug/board-claimed-from-git` — `waveSummary` from the pulse: real `claimed`, new `eligible`, `summariseWaves` deleted
- `bug/dispatch-records-started` — `plot-dispatch.sh` writes the `Started:` record after a successful claim

<!-- One wave, two branches, deliberately concurrent. They share no file: the
     first is the board package, the second a shell script that does not
     rebuild the artifact. That is what makes them safe to run at once — the
     previous plan's waves had to be sequential precisely because both touched
     the board bundle, which conflicted on all three merges. -->

Both branches are in one wave because they can genuinely run at the same time,
and this plan is also the first chance to test that claim: every earlier
fan-out in this repo had branches that collided in the built artifact.

## Notes

Shaped 2026-08-16 from three findings recorded in the plot-board story while
delivering `board-acts-through-plot`. Each was found by looking at a running
board during a real dispatch — none by reading the code, though reading
confirmed all three afterwards (`summariseWaves` reads `b.claimed`;
`WaveSummary` has no `eligible`; `plot-dispatch.sh` contains `Started:` zero
times).

Deliberately not here: the stale-bundle trap (a running board does not pick up
a rebuilt artifact) and the artifact merge conflicts. Both are development
friction rather than wrong output, and both are recorded in the story.

Definition of Done: `docs/definition-of-done.md`.
