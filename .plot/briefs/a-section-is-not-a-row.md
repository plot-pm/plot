# Brief — bug/a-section-is-not-a-row

The only wave of `docs/plans/2026-08-20-a-section-is-not-a-row.md`. Read the plan;
this brief names the sites and the one trap.

## What to do

A section heading and its fold caret stop being row-sized. **Row height and the
click target do not change.**

Measured, all in `AgentList.tsx` (line numbers will have moved — find by content):

| element | class today | rendered |
|---|---|---|
| section `<h2>` | `text-xs`, `mb-1` | 12px, 4px below |
| plan heading inside a section | same scale | 12px |
| row text | `text-xs` | **12px — the baseline, unchanged** |
| fold caret glyph | `text-xs` in `h-6 w-6` | 12px glyph, 24px target |
| row-to-row spacing | — | 35–36px |

Three hierarchy levels at one size. The section is the strongest break on the page
and is drawn at the size of the weakest thing on it.

## The trap: a comment defends the caret, and it is right

Near the heading's fold button you will find:

> *"it was a 10px caret, the outlier size on a board that uses 12px 82 times.
> `py-1 -my-1` makes the whole heading line a 24px-tall target without moving it
> — the label is part of the button already, so the target was never as small as
> the caret, **but the caret is what a reader aims at**."*

**Do not undo this.** It is about the **click target** and it succeeded: 24px is
right. The defect is about **seeing** the glyph, which is a different property — a
control can be easy to hit and hard to read. So the glyph grows; `h-6 w-6` and
`py-1 -my-1` stay exactly as they are.

The same comment invokes consistency — *"a board that uses 12px 82 times"*. That
argument is for consistency **within** a level; across levels it is what erases
them. Most of those 82 are rows, and rows keep their size.

## Scope

- The section `<h2>`: a larger type size, and room beneath it.
- The section fold caret glyph: larger. Target untouched.
- The plan-heading caret: see the open point — it sits at a different level, so if
  size expresses level it differs here too. Two sizes, not one decision.

## Out of scope

- **Row height.** `bug/the-row-shows-what-it-withholds` states it explicitly and a
  reader's scan depends on it.
- **`space-y-8`** — the section separation that branch landed. This adds to it:
  spacing separated the sections, size distinguishes them.
- **Anything in the contract.** This is CSS.
- **The row's own 12px.** It is the unit the board is made of.

## Tests the plan requires

- a section heading's computed font size is **larger than a row's**
- the caret glyph is larger than a row's text
- **the fold target is still at least 24px tall**
- row height is unchanged from before
- the `space-y-8` section separation is unchanged
- a folded section still folds, and `aria-expanded` still flips

The third is the one that keeps the comment's work: assert the target, not just
the glyph.

## Judgement that is yours

The exact steps — which Tailwind sizes, whether the plan heading gets its own —
are a rendering decision and belong to whoever looks at a screen. The open point
in the plan asks whether two sizes read better than three; decide from a rendered
board, not from the design.

## While you work

`AgentList.tsx` is being rewritten in parallel by
`bug/one-component-renders-every-row` — roughly 1200 lines deleted, 10 commits so
far. The `h2` and the caret are in the section-rendering region, near the end of
the file, and that region is **inside** what is being rewritten.

- **Push your first real commit as soon as it exists.**
- **After that branch merges, rebase and re-find your sites by content**, not by
  line number.
- If your change no longer applies because the section renderer moved, that is a
  discovery to report, not to improvise around.

Run the touched test files rather than the full suite; the suite is ~8 minutes and
CI runs it anyway.
