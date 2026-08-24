# The working section shows every worker

> WORKING renders 0 rows while the registry holds 23 agents, every one with a
> worktree. A worker's place in the section is decided by its branch's pull
> request instead of by the worker.

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- WORKING lists every worker the registry knows, whatever its branch's pull
  request says and whatever the worker is doing — running, idle, stalled,
  finished or unrecognised. A section that answers *who is working* is
  answering about workers, and a worker that exists is a fact about the fleet
  even when the answer is *nobody is on this one*.
- A worker that is busy names the **wave** it is working, not only its branch,
  so a reader sees what the fleet is spending itself on.
- The registry drops an entry whose session has ended, so a worktree left
  behind by a finished agent stops being reported as a worker.

## Motivation

### The measurement

Taken from the live board on 2026-08-24, against the real estate:

| what | count |
|---|---|
| registry entries, all carrying a worktree | **23** |
| of those, rows rendered in WORKING | **0** |
| worktrees holding a `.plot-worker.pid` | 20 |
| of those pids still alive | **0** |

Earlier the same day the section rendered **2** rows while the control beside
it read **`3 parallel agents · 5 working`** — three numbers describing one
fleet, no two agreeing.

### Why the rows disappear

`classify` in `fleet.ts` reaches the worker question only after the pull-request
arm has had its say (line 2843). A running worker survives that arm only when
`prAsksNobody(pr)` — the PR is a draft, green, or pending. Any other PR outranks
the worker and the row leaves WORKING.

The consequence is exactly backwards. On 2026-08-24:

- `the-agents-tab-filters-to-the-sprint` — worker running, PR **open and
  CONFLICTING** → hidden from WORKING
- `the-estate-speaks-waves` — worker running, PR **closed** → **shown** in
  WORKING

A closed PR returns `['closed']` from `prState`, which is neither green nor
pending, so `prAsksNobody` is false and the row passes the guard. The section
therefore showed the two workers whose PRs were abandoned and hid the four whose
work was live.

### Why the count and the rows disagree

They are computed from different sources and never reconciled:

| number | computed by | over |
|---|---|---|
| `working` | `liveAgentCount` (auto-dispatch.ts:129) | registry entries in `running`/`waiting`, minus landed branches |
| the rows | `classify` (fleet.ts) | branches, filtered by PR state |
| `parallelAgents` | a stored setting | nothing — it is a cap on auto-dispatch, not a measurement |

`parallelAgents` is a bound on what auto-dispatch starts. It never bounded
hand-dispatched workers, and nothing reconciles the two, which is how six
workers existed under a cap of three.

### Why dead workers persist

Liveness is read from `$wt/.plot-worker.pid` and `kill -0`. Nothing removes the
file when a session ends, so a finished agent leaves a pid behind and the
worktree keeps answering. All 20 pid files on this machine named dead
processes. One of them, `72961`, sat in the worktree the board itself was later
started from — which is why an entry appeared for branch `main` and read as a
worker. The board was never counting itself; it inherited a dead worker's
marker.

## Design

### The worker decides its own section

Move the worker question **above** the pull-request arm for WORKING membership.
A worker in a worktree is a measurement; a PR's state is a fact about the
branch, and the branch is not what the section is about.

This does not silence the PR. A row in WORKING still reports its PR's condition
— conflicts, failing checks, closure — in its note, exactly as it does today.
What changes is which section it lands in, not what it says once there.

### Every worker appears, whatever it is doing

Registry states are `running`, `waiting`, `stalled`, `finished`, `unknown`.
Today only the first two count as live, and only some of those survive to render.

All five appear in WORKING. The section's subject is the fleet, and *"this
worker finished and nobody collected its work"* is precisely the fact a reader
needs — it is how a stalled worker with an unpushed commit was found on
2026-08-24, and it was found by reading a process table, not the board.

The row states which it is. `someone is on it` is reserved for a worker that is
actually running; an idle, stalled, or finished worker says so plainly. A row
whose usual state is a lie teaches its reader to ignore it.

### A busy worker names its wave

A registry entry carries `branch`, not `wave`. The pulse already knows which
wave holds a branch — the fleet payload derives waves per plan — so the wave is
a join, not a new field on disk.

A running worker's row names the wave it is working. Where the branch belongs to
no wave the row says nothing rather than inventing one: absent is not false.

### The registry is reconciled against reality

An entry whose worktree is gone, or whose pid names a process that no longer
exists **and** whose session has ended, is dropped rather than reported as a
worker. This is the sync between the registry and the agent sessions that
created it.

The rule is not *pid is dead → drop*: a worker that exits leaving unpushed
commits is the discovery a reader most needs, and dropping it would hide the
failure. What is dropped is an entry that no longer describes anything — no
live process, no session, no work waiting to be collected.

### The count is the rows

`working` counts what WORKING renders. One derivation, read twice, so the two
cannot drift. The stepper's `parallel agents` stays a cap and is labelled as
one, since a cap and a measurement are different claims about different things.

## Waves

### Shown (Branch: bug/the-working-section-shows-every-worker)
- the worker question outranks the PR arm for WORKING membership; all five
  registry states render; the row says which state it is, and `someone is on
  it` narrows to a genuinely running worker

### Counted (Branch: bug/the-working-count-is-the-rows)
- `working` derives from the same set the section renders; the cap is labelled
  as a cap

### Named (Branch: feature/a-busy-worker-names-its-wave)
- a running worker's row names the wave it is working, joined from the pulse;
  silent where the branch belongs to no wave

### Reconciled (Branch: bug/the-registry-drops-an-ended-session)
- an entry describing neither a live process, nor a session, nor uncollected
  work is dropped from the registry

## Done when

1. **Every registry entry with a worktree renders a row in WORKING.** Measured
   against the live estate, not a fixture: 23 entries → 23 rows.
2. **A worker whose PR is open and conflicting appears in WORKING.** This is the
   case that was hidden.
3. **A worker whose PR is closed appears in WORKING** — and its row says the PR
   is closed. It appears because a worker is there, not because the PR arm let
   it slip through.
4. **`N parallel agents · M working` has M equal to the number of rows
   rendered.** Asserted over a fixture where the two derivations would disagree
   under the old code.
5. **Only a running worker's row reads `someone is on it`.** An idle, stalled,
   finished, or unknown worker states its own condition.
6. **A running worker's row names its wave.** Where the branch belongs to no
   wave, the row says nothing — asserted, so a fallback string cannot creep in.
7. **A worktree whose pid is dead, whose session has ended, and which holds no
   uncommitted or unpushed work is absent from the registry.**
8. **A worktree whose pid is dead but which holds unpushed commits is still
   reported**, with what it is holding. The 2026-08-24 stall left a complete
   implementation nobody had collected; that must stay visible.
9. `pnpm run test:board` green; the artifact rebuilt and committed.

## Notes

### Not chosen: teach the PR arm about closed PRs

The narrow fix is to make `prAsksNobody` return true for a closed PR, so a
closed-PR worker stops passing the guard. That removes the two wrong rows and
leaves the four missing ones missing — it corrects the symptom that was visible
and not the rule that produced it.

### Not chosen: exclude the board's own process

The first diagnosis on 2026-08-24 held that the board counted itself, because an
entry appeared for branch `main` in the worktree the board was serving. The pid
file there named `72961`, a reaped worker, not the board's `8141`. There is no
self-counting bug and a self-exclusion rule would have been a guard against
something that never happens, hiding the stale-marker defect that does.

### The cap and the measurement are different claims

`parallelAgents` bounds auto-dispatch. It has never bounded a hand-dispatched
worker and this plan does not make it: an operator who dispatches six workers
under a cap of three has done something deliberate, and a board that refused to
show the sixth would be lying about the fleet to defend a setting.
