# A section is not a row

> Measured on the live board 2026-08-20: a section heading is `text-xs` — **the
> same 12px as the rows inside it** — with `mb-1` (4px) beneath, while rows sit
> 35–36px apart. `DONE (71)`, the plan heading `a-blocked-wave-is-not-eligible (3)`
> and the row label `Endgame` are three levels of hierarchy at one size.
>
> And the fold caret is a 12px glyph in a 24px target. The target is right and was
> deliberately made so; the **glyph** was never revisited.

## Status

- **Phase:** Released
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Approved:** 2026-08-20 by jwloka (in-session) — reported from a screenshot; the sizes are measured and the caret comment defends the click target, which this does not touch
- **Delivered:** 2026-08-22, jwloka, PRs #302
- **Released:** 2026-08-22, v2.7.0
- **Started:** 2026-08-20, Jan Wloka, `bug/a-section-is-not-a-row`

## Problem

Reported by the operator reading the Agents tab: *"Expand / collapse icons still
too small. Section headers still too little room and too small."*

### The sizes, measured

| element | class | rendered |
|---|---|---|
| section heading `<h2>` | `text-xs`, `mb-1` | **12px**, 4px below |
| plan heading inside a section | same scale | 12px |
| row text | `text-xs` | **12px** |
| fold caret glyph | `text-xs` inside `h-6 w-6` | **12px** in a 24px target |
| row-to-row spacing | — | 35–36px |

**Three hierarchy levels at one type size.** A section is the strongest break on
the page and is drawn at the same size as the weakest thing on it.

### This is the second half of a finding already half-fixed

`bug/the-row-shows-what-it-withholds` (#290) measured exactly this shape for
*spacing*: 16px between sections against 35px between rows, and concluded *"the
strongest structural break on the page was drawn with the page's weakest
signal."* It fixed the spacing — sections now sit in a container at `space-y-8`.

It did not touch **type size**, so the heading is still the same size as a row.
The fix was correct and incomplete: it separated the sections and left them
looking like their contents.

### The caret comment is right about the wrong thing

`AgentList.tsx:5988` defends the caret and is worth quoting, because the fix must
not undo it:

> *"it was a 10px caret, the outlier size on a board that uses 12px 82 times.
> `py-1 -my-1` makes the whole heading line a 24px-tall target without moving it
> — the label is part of the button already, so the target was never as small as
> the caret, **but the caret is what a reader aims at**."*

That reasoning is about the **click target**, and it succeeded: 24px is a fine
target. The operator's complaint is about **seeing** the glyph, which is a
separate property the comment does not address. A control can be easy to hit and
hard to read.

**And the consistency rule it invokes is what prevents hierarchy.** *"A board that
uses 12px 82 times"* is an argument for sameness, and sameness is exactly why
three levels read as one. Consistency within a level is right; consistency
*across* levels erases them.

## Design

### Size expresses level, and there are three

| level | today | becomes |
|---|---|---|
| **section** — `WAITING ON YOU`, `DONE` | 12px, `mb-1` | larger, and given room beneath it |
| **plan heading** — a group inside a section | 12px | between the two, or unchanged if the section is clearly above it |
| **row** | 12px | **unchanged — this is the baseline** |

**The row does not move.** It is the unit the board is made of, 12px is right for
it, and the 82 occurrences the comment counts are mostly rows. What changes is
that the things *above* a row stop matching it.

The exact steps are a rendering decision and belong to whoever looks at it on a
screen. What the branch must satisfy is that **a reader can tell a section from a
plan from a row without reading the words** — the same test the tuple's slot 2
answers for kinds.

### The caret grows, the target does not

The glyph goes up; `h-6 w-6` and `py-1 -my-1` stay exactly as they are. The
comment's reasoning is preserved because it is about the target, and the target
is not what changes.

Two sizes, and they are not the same decision: the **section** caret and the
**plan-heading** caret sit at different levels, so if size expresses level, they
differ here too.

### What must not change

- **The 24px click target.** `py-1 -my-1` and `h-6 w-6` are load-bearing and
  documented; this plan makes the glyph inside them bigger, not the target.
- **Row height.** #290 states it explicitly and the reader's scan depends on it.
- **The `space-y-8` section container** #290 landed. This adds to it rather than
  replacing it: spacing separated the sections, size distinguishes them.
- **Nothing in the contract.** This is CSS.

### Open Points

- [ ] Does the plan heading need its own size, or is section-then-row enough?
      Three sizes for three levels is the tidy answer; two may read better,
      because a plan heading is *inside* a section and its indentation already
      says so. Decide from a rendered board.

## Branches

### Sized
- `bug/a-section-is-not-a-row` — the section heading and its fold caret stop being row-sized; the click target and the row height are untouched. Tests: a section heading's computed font size is larger than a row's; the caret glyph is larger than a row's text; **the fold target is still at least 24px tall**; row height is unchanged from before; the `space-y-8` section separation is unchanged; a folded section still folds and its `aria-expanded` still flips. (#302) → #302

## Notes

Found by the operator on the same screenshot that produced two other findings:
that `WAITING ON YOU` renders every kind identically — which is true, and is
`bug/one-component-renders-every-row`'s job, since `TupleRow.tsx` landed in #293
with **zero call sites** and is wired up only by that wave — and that the
`exit 143` on the tuple row was a worker I had killed, shown from a stale pulse.

Worth separating because they look like one complaint and are three: one is
unbuilt work (the tuple wiring), one was a stale render, and this one is a defect
in code that shipped and was measured wrong.
