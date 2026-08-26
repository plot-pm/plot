# DONE holds what is still yours

> Two thirds of DONE is released work the board has no further say over, one row is a Draft plan, and the section wears an activity mark earned by a test fixture in a merged branch's stale worktree.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `bug/a-finished-row-is-not-active`
- **Delivered:** 2026-08-23
- **Released:** 2026-08-26, 2.9.0

## Approval

- **Assignee:** Jan Wloka

## Changelog

- DONE now holds the **release scope** — every plan whose work has landed and whose version has not shipped, which is what is ready for the release's endgame test. It holds only work that is actually finished at every level — the plan's phase, the wave's verdict, and the branch's state. It holds exactly the two phases it is about — `Development` (some waves still elsewhere) and `Endgame` (every wave merged, ready for the endgame) — and drops `Discovery` and `Released`. A finished row no longer reports activity because its worktree still holds an uncommitted file.

<!-- Board impact: board-only. packages/board/src/app/components/AgentList.tsx
     (isActive / the DONE membership rule) and possibly src/server/fleet.ts's
     grouping. Rebuild the artifact. -->

## Motivation

Measured against the live board, 2026-08-23 (`/api/fleet`, 106 rows).

### DONE is two thirds released

```
DONE rows: 61
by phase: Released 41 · Development 10 · Endgame 9 · Discovery 1
```

**41 of 61 rows are `Released`.** That work has shipped: it is out of the
board's scope, nothing about it is a call to action, and it crowds the section
that should answer *what landed and still wants testing*.

The section's job is the interval between **merged** and **released** — work
that is done being written and not yet proven in a release. Before that it is in
flight; after it, the board has nothing left to say.

### A plan still being worked appears in DONE

Measured on the same payload — four plans have rows in DONE **and** rows still
in flight:

```
approval-hands-the-work-to-agents   done=1  elsewhere=2  [not-started, waiting-on-you]
every-section-has-one-subject       done=3  elsewhere=1  [not-started]
waves-name-themselves               done=2  elsewhere=1  [not-started]
a-wave-is-a-thing-not-a-label       done=1  elsewhere=1  [waiting-on-you]
```

A merged wave of an unfinished plan is a **milestone, not a delivery**. Nothing
about that plan is ready for testing: the next wave has not been written, so
what landed cannot be exercised as a whole. Putting it in DONE invites a reader
to test something that is half-built, and it is the same unstated partiality
`a-split-plan-says-it-is-split` describes — here it produces a wrong claim
rather than a quiet omission.

**The plan is the unit of doneness, not the wave.** A wave finishing is
progress; a plan finishing is a result. DONE answers *what is ready to test*,
and only a plan can be.

### A merged branch of an unfinished wave appears in DONE

The same category error one level down, and the row says it out loud.
`every-section-has-one-subject` renders four rows:

```
wave=Inverted  state=open    verdict=eligible  group=not-started  "eligible — nobody has taken it"
wave=Removed   state=merged  verdict=complete  group=done         "merged"
wave=Surfaced  state=merged  verdict=complete  group=done         "merged"
wave=Inverted  state=merged  verdict=eligible  group=done         "merged — wave still open"
```

`Inverted` is a **two-branch wave**: `the-registry-knows-which-agents-live`
merged (PR #327), `working-is-about-agents` is still open. So the wave appears
twice — once in NOT STARTED for its unstarted branch, once in DONE for its
merged one.

**`state` and `verdict` answer different questions**, and DONE is reading the
wrong one. `state=merged` is about THIS BRANCH; `verdict=eligible` is about the
WAVE, and eligible means there is unclaimed work left in it. The note already
prints the contradiction — *merged — wave still open* — beneath a heading that
claims the work is done.

Measured: exactly **1 of 61** DONE rows has a non-`complete` verdict, and it is
this one. Rare, and precisely the kind of rare that survives review.

### The section wears an activity mark it did not earn

DONE renders a green pace dot. Traced to seven rows:

```
group=done  state=deferred  localDirty=true   waiting-on-you-says-what-kind-of-waiting
group=done  state=merged    localDirty=true   a-row-is-a-tuple
group=done  state=merged    localDirty=true   every-section-has-one-subject
group=done  state=merged    localDirty=true   a-plan-moves-through-the-sections
group=done  state=merged    localDirty=true   an-interrogation-leaves-a-record
group=done  state=merged    localDirty=true   approval-hands-the-work-to-agents
```

`isActive(row)` is `localDirty || localLocked` — a fact about a **worktree on
disk**, asked without reference to whether the row's work is finished. A merged
branch whose worktree still holds an uncommitted file therefore reads as
*someone is writing here*.

**What the file actually is closes the case.** Every one of those worktrees is
dirty for the same reason:

```
M packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json
```

That is the board's own test fixture, which the board's own suite rewrites when
it runs. **The board is reporting activity caused by running its tests.** No
agent is there; several of those branches merged days ago.

The mark's own docstring rules this out in words:

> This is a PULSE: someone is writing, or has written and not committed.

On a merged branch nobody is writing, and there is nothing left to commit — the
worktree is a stale artifact of a fan-out, not a desk anyone is sitting at.

## Design

### Two independent fixes

They meet in one section and share no mechanism; either without the other leaves
a real defect standing.

**1. Membership — DONE holds two phases and no others.**

The rule is the plan's **phase**, which every row already carries and which Plot
derives from the plan's own transition records:

| phase | record | in DONE? | why |
|---|---|---|---|
| `Discovery` | none (Draft) | **no** | not approved; a merged wave here is not a result |
| `Development` | `Approved:` | **yes** | partially done — some waves merged, others elsewhere |
| `Endgame` | `Delivered:` | **yes** | every wave merged, ready for the endgame |
| `Released` | `Released:` | **no** | shipped, and out of the board's scope |

Everything else is neither DONE nor RELEASED and belongs in the section its own
state describes.

**And the row's WAVE must be complete, not merely its branch.** A merged branch
whose wave is still `eligible` or `blocked` stays out: the wave has unclaimed or
unfinished work, so nothing about it is ready. The board already computes this
(`verdict`) and already prints it (*merged — wave still open*); DONE simply is
not reading it.

Three questions, three levels, and DONE must answer all three: is the PLAN in a
phase that belongs here, is the WAVE complete, and is the BRANCH merged. Reading
only the branch is what puts a half-finished wave under a heading that says
done.

**There is no `Testing` phase, and `Endgame` is it.** The phase whose date comes
from `Delivered:` is precisely *all waves merged, not yet released* — which is
what "ready for testing" means here. The vocabulary already has the slot; it is
named for what follows rather than for what is happening in it.

### DONE is the RELEASE SCOPE, not a time window

The membership rule is not *recently finished*; it is **everything collected for
the next release, waiting on its endgame test**. A plan enters when its work
lands and leaves when the release ships.

That reframes the section: DONE is not an archive that decays, it is a **queue
that drains**. Its rows are the test scope for the version being cut, and cutting
the version empties it.

```
work lands   →   DONE  (in scope for the next release, ready for testing)
release cut  →   gone  (shipped; the board has nothing further to say)
```

### Which makes `Released` the leave-condition, and it already works

`Released` is exactly *the release shipped*, and it is the one phase whose
transition is driven by a version rather than a date — `/plot-release` resolves
it from `git tag --contains`, never from a record. So the drain is already
correct: **41 rows leave because their version shipped.**

### The scope signal exists, and it is not enough on its own

Sprints declare a target — `2026-W34-working-shows-the-agent` carries
`Release: 2.8.0` — and plans carry `Sprint:`. So *collected for the next release*
could be read as `plan.sprint → sprint.Release`.

**Measured 2026-08-23, that reading fails.** Of the 14 unreleased plans:

```
approved   4 carry sprint=working-shows-the-agent
approved   6 carry no sprint
delivered  4 carry NO SPRINT — and these are the ones actually ready to test
```

**Every delivered plan has no sprint.** A sprint-keyed DONE would show **zero**
rows ready for testing while four sit finished. The signal exists and does not
cover the population.

There is a second failure waiting behind it: `2026-W34-the-board-tells-the-truth`
declares `Release: 2.6.0`, which shipped two versions ago. A stale sprint would
pin its plans to a released version permanently.

### So the rule is by PHASE, and the phase already means this

**Not-yet-released is the scope.** A plan whose work has landed and whose version
has not shipped *is* in the next release by construction — that is what
unreleased means. No annotation is required, nothing needs maintaining, and it
cannot go stale.

| plan phase | in DONE? | why |
|---|---|---|
| `Discovery` | no | nothing is committed to |
| `Development` | yes, **once its waves are complete** | landed, unreleased — in scope |
| `Endgame` | **yes** | delivered, unreleased — the core of the scope |
| `Released` | **no** | shipped; the release drained it |

**Sprint membership is a filter, not the rule.** Where a project uses sprints,
narrowing DONE to one sprint's scope is a useful view — and the board already has
sprint filters on the Board tab. It must not be the *membership* test, because
ten of fourteen unreleased plans here would vanish from it.

> This replaces an earlier reading in this plan that treated DONE as a recency
> window — *"4 plans at Endgame, ~2 days each"*. The measurement was right and the
> framing was wrong: those four are not recent, they are **unshipped**, and the
> difference matters the moment a plan sits unreleased for a month. A time window
> would drop it; a release scope keeps it until the release that carries it.

### The section wears an activity mark it did not earn

DONE renders a green pace dot. Traced to seven rows:

```
group=done  state=deferred  localDirty=true   waiting-on-you-says-what-kind-of-waiting
group=done  state=merged    localDirty=true   a-row-is-a-tuple
group=done  state=merged    localDirty=true   every-section-has-one-subject
group=done  state=merged    localDirty=true   a-plan-moves-through-the-sections
group=done  state=merged    localDirty=true   an-interrogation-leaves-a-record
group=done  state=merged    localDirty=true   approval-hands-the-work-to-agents
```

`isActive(row)` is `localDirty || localLocked` — a fact about a **worktree on
disk**, asked without reference to whether the row's work is finished. A merged
branch whose worktree still holds an uncommitted file therefore reads as
*someone is writing here*.

**What the file actually is closes the case.** Every one of those worktrees is
dirty for the same reason:

```
M packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json
```

That is the board's own test fixture, which the board's own suite rewrites when
it runs. **The board is reporting activity caused by running its tests.** No
agent is there; several of those branches merged days ago.

The mark's own docstring rules this out in words:

> This is a PULSE: someone is writing, or has written and not committed.

On a merged branch nobody is writing, and there is nothing left to commit — the
worktree is a stale artifact of a fan-out, not a desk anyone is sitting at.

## Design

### Two independent fixes

They meet in one section and share no mechanism; either without the other leaves
a real defect standing.

**1. Membership — DONE holds two phases and no others.**

The rule is the plan's **phase**, which every row already carries and which Plot
derives from the plan's own transition records:

| phase | record | in DONE? | why |
|---|---|---|---|
| `Discovery` | none (Draft) | **no** | not approved; a merged wave here is not a result |
| `Development` | `Approved:` | **yes** | partially done — some waves merged, others elsewhere |
| `Endgame` | `Delivered:` | **yes** | every wave merged, ready for the endgame |
| `Released` | `Released:` | **no** | shipped, and out of the board's scope |

Everything else is neither DONE nor RELEASED and belongs in the section its own
state describes.

**And the row's WAVE must be complete, not merely its branch.** A merged branch
whose wave is still `eligible` or `blocked` stays out: the wave has unclaimed or
unfinished work, so nothing about it is ready. The board already computes this
(`verdict`) and already prints it (*merged — wave still open*); DONE simply is
not reading it.

Three questions, three levels, and DONE must answer all three: is the PLAN in a
phase that belongs here, is the WAVE complete, and is the BRANCH merged. Reading
only the branch is what puts a half-finished wave under a heading that says
done.

**There is no `Testing` phase, and `Endgame` is it.** The phase whose date comes
from `Delivered:` is precisely *all waves merged, not yet released* — which is
what "ready for testing" means here. The vocabulary already has the slot; it is
named for what follows rather than for what is happening in it.

### Endgame IS the testing window, and it is small

Measured 2026-08-23: **4 plans sit at Endgame** (delivered, not released) against
70 released — a 5% slice, and each of the four was delivered within the last few
days. Plans move `delivered → released` quickly.

So after this filter, DONE **becomes the testing queue**: work that landed and
has not yet shipped. That is the section's purpose stated exactly, and it means
DONE will be **small** — 61 rows today become ~19, and fewer as the Development
plans finish.

That smallness is the feature. A section holding 61 rows, two-thirds of them
shipped months ago, cannot answer *what needs testing*; one holding four can.

> Worth deciding separately: whether `Endgame` should be renamed. It is the one
> phase whose name describes the NEXT step rather than the state, which is why
> the rule had to be explained rather than read off. Out of scope here.

**`Discovery` in DONE is measurable today**, and it is the clearest case: the
live payload has one — `a-wave-is-a-thing-not-a-label`, wave `Modelled`, merged
and complete, on a plan that is still a **Draft**. A merged wave of an
unapproved plan is not a delivery; the plan has not been agreed to yet.

**2. A finished row is not active — and does not report a live worker either.**

Two faces of one rule, folded together because they are the same category error
in the same file.

**The activity mark** fires on `localDirty || localLocked`, a worktree fact, for
work that is finished.

**And the worker state goes stale.** Measured 2026-08-23, three DONE rows carry a
worker of `failed` or `waiting` on branches that are `merged` or `deferred`:

```
worker=failed   state=deferred   waiting-on-you-says-what-kind-of-waiting / Moved…
worker=waiting  state=deferred   waiting-on-you-says-what-kind-of-waiting / Moved…
worker=failed   state=merged     waves-name-themselves / Written
```

The branch landed; the worklog's last recorded state never cleared. **A finished
branch reporting a live worker state is stale bookkeeping** — a worklog fact
outliving the work it described, which is the same shape as the activity mark and
wants the same answer.

**This does NOT self-resolve when DONE is filtered.** Two of the three rows are
`Development`/`Endgame` and stay in DONE under the new membership rule; only the
`Released` one leaves. Choosing to ignore it would be choosing a known-stale
display.


`isActive` must ask whether the row's work is finished before reporting a pulse.
A merged or deferred row reports **no** activity regardless of what its worktree
holds, because there is no writing left to observe.

**Guard against the tempting narrow fix.** Ignoring `last-pulse.json`
specifically would silence today's instance and leave the rule wrong: any
uncommitted file in any stale worktree brings the mark back, and the next
occurrence looks like a new bug. The defect is *asking a live question about
finished work*, not *this one file*.

That said, a stale worktree on a merged branch is a real condition worth
reporting — it is how the estate accumulates the debris this session has been
clearing. It earns a **static** mark of its own (*a worktree is still here*),
never the motion mark. The same argument `localAhead` already won:

> Unpushed commits are finished work sitting STILL: a real condition with a real
> remedy and no motion behind it.

### Open Questions

- [ ] Where does released work go — dropped from the Agents tab entirely, or
      behind a toggle/filter? Dropping is simpler and matches *out of the
      board's scope*; a filter keeps a way back for someone auditing history.
      Decide from whether anyone ever needs to find a released row here, not
      from which is easier.
- [ ] Does the same released-work argument apply to the **Board** tab, or is
      that tab the place where released work legitimately lives? They answer
      different questions and may want different rules — settle it explicitly
      rather than by changing one and leaving the other.

## Done when

- **A released plan leaves DONE the moment its version ships**, and nothing else
  removes it. Asserted with two pulses either side of a release: the rows present
  before are absent after, and no row leaves for any other reason. This is the
  drain, and it is the property that makes DONE a queue rather than an archive.
- **A plan sitting unreleased for a long time stays in DONE.** Asserted with a
  delivered plan dated months back — a recency window would drop it, and this is
  the difference between the two readings.
- **Sprint membership does not decide membership.** Asserted directly: a plan
  with no `Sprint:` still appears when its work has landed. Ten of the fourteen
  unreleased plans have no sprint, and all four delivered ones do not — so a
  sprint-keyed rule shows zero rows ready for testing.
- **DONE holds exactly `Development` and `Endgame`.** Asserted over a pulse
  carrying all four phases, checking both directions: the two are present and
  the other two are absent. A test that only counts rows falls for an
  implementation that empties the section.
- A **`Discovery`** row does not appear in DONE even when its wave is merged and
  complete. That is the live shape (`a-wave-is-a-thing-not-a-label`, wave
  `Modelled`), and it is the case a Released-only filter still gets wrong.
- A merged branch whose **wave verdict** is not `complete` does not appear in
  DONE. The live shape is `every-section-has-one-subject` / `Inverted`
  (`state=merged`, `verdict=eligible`) — **1 of 61 rows**, so a test built from
  the common case cannot fail this way and a phase-only filter keeps it.
- A row leaving DONE arrives **somewhere** — no row is dropped from the board by
  this change unless it is `Released`. Asserted on the total: rows in minus rows
  out, since a membership rule is the easy place to lose a row silently.
- A **merged** row whose worker is `failed` or `waiting` does not present that
  state as current. Three such rows exist today and two survive the membership
  filter, so this cannot be left to the filter to fix.
- A **merged** row whose worktree is dirty reports **no** activity mark, and its
  section reports none because of it. Asserted with `localDirty: true` on a
  merged row: that is the exact live shape, and an implementation keyed on the
  fixture's filename passes every other test here.
- A row in WORKING with `localDirty` still reports activity — the mark must
  keep working where it was right.
- If the static stale-worktree mark is built, it is visibly not the motion mark.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Waves

<!-- `bug/done-holds-finished-plans-only` MOVED on 2026-08-23 to
     the-wave-is-a-thing-the-board-can-hold, wave `Consumed`. Its verdict rule is
     unsatisfiable while a wave can be in two sections, so it waits on
     `bug/a-wave-is-one-row` — and a wave is the unit Plot will hold it in, rather
     than a note in this file that nothing enforces.

     The branch below stayed: it reads worktree and worker facts, not wave
     placement, so nothing blocks it. -->


### Still (Branch: bug/a-finished-row-is-not-active, PR: #336)
- a finished row reports neither a pulse nor a live worker state: `isActive` ignores worktree facts on merged or deferred work, and a `failed`/`waiting` worker on a landed branch reads as stale rather than as current. The rule is the row's finishedness, never a filename

## Notes

Reported from the running board, 2026-08-23: *"The done section even has an
activity indicator"*, and *"DONE should only show merged (aka ready for
testing), all Released should not be shown here — it's already out of the
board's scope."*

Both were traced to the live `/api/fleet` payload rather than to the screenshot,
which is what turned the activity mark from *a stray dot* into *the board
reporting its own test run*: the seven dirty worktrees are all dirty on
`test/fixtures/tiny-garden/.plot/state/last-pulse.json`, the fixture the board
suite rewrites.

That fixture's habit of appearing in unrelated diffs is already known in this
estate. This is the first time it has been observed changing what the board
*says*.
