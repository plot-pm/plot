# A wave row is a wave row everywhere

> WORKING skips plan grouping, which is right, and skips the wave ROW with it,
> which is not. The same wave renders as a wave in one section and as a branch
> in another.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-24, Jan Wloka, in-session
- **Started:** 2026-08-24, Jan Wloka, `bug/a-wave-renders-as-a-wave-in-every-section`
- **Started:** 2026-08-24, Jan Wloka, `bug/the-blocked-mark-finds-a-worker`
- **Delivered:** 2026-08-25
- **Released:** 2026-08-26, 2.9.0

## Changelog

- A wave renders as a wave row in every section. WORKING keeps its agent
  ordering — it stops rendering waves as branches to get it.
- The *blocked by* mark finds a blocker in WORKING, which is the section a
  blocker is most often in.

## Motivation

### One row, two renderings

From the live board 2026-08-24, three waves of three different plans, all
`kind: 'wave'` on the wire:

| section | renders |
|---|---|
| **NOT STARTED** | `WAVE  Counted   feature/the-cap-gates…  blocked ⓘ` under a plan head |
| **WORKING** | `WAVE  bug/a-wave-row-names-its-wave  [Named]  one-wave-row-two-contents` |

Same kind, same payload, two grammars. In WORKING the branch takes slot 1, the
wave's name is demoted to a badge, and the plan link follows — the shape of a
BRANCH row. In NOT STARTED the wave's name leads, as a wave row's does.

### The two decisions are entangled

`waveGroupsFor` is scoped to one section deliberately (`sections.ts:245`):

> *"WORKING holds agents, WAITING ON A MACHINE holds builds, and in neither is
> a wave the thing being decided."*

That argument is **right about grouping and wrong about rendering.** WORKING
answers *who is working*, so it orders by agent and must not bury three unrelated
waves under three plan heads.

But `ungroupedRows` is the complement of `waveGroupsFor` over the same input
(`sections.ts:340`), and everything it returns renders as `<Row>` —
a BRANCH row (`AgentList.tsx:1560`). So one function decides two things:

- **should this section group by plan?** — WORKING: no, correctly
- **should this row render as a wave?** — WORKING: also no, incorrectly

Skipping the group should not skip the row kind.

### The blocked mark cannot find a blocker in WORKING

`Spoken` is blocked by `Named`; `Named` is in WORKING with a live worker.
Clicking its ⓘ does nothing.

`BlockedByMark`'s jump is `[data-wave-list="…"] [data-wave-row="…"]` — a
DESCENDANT selector. `the-blocking-wave-is-found-wherever-it-is` (#383) fixed the
DONE case by *"tagging every section's wrapper"*, but that wrapper exists only on
the plan-grouped path. WORKING has no such wrapper to tag, so the query has
nothing to descend from.

**This is the same root cause.** A wave that rendered as a wave would carry both
attributes, and the jump would work without a second fix. #383's fix could not
reach the section where blockers most often sit — a wave is blocked by the wave
someone is working on right now.

## Design

### Grouping and row kind are separate questions

`waveGroupsFor` keeps its section scope: WORKING and WAITING ON A MACHINE do not
group by plan, and their ordering is unchanged.

What changes is that a row whose `kind` is `wave` renders through the wave row in
every section. The row's identity comes from the ROW, not from whether the
section chose to group it.

An ungrouped wave in WORKING is a wave row **without a plan head above it** —
which is exactly what a wave row already does when its plan head is absent
(`planHeaded` is a prop, not an assumption).

### The columns a wave row holds, in order

The tuple grid already declares seven tracks
(`TUPLE_TRACKS`, `TupleRow.tsx:88`), and both renderings share it. What differs
today is only which facts are put in which slot. A wave row fills them like
this, in every section:

| slot | holds |
|---|---|
| 1 | the activity mark |
| 2 | the kind — **`WAVE`** |
| 3 | the wave icon and **the wave's name** |
| 4 | the branch and plan links, together |
| 5 | the status |
| 6 | the age |
| 7 | the row menu |

Slot 3 is the whole of the defect: in WORKING the branch is there instead, and
the wave's name is demoted to a badge in slot 4's neighbourhood. Slot 4 already
holds *"what the wave contains"* (`tuple-row.ts:1151`) — the branch belongs
there, beside the plan link, not in front of the name.

The order is what makes a row RECOGNISABLE: a reader scanning slot 3 down the
page reads wave names in NOT STARTED and branch names in WORKING, and has to
re-orient at every section boundary. One order, and the eye stops re-learning
the grid.

### What WORKING keeps

The agent facts that make it WORKING: the worker note (`worker running (pid …)`),
the activity dot, the agent ordering. Those live in the row's status slots and
are not the wave's identity.

Per `one-wave-row-two-contents`'s rule — one grammar, different contents — a wave
row in WORKING says the wave's name and the worker's condition. Nothing is lost;
the badge stops being the only place the wave name appears.

### The jump follows for free

A wave row carries `data-wave-row`, and rendering wave rows in WORKING gives the
section a wave list to tag. No change to the query, which is document-wide and
correct.

Should tagging prove awkward where a section has no plan-grouped wrapper, the
alternative is a query that does not require the descendant — but that is a
fallback, not the design: the wrapper is how every other section already works.

## Waves

### Rendered (Branch: bug/a-wave-renders-as-a-wave-in-every-section, PR: #392)
- a row of `kind: 'wave'` renders through the wave row wherever it appears;
  section grouping is untouched

### Found (Branch: bug/the-blocked-mark-finds-a-worker, PR: #396)
- the *blocked by* jump reaches a blocker in WORKING

## Done when

1. **A wave in WORKING fills the slots in the same order as one in NOT
   STARTED**: `WAVE` in slot 2, the wave icon and the wave's name in slot 3, the
   branch and plan links together in slot 4, status, age, menu. Asserted
   slot-by-slot against a NOT STARTED row, not by looking for a string
   somewhere on the line.
1b. **The wave's name is asserted BY NAME** on this repo's estate — `Named`,
   `Anchored`, `Carried` — since a test for *"not the branch name"* passes on an
   empty slot.
2. **WORKING still orders by agent and does not group by plan.** No plan heads
   appear in it. This is the property the section scope exists for and the one a
   naive fix breaks.
3. **The worker facts survive**: `worker running (pid …)`, the activity dot, and
   the agent's own ordering.
4. **WAITING ON A MACHINE is unchanged** — it holds builds, and this plan does
   not make it hold waves.
5. **Clicking ⓘ on a wave blocked by a wave in WORKING scrolls to that wave and
   flashes it.** The `Spoken` → `Named` case, asserted directly.
6. **The DONE case still works** — #383's fix must not regress.
7. `pnpm run test:board` green; artifact rebuilt and committed.

## Notes

### Why #383 could not have caught this

Its fix was *"tag every section's wrapper"*, and it was tested against a blocker
completing into DONE. WORKING has no wrapper to tag because it does not group,
so the fix was complete for every section that groups and empty for the one that
does not. The gap is not in the fix; it is in the assumption that every section
renders waves the same way — which this plan makes true.

### Not chosen: give WORKING a plan-grouped wrapper

Tagging a wrapper without grouping would fix the jump and leave the rows
rendering as branches. It treats the symptom this plan exists to remove, and
`every-section-has-one-subject` already settled that WORKING must not be
organised by plan.
