# The name track holds the name

> The plan slug clips at 12rem while the branch beside it renders 45 characters in full — the row's most identifying value gets its narrowest track.

## Status

- **Phase:** Approved
- **Type:** bug
- **Sprint:** <!-- optional, filled when plan is added to a sprint -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Started:** 2026-08-23, Jan Wloka, `bug/the-name-track-holds-the-name`

## Approval

- **Assignee:** Jan Wloka

## Changelog

- Plan and issue names on the Agents tab now use the width the row actually has, instead of clipping at a fixed 12rem while the branch column absorbs the slack.

<!-- Board impact: board-only. Touches packages/board/src/app/components/TupleRow.tsx
     (the TUPLE_TRACKS constant) and its guard test. No plan-format, helper-script
     or docs/plans-layout change. Rebuild the artifact (pnpm build:board). -->

## Motivation

Measured on this repo's own board, 2026-08-22, at ultra-wide width:

- `feature/the-sections-carry-the-fleet-controls` (44 chars) renders **in full**.
- `bug/an-eligible-wave-takes-the-actionable-tone` (45 chars) renders **in full**.
- `approval-hands-the-wo…`, `a-wave-is-a-thing-not-…`, `the-page-is-as-tall-as-t…` **clip at ~20**.

Both values sit on the same row. The branch is in the flexible `1fr` track; the
plan name is in the fixed `12rem`. Widening the window does not help, because the
free width goes to a track that has already fit its content.

**80% of this repo's plan slugs (75 of 94) exceed the visible width**, so this is
the normal case rather than the tail.

### What is NOT claimed here

The clip does not currently make two plans unreadable as one another. Measured:
at an 18-character clip there are exactly two colliding pairs
(`the-repair-exists-but-nothing-calls-it` / `the-repair-exists-report`, and
`working-rows-show-motion` / `working-rows-show-their-pace`); at 19 characters
and above there are **none**. `a-wave-is-a-thing-not-…` and `a-wave-is-one-bra…`
look like twins at a glance but do differ in their visible text.

This is stated because the tempting argument — *the same duplicate-rows failure
`splitBranch` exists to prevent* — is **not supported by the data**, and a plan
that overstates its evidence gets a fix aimed at the wrong property. The defect
is that a reader cannot read the name, not that two names are identical.

### Two problems, not one

They present as the same symptom — *a name is abbreviated* — and they have
different causes, so a fix for either leaves the other standing.

**Problem A — the track is too narrow.** Slot 3 is a fixed `12rem` while slot 4
takes `1fr`. On a plan-group head slot 4 is empty, so the flexible track absorbs
width the name needed. Widening the window does not help.

**Problem B — an item row clips even when the row has space.** Slot 3's name is
rendered with Tailwind's `truncate`
(`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) inside a
`min-w-0` flex box. `truncate` is unconditional: it ellipsises whenever the BOX
is narrower than the text, and the box is sized by the track, never by the space
the row actually has. So a row with visible empty space still abbreviates.

**Why A alone is not enough.** Widening the track moves the threshold at which B
appears; it does not remove B. A 40-character name fits a wider track and a
50-character one still clips with the row half empty. The fix has to address the
box being decided independently of the available width, which is B.

**Why B alone is not enough.** Even a name allowed to use its full box is capped
by a 12rem box on a plan head whose slot 4 is empty. That is A.

## Design

### Approach

The tracks today, in `TupleRow.tsx`:

```
1.5rem  4.5rem  12rem   1fr     8rem     4.5rem   1.25rem
marks   kind    name    links   status   age      menu
                ↑ fixed         ↑ takes all slack
```

`1fr` was given to slot 4 on the reasoning that it is the zero-or-more slot (a PR
carries two artifact links, a branch none), so it is the track that varies. That
reasoning is sound for a **branch** row and wrong for a **PLAN** row, where slot 4
holds nothing at all and the row's identity lives entirely in slot 3.

**The change: give slot 3 a floor and let it grow, keeping exactly one flexible
track.** The guard test asserts that precisely one track is flexible, and that
constraint should survive — it is what keeps column edges aligned between rows.

The shape to implement:

```
1.5rem  4.5rem  minmax(12rem, auto)  1fr  8rem  4.5rem  1.25rem
```

`minmax(12rem, auto)` keeps today's width as the floor — nothing gets narrower —
while letting a long name claim space that slot 4 is not using. **That is
problem A only.**

### And the clip itself — problem B

`truncate` on slot 3's name decides to ellipsise from the BOX, and the box comes
from the track. Giving the track room is necessary and not sufficient: the name
must also be allowed to use the room.

The change is that slot 3 stops being `shrink-0`-adjacent dead weight and the
name is permitted to occupy the track it has. Concretely, the name's own span is
what carries `truncate`, so it clips at *its* width — and its width is the
track's only because nothing lets it grow. Once slot 3 is `minmax(12rem, auto)`
the span grows with it, and the ellipsis appears only where the text genuinely
exceeds the space.

**Verify this empirically rather than by reasoning about CSS.** The assertion
that separates a real fix from a threshold shift: render a name long enough to
clip at the OLD track width, on a viewport wide enough that the row has visible
free space, and assert the rendered text equals the full name — not merely that
it is longer than before. A test that asserts "more characters than yesterday"
passes a fix that only moved the threshold, which is exactly the weaker
implementation this plan must not ship.

### The two alternatives, and why they are not chosen

- **Widen `12rem` to a larger fixed value.** Simplest, and it is what
  `status-column-earns-its-width` did for the status track. Rejected because it
  helps every row equally whether or not the name needs it, and it spends the
  breakpoint headroom unconditionally (see the arithmetic below).
- **Middle-elide the plan slug with `splitBranch`.** Rejected: the measurement
  above shows plan slugs do not collide at the rendered width, so this solves a
  problem the data does not show, and it would make every name harder to scan in
  exchange.

### The arithmetic this must not break

`TUPLE_TRACKS` has a documented constraint with a test that derives it: the fixed
tracks total 508px and the grid needs **604px** before the flexible track gets a
pixel, against the 640px `sm` breakpoint — 36px of headroom. The docstring
already records overstating that margin once by failing to count a gap.

`minmax(12rem, auto)` keeps the *floor* at 12rem, so the 604px figure is
unchanged. **The guard test must still pass unmodified.** If it does not, the
change is wrong — do not edit the test to fit the change.

### Open Questions

- [ ] Does `minmax(12rem, auto)` satisfy the existing "exactly one flexible
      track" assertion, which filters on `/^[\d.]+rem$/`? If the assertion reads
      `minmax(...)` as flexible, decide deliberately: either the assertion means
      "one track takes the slack" (and needs a more precise predicate) or it
      means "one non-rem token" (and this shape is disallowed). Resolve by
      reading the assertion's intent, not by relaxing it to pass.
- [ ] Should the ISSUE row's title get the same treatment? `228: Fleet scan asks
      th…` clips in the same track. Likely yes and for the same reason — confirm
      it is the same track before assuming it.

## Done when

- **A (the track):** a plan-group head with a ~40-character slug renders in full
  on a wide viewport, asserted in a browser test at a stated width.
- **B (the clip):** an ITEM row whose name would have clipped at the old track
  width renders that name **in full** when the row has free space — asserted as
  string equality against the whole name, never as "longer than before".
- A name genuinely wider than the space available still ellipsises. The fix is
  *clip when needed*, not *never clip*; a test that removes truncation entirely
  would pass while breaking every narrow viewport.
- The 604px/640px arithmetic test passes **unmodified**.
- Exactly one track absorbs the slack — column edges still line up between a
  plan row and a branch row beneath it (the property `agent-rows-line-up` paid
  for).
- A narrow viewport is unchanged: the name track is never below 12rem.
- `pnpm build:board` run and the artifact committed; `pnpm run test:board` green.

## Branches

### Widened

<!-- ONE wave and one branch deliberately, though the plan carries two problems.
     A and B are the same three lines of one component and share one guard test;
     splitting them would put two agents in `TupleRow.tsx`'s slot 3 at once, and
     the second would rebase onto a moved track. The `Done when` list keeps them
     separately assertable, which is what the split would have bought. -->

- `bug/the-name-track-holds-the-name` — give slot 3 a floor-and-grow track (A) and let the name use the room it has (B); keep exactly one flexible track and leave the breakpoint arithmetic test unmodified → #340

## Notes

### Overridden 2026-08-23

Two decisions this plan settled were deliberately overridden by the operator on
2026-08-23, after a worker measured the settled mechanism in Chromium and found
it self-contradictory (`minmax(12rem, auto)` renders the full name but breaks the
per-row column alignment the plan also required, because each row is its own CSS
grid so `auto` sizes to that row's content).

- **Slot 3 ships `minmax(12rem, auto)` as planned.**
- **The `agent-rows-line-up` alignment requirement is WITHDRAWN.** Column edges
  no longer line up between a plan head and a branch row beneath it. That
  misalignment is the accepted cost of rendering the name in full; a reader who
  cannot read the name loses more than one whose columns do not align. (The marks
  track, slot 1, still lines up — only slots 3+ move.)
- **The guard test was edited** — not weakened. The track-equality assertion, the
  flexible-track predicate, and the `fixedPx` floor derivation were each
  re-expressed so they still test the same property against the `minmax` shape.
  The 508 / 604 / 36 arithmetic is unchanged because the floor stays 12rem.

Found from a board screenshot at ultra-wide width, where the empty space beside a
clipped name made the fixed track visible. The first reading of the defect — "we
keep abbreviating the plan's name" — is right about the symptom; the cause is
which track was given `1fr`, decided when slot 4's variability was the property in
view.

Precedent: `status-column-earns-its-width` (Released) changed this same grid by one
number and recorded the alternatives it rejected. This plan follows that form.
