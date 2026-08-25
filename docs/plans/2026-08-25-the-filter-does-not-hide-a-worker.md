# The filter does not hide a worker

## Status

- **Phase:** Draft
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** <!-- YYYY-MM-DD, who, channel -->
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

`Sprint only` no longer hides a running agent, and every count it does affect
says so. A section and the control above it cannot disagree about the fleet.

## Motivation

### The measurement

Taken from `/api/fleet` with `Sprint only` ON, 2026-08-25, immediately after
`the-sprint-filter-says-what-it-filters` wave **Joined** landed:

```
WORKING   2 working        ← the control
WORKING   none             ← the section
```

Both describe the same fleet, in the same viewport, one line apart.

The filter is **not** wrong. Both hidden rows are plans that genuinely are not
sprint members:

| branch | plan | `Sprint:` field |
|---|---|---|
| `feature/a-worker-asks-for-the-next-wave` | a-worker-asks-for-the-next-wave | *(empty)* |
| `feature/the-filter-shows-what-it-excludes` | the-sprint-filter-says-what-it-filters | *(empty)* |

Both carry `<!-- not a member of … -->`, which is an HTML **comment** — a note
to a human reader, not a value. The membership join reads the field, finds
nothing, and correctly excludes them.

### What the filter hides, per section

| section | shown | hidden |
|---|---|---|
| WAITING ON YOU | 10 | 17 |
| **WORKING** | **0** | **2** |
| NOT STARTED | 0 | 5 |
| QUIET | 0 | 6 |
| DONE | 5 | 33 |

63 of 78 rows. Four sections read `none` while the fleet is busy.

### The counter and the rows have different authors

`fleet.ts:5084` computes the control's number server-side:

```ts
{ ...readFleetControls(opts), working: liveAgentCount(entry.agents, entry.pulse) }
```

It counts the **registry**. The rows are filtered **client-side**, in
`AgentList`, after the payload arrives. So the filter cannot reach the counter,
and the counter cannot know a filter exists.

This is the same shape the sprint was named for — *the board tells the truth in
every section* — and it became reachable only once the filter started working.
The old predicate admitted 53 plan rows with empty sprint fields; it was too
loose to expose the mismatch. Wave **Joined** made the filter exact, and the
exactness is what surfaced this.

### Why a running agent is the wrong thing to hide

The other sections answer questions about **work**: what needs me, what is
ready, what is finished. Filtering those by sprint is exactly right — that is
what the control is for.

WORKING answers a different question: **who is doing something right now.** A
worker holds a slot against the parallel-agents cap, occupies a worktree, and
may need rescuing, whatever plan it happens to serve. Hiding it because its plan
sits outside the sprint is how a running agent gets lost — and this repo lost
one that way on 2026-08-24, judged stalled while it was mid-verification.

It is the argument `the-working-section-shows-every-worker` (#398) already made
one level in: a worker rendered only as a property of its branch disappears
whenever its branch has no row. This is the same disappearance through a
different door.

## Design

### WORKING is exempt from the sprint filter

The exemption is by **section**, not by row kind. `filteredRows` already exempts
rows by kind (`release`, plan-less `pr`); this adds a rule one level up: the
WORKING group renders from the unfiltered set.

Stated as the invariant it protects: **a live worker is visible in WORKING under
every filter state.** That is checkable, and it is what a reader relies on when
they open the board to see what their machine is doing.

### Every filtered section says what it withheld

For the sections that stay filtered, `none` must not be the whole answer when
rows exist and were hidden:

```
NOT STARTED   none — 5 hidden by Sprint only
DONE (5)      33 hidden by Sprint only
```

A reader who has forgotten the toggle is on currently sees an empty estate and
no reason for it. The count is the reason.

### The control counts what the reader can see

`N working` must agree with the section beneath it. Two readings, and the
difference matters:

- With WORKING exempt, the count and the section agree automatically — the
  filter no longer reaches either.
- Where a count IS affected by a filter (the per-section counts above), it says
  so rather than silently shrinking.

Never a bare number that a filter has quietly changed.

### Not chosen: make the plans sprint members

The two hidden plans could be added to the sprint file, and the symptom would
go away. It would fix nothing: the next plan outside the sprint reproduces it,
and the mismatch between a server-side count and a client-side filter would
still be there, waiting.

### Not chosen: filter the counter server-side

The server does not know the client's filter state — it is a UI toggle, and
sending it upstream would make a per-viewer preference part of the payload
contract. The fix belongs where the filter already lives.

## Waves

### Exempt (Branch: bug/working-is-exempt-from-the-sprint-filter)

WORKING renders from the unfiltered rows, so a live worker is visible under
every filter state, and the control's count agrees with the section beneath it.

### Counted (Branch: bug/a-filtered-section-says-what-it-hid)

Each filtered section reports how many rows the filter withheld, so `none` is
never the whole answer when rows exist.

## Done when

1. With `Sprint only` ON and a running worker whose plan is not a sprint member,
   the worker's row is **visible in WORKING**.
2. The control's `N working` equals the number of rows rendered in WORKING, in
   both filter states. Asserted for both, because equality in one state is what
   the defect already satisfies.
3. A filtered section with rows hidden says how many. A section with genuinely
   no rows still says `none` — the two must be distinguishable, which is the
   assertion a naive implementation passes without: printing `0 hidden` on an
   empty section reads as a filter effect where there is none.
4. Sections other than WORKING still filter. The fix must not become "the
   filter stopped working" — measured by the counts in the table above.
5. `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:board` green.

## Notes

### Found by looking, not by testing

Reported from a screenshot of the running board, like the seven defects before
it in this sprint. The filter's own tests pass: they assert that membership
decides which rows show, and it does. No test compares a control's number
against the section under it, which is the whole defect.

That comparison is worth having as a rule rather than a case: **any count the
board renders beside a section must be derivable from that section's rows.**

### It appeared because the fix worked

Worth recording plainly. The old filter (`r.sprint === '' || sprintFilter.has(
r.sprint)`) admitted 53 plan rows it should have excluded, so `Sprint only`
barely narrowed anything and the counter agreed with the section by accident.
Wave **Joined** made the join exact; the accident stopped, and the disagreement
surfaced. A fix that reveals a second defect has not caused it.
