# The filter does not hide a worker

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- not a member of the-board-tells-the-truth-in-every-section -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Started:** <!-- YYYY-MM-DD, who, `branch` -->
- **Delivered:** <!-- YYYY-MM-DD -->
- **Released:** <!-- YYYY-MM-DD, version -->

## Changelog

Every count the board renders beside a section is derivable from that
section's rows, and a section that hides rows says how many. A control and the
section under it cannot disagree about the same fleet.

## Motivation

### The measurement

Taken from `/api/fleet` with `Sprint only` ON, 2026-08-25:

```
WORKING   2 working        ← the control
WORKING   none             ← the section
```

Both describe the same fleet, in the same viewport, one line apart.

### What this plan first got wrong

The first draft blamed the sprint filter and proposed exempting WORKING from
it. That diagnosis was wrong, and the correction is the useful part.

The two hidden rows belong to plans that are **not** sprint members — the plan
files say so (`Sprint:` empty, with `<!-- not a member of … -->` as an HTML
comment, which is a note to a reader and not a value) and the sprint file
contains zero occurrences of them. So the filter hid exactly what it was asked
to hide, and exempting WORKING would have papered over an estate problem with a
UI rule.

**Two separate things were tangled together:**

1. *Those plans should be sprint members.* True, and it is bookkeeping — the
   plans get added to the sprint file. Not this plan's subject.
2. *A control and its section can disagree.* Also true, and it does not depend
   on those plans at all. That is this plan's subject.

Fixing (1) makes today's symptom disappear while leaving (2) in place, waiting
for the next filtered row. That is why (2) is worth its own plan.

### The defect, stated without reference to the sprint

`fleet.ts:5084` computes the control's number on the server:

```ts
{ ...readFleetControls(opts), working: liveAgentCount(entry.agents, entry.pulse) }
```

`liveAgentCount` (`auto-dispatch.ts:129`) counts registry entries in a live
state whose branch has not landed. It consults **no filter** — correctly, since
the same function feeds the auto-dispatch cap, and a cap that shrank when a
reader toggled a UI control would be a much worse bug than this one.

The rows, meanwhile, are filtered **client-side** in `AgentList` after the
payload arrives. So the count and the rows have different authors, and any
filter that removes a row makes them disagree. `Sprint only` is simply the
first filter exact enough to demonstrate it.

### Why the number must not be filtered instead

`N working` is genuinely about the machine: it says how many slots of the
parallel-agents cap are in use. That is true whatever a reader has chosen to
look at, and it is what makes the stepper meaningful.

So the fix is not to filter the count. It is to stop rendering a bare number
beside a section that contradicts it — the number keeps its meaning and gains
the context that resolves the apparent contradiction.

### The rule this is an instance of

**Any count the board renders beside a section must be derivable from that
section's rows, or must say what else it counts.**

No test asserts this today, which is why seven of this sprint's defects arrived
as screenshots rather than CI failures. The rule is checkable and general; the
`2 working / none` pair is just where it first became visible.

## Design

### The control says what its number covers

`N working` stays a registry count — unfiltered, unchanged, still the cap's
input. When a filter is hiding live workers, the control says so:

```
10 parallel agents · 2 working (2 hidden by filter)
```

The number no longer contradicts the section, because it now names the gap
itself.

### A filtered section says what it withheld

`none` must not be the whole answer when rows exist and were hidden:

```
NOT STARTED   none — 5 hidden by Sprint only
DONE (5)      33 hidden by Sprint only
```

A reader who has forgotten the toggle is on currently sees an empty estate and
no reason for it.

### Not chosen: exempt WORKING from the filter

The first draft's proposal. It fixes the symptom for one section and leaves the
rule broken everywhere else — NOT STARTED and QUIET read `none` in the same
screenshot, for the same reason, and neither would be helped.

### Not chosen: filter `liveAgentCount`

It feeds the auto-dispatch cap. A cap that moved when a reader toggled a UI
control would let auto-dispatch start work it should have refused — a real
defect traded for a cosmetic one.

## Waves

### Named (Branch: bug/the-working-count-names-what-it-counts, PR: #413)

The fleet control reports how many live workers the current filter is hiding, so
its number and the section beneath it stop contradicting each other.

### Counted (Branch: bug/a-filtered-section-says-what-it-hid)

Each filtered section reports how many rows the filter withheld, so `none` is
never the whole answer when rows exist.

## Done when

1. With a filter hiding live workers, the control names the gap — its number and
   the rows beneath it no longer contradict each other. Asserted with a worker
   hidden AND with none hidden, because agreement in the unfiltered state is
   what today's defect already satisfies.
2. `liveAgentCount` is **unchanged**, and a test pins that the auto-dispatch cap
   sees the same number whatever the UI filter is set to. This is the assertion
   a naive implementation fails: filtering the count makes item 1 pass and
   silently lets auto-dispatch start work over its cap.
3. A filtered section with rows hidden says how many. A section with genuinely
   no rows still says `none` — the two must stay distinguishable, so printing
   `0 hidden` on an empty section fails.
4. Every section still filters. The fix must not become *the filter stopped
   working*: with `Sprint only` ON the shown/hidden split stays as measured
   (WAITING ON YOU 10/17, WORKING 0/2, NOT STARTED 0/5, QUIET 0/6, DONE 5/33)
   for an estate where those plans are non-members.
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
