# DONE holds what is still yours

> Two thirds of DONE is released work the board has no further say over, and the section wears an activity mark earned by a test fixture in a merged branch's stale worktree.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- DONE now holds merged work awaiting testing, and drops released work the board has nothing further to say about. A finished row no longer reports activity because its worktree still holds an uncommitted file.

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

**1. Membership — DONE means a PLAN that is merged and not yet released.**

Two conditions, and both are about the plan rather than the row:

- **Released leaves.** The phase every row already carries decides it.
- **A plan with any wave still in flight leaves.** Its merged waves are
  milestones, not deliveries; they belong wherever the plan's unfinished work
  is, so the plan appears once and in the section that describes it.

What remains is exactly the interval DONE is for: every wave merged, nothing
released yet.

Where released work goes is the open question below — dropped entirely, or
behind a deliberate act. What must not happen is 41 rows of shipped work sitting
where a reader looks for what needs testing.

**2. A finished row is not active.**

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

- No `Released` row appears in DONE. Asserted over a pulse containing released
  and merged rows, with the merged ones still present — a test that only checks
  the count falls passes an implementation that empties the section.
- A **merged** row whose worktree is dirty reports **no** activity mark, and its
  section reports none because of it. Asserted with `localDirty: true` on a
  merged row: that is the exact live shape, and an implementation keyed on the
  fixture's filename passes every other test here.
- A row in WORKING with `localDirty` still reports activity — the mark must
  keep working where it was right.
- A plan with one merged wave and one wave still in flight puts **no** row in
  DONE. Asserted on the four live shapes measured above, since a test built from
  a single-wave plan cannot fail this way.
- A plan whose every wave is merged and which is not released **is** in DONE —
  the section must not empty itself, which is what an over-strict rule would do.
- If the static stale-worktree mark is built, it is visibly not the motion mark.
- `pnpm run test:board` green; artifact rebuilt and committed.

## Branches

### Scoped

- `bug/done-holds-finished-plans-only` — DONE holds plans whose every wave is merged and which are not yet released; released work and plans still in flight both leave

### Still

- `bug/a-finished-row-is-not-active` — `isActive` reports no pulse for merged or deferred work, whatever its worktree holds; the rule is the row's finishedness, never a filename

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
