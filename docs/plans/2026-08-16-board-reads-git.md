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
field, its source changes, and `fleet.ts` exports one more accessor. No
plan-format change and no new helper script — but `plot-dispatch.sh` gains a
write it never had, which is the larger change of the two in risk if not in
lines. The artifact is rebuilt, so the Definition of Done's no-diff gate
applies.

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

**The route already exists.** Wave 1 of the previous plan had the board reach
into the fleet cache for PR links: `board.ts` imports `prsByNumber(opts)` from
`fleet.ts`, which reads the cache synchronously and returns `| null` when it is
empty. So `pulseFor(opts)` is a second export of exactly that shape beside it —
not a new mechanism, and no reason to make `buildBoard` async. There is no
import cycle: `fleet.ts` takes only a *type* from `board.ts`.

Making `buildBoard` await a scan was the alternative and is rejected for the
reason the cache exists at all: `/api/board` would block on a 0.5–1.05 s scan
on a single-threaded server. Having `fleet.ts` return finished card summaries
was also considered — it thins `board.ts`, at the price of teaching the fleet
module about cards, which is not its subject.

`summariseWaves(meta.waves)` is then deleted rather than left beside its
replacement. A function that reads a field nobody writes is a trap for the next
person, and keeping both would invite exactly the disagreement being removed.

**Single-wave plans get a summary too.** Today the card builder guards with
`if (meta.waves.length > 1)`, so a one-wave plan carries no `waveSummary` at
all — which would have left the new numbers missing from exactly the plans this
repo has most of. That guard was right about *"waves · branches"*, which is
noise when there is one of each. It is wrong about `claimed` and `eligible`:
whether someone is working on the single branch of a single-wave plan is the
same question, and just as worth answering. The summary is computed for every
plan; what the tile chooses to render stays a display decision.

**The pulse may be absent, and absent is not zero.** The cache is empty for the
first seconds after start-up, and a scan can fail. `claimed: 0` and *"I have no
pulse yet"* must not render identically — that is the very confusion this plan
exists to remove. So both counts are optional in the contract, and a card
without a pulse omits them rather than showing zeros. The wave and branch
counts stay plan-derived and keep rendering: those genuinely do come from the
plan file, and they are still true when git is unreadable.

**`/plot-dispatch` records what it started** — one line per dispatched branch,
the same shape `/plot-implement` writes so nothing downstream learns a second
format:

    - **Started:** <date>, <who>, `<branch>`

It is written **after** the claim push succeeds, never before. A `Started:`
record for a branch another dispatcher won would be a lie in the file, and the
claim is the only thing that decides who holds a branch.

**Where it is written is the whole difficulty.** `plot-dispatch.sh` finds the
plan in its *local working tree* — `docs/plans/active/<slug>.md` relative to
wherever the dispatcher happens to be checked out — while the board reads the
plan from the **default branch**. Editing the local file in place would commit
the record to whatever branch the dispatcher was standing on, and the board
would never see it. That is not hypothetical: it is precisely the gap that had
to be back-filled by hand this morning, on this repo, twice.

So dispatch books the way every other Plot command books, through a disposable
branch off the default branch:

    git checkout -b plot/start-<slug> origin/<default>
      → append the Started line
      → plot-push-main.sh plot/start-<slug> <default>

`plot-push-main.sh` rather than a bare `git push`, so a repo whose protection is
configured but not enforced hears about the bypass instead of it passing
silently — the same reason that helper exists.

**A failed booking never unwinds a fan-out.** Offline, refused, or beaten to
the ref by another dispatcher: the worktree exists and the claim is pushed by
then, and those are the real state. The record is a report *about* that state.
Rolling back real work because a note could not be saved is the larger damage,
and aborting mid-fan-out would leave exactly the inconsistency it claims to
prevent. The script says what failed and carries on.

Booking *before* the fan-out was the other candidate and is worse for a
symmetric reason: it would write `Started:` for branches whose claim a
competing dispatcher may still win.

**The booking must be testable without pushing anywhere.** Adding a network
write to `plot-dispatch.sh` puts it in the same position the dispatch route was
in: the interesting behaviour cannot be exercised against a real remote from
CI. `test/reconcile/dispatch.test.mjs` already drives the script against
scratch repos, so the booking is tested there — against a local bare remote,
where a push genuinely succeeds and genuinely fails. What must be pinned is
that a **failed booking leaves the fan-out standing**: the worktree exists, the
claim is pushed, and the summary still reports what it dispatched. That
assertion is the one that matters, for the same reason `and started nothing`
mattered on the route — every other one can pass while the damage happens.

`--dry-run` must remain silent here as everywhere else: it writes no branch, no
commit and no push. Worth an explicit test rather than a note, since this is
the first write `--dry-run` has had to suppress that leaves the repository.

**Manifesto check.** Principle 1: every number the card now shows is derived
from refs rather than from a note about refs. Principle 3: the board reads the
scan's output; it does not re-implement wave arithmetic. Principle 12: the
counts are read back from git rather than assumed from what a plan said.

### Open Questions

- [ ] Should the *Start work* button use `eligible` to disable itself once the
      number exists? Supplying it is this plan's job; wiring the button belongs
      to the delivered plan that owns it, and reaching across would edit a card
      this plan has no claim on. The answer probably becomes obvious the first
      time someone clicks Start work on a plan where nothing can start.

## Branches

### Fixes

- `bug/board-claimed-from-git` — `pulseFor()` beside `prsByNumber`; `waveSummary` from the pulse (real `claimed`, new `eligible`), computed for single-wave plans too, `summariseWaves` deleted
- `bug/dispatch-records-started` — `plot-dispatch.sh` books `Started:` on a disposable branch pushed to the default branch, after the claim, never unwinding on failure

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

Interrogation moved the dispatch half considerably and confirmed the board
half. `board.ts` already reaches into the fleet cache — Wave 1 of the previous
plan added `prsByNumber`, synchronous and `| null` on an empty cache — so the
pulse access is a second export of a proven shape rather than a new idea. It
also turned up `if (meta.waves.length > 1)`, which would have withheld the new
numbers from every single-wave plan, i.e. from most of this repo.

The dispatch half changed shape entirely. The first draft said "append the line
to the plan file", which reads as obvious and is wrong: `plot-dispatch.sh`
reads the plan from its *local working tree* on whatever branch the dispatcher
is standing on, while the board reads the default branch. The booking would
have landed somewhere the board never looks — the same failure that had to be
corrected by hand twice this morning, reproduced in a script and therefore
permanent. It now books through a disposable branch like every other Plot
command, which in turn is what forced the testing rule: a script that pushes
needs a test that proves a *failed* push leaves the fan-out standing.

Deliberately not here: the stale-bundle trap (a running board does not pick up
a rebuilt artifact) and the artifact merge conflicts. Both are development
friction rather than wrong output, and both are recorded in the story.

Definition of Done: `docs/definition-of-done.md`.
