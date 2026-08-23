# The row is legible

> Everything the operator reported from screenshots on 2026-08-20 that is about
> **how a row reads**, in one plan. The tuple's *structure* landed in #293 and
> #301; this is what it looks like — spacing, size, colour, indentation, and the
> lines between rows.
>
> Every finding here is reproducible with **`PLOT_BOARD_MOCK=1 pnpm board`** — one
> row per kind, no estate, no scan, no agent.

## Status

- **Phase:** Superseded
- **Type:** bug
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Assignee:** jwloka
- **Superseded:** 2026-08-22 — every wave was delivered by other work; see *Where each wave went*

## Problem

### Why one plan, when the findings are already written down

They are, and that is the problem: eleven waves across five plans, all editing
`AgentList.tsx` and `TupleRow.tsx`. Measured 2026-08-20 — that file took **11
commits in one day** and conflicted on nearly every merge.

The findings that belong together are the ones a reader judges **at the same
time**: whether a row is legible. Size, colour, spacing, indentation and borders
are not independent decisions — a heading that grows changes what spacing reads
as, and an indent changes what a border separates. Landing them one wave at a
time means each is judged against a layout the next one changes.

So this plan takes **only the legibility findings** and leaves the structural ones
where they are:

| stays elsewhere | plan |
|---|---|
| a wave is a kind, with its own row | `a-wave-is-a-thing-not-a-label` |
| an agent is never in the machine section | `every-section-has-one-subject` |
| the plan actions read a null field | `the-plan-actions-read-a-field-that-is-always-null` |
| a release's name is its version | `a-mock-row-shows-what-the-tuple-still-gets-wrong` |

### The findings

**1 — Three hierarchy levels at one type size.** Measured: section heading
`text-xs` (12px) with `mb-1` beneath, plan heading 12px, row text 12px, rows
35–36px apart. The strongest break on the page is drawn with the page's weakest
signal. *(Was `a-section-is-not-a-row`, folded in here.)*

**2 — The fold caret is legible only by hovering for it.** A 12px glyph in a 24px
target. The target was deliberately sized and is right; the glyph was never
revisited.

**3 — The icons mix two character sets.** `🎫 📋 🏷` are emoji: they render in
system colour, **ignore CSS colour**, and bring their own metrics. `⇅ ⚙ ⬡ ⑂` are
symbol characters. That is why three of seven look yellow-orange and larger.

**4 — The icon sits in the activity track, and gives way to it.**
`TupleRow.tsx` SLOT 1 records the compromise: *"where the two compete for this
track, the icon gives way."* Right call, accepted competition. A row with activity
shows no icon.

**5 — Grouping is not indented.** Measured: **zero** `pl-*` or `ml-*` in
`TupleRow.tsx`. Rows that belong to one plan are distinguished only by a heading
above them, so siblings look like neighbours.

**6 — Every row has a `border-t`, and one has a blue ring.** The ring is an
*arrival* mark — *"the same blue the board's highlighted card wears"* — and in the
measured screenshot it framed a **duplicated** row. A uniform border between all
rows cannot express which rows belong together; a ring that means *new* was
reading as *this one is special*.

**7 — Truncation does three different things.** A status truncates to one
character (`o…`), a name truncates mid-word (`bug… h-with-no-pr`), and artifact
links wrap to a second line. Three rules for one problem: a track too narrow for
its content.

## Design

### Size states level, and there are three

| level | today | becomes |
|---|---|---|
| **section** | 12px, `mb-1` | larger, with room beneath |
| **plan / group heading** | 12px | between section and row |
| **row** | 12px | **unchanged — the baseline** |

The row does not move: it is the unit the board is made of, and most of the 82
12px occurrences the caret's comment counts are rows. What changes is that the
things *above* a row stop matching it.

**The caret grows, the target does not.** `h-6 w-6` and `py-1 -my-1` stay exactly
as they are — that reasoning is about the click target and it succeeded. A control
can be easy to hit and hard to read; only the second is being fixed.

### One icon set, one size, one colour

**Inline SVG, sized in the markup, coloured by `currentColor`.** The board already
carries one inline `<svg>`, so nothing new is introduced, and no asset is
fetched — the artifact must stay self-contained.

**Octicon shapes**, because the objects are a git host's objects: the fork for a
branch, the arrow pair for a PR, the circle for an issue. A reader who has used
GitHub reads them without a legend. MIT-licensed, so the paths can be copied in
with attribution.

Larger than the 13px the symbol characters use — the icon is the row's first mark
and currently its faintest.

### The kind is a column; the icon marks the name

| | today | becomes |
|---|---|---|
| first column | the icon | the **kind word** — `PR`, `BRANCH`, `STORY` |
| beside the name | nothing | the **icon**, immediately before the number or link |
| the activity track | icon **and** activity, competing | **activity only** |

A **word** column scans vertically — a reader sorting a section by type reads
words faster than pictures. An **icon** is a mark on a thing and belongs next to
what it marks: `⑂ feature/x`, `⇅ 57`, which is how `⑂240` and `⊙228` already read
elsewhere on this board.

**The activity track is left free, and that is the point.** What it holds later —
a pulse count, a last-changed pip, a spinner while a worker writes — is
deliberately not decided here. What this guarantees is that the space is
available: a track shared with something permanent cannot show a moment.

### Grouping is indentation, and the border follows it

**Indent the group's rows.** Rows belonging to one plan are indented under its
heading, so siblings are recognisable as a set without reading the heading.

**Then the borders can say something.** Today every row has the same `border-t`,
which separates everything equally and therefore groups nothing. With indentation
carrying the grouping, the border between two rows **inside** a group can be
lighter than the border between groups — or absent, letting the indent do the
work alone. Which of the two is a rendered-board decision, and the plan does not
pick it blind.

**The arrival ring keeps its meaning and gets a smaller one.** `ring-2
ring-blue-500 ring-inset` around a whole row reads as *this row is special*
permanently. It marks *new*, which is transient, so it should be as transient in
appearance — the same argument the status panel's flash-then-sort already makes.

### One truncation rule

| content | rule | why |
|---|---|---|
| a **name** | truncate at the **end** | the head identifies it: `bug/a-branch-with…` is findable, `bug… h-with-no-pr` is not |
| a **status** | **never** truncate | it is at most two words; `o…` means the track is wrong, not the text |
| an **artifact link** | truncate at the end, **never wrap** | a wrapping row breaks the vertical scan the sections exist for |

**Row height stays one line for every kind.** A PR wrapping while a branch does
not is the argument for the rule, not an exception to it.

### What must not change

- **Row height and the 12px row text.** #290 states it and a reader's scan
  depends on it.
- **The 24px fold target.** Load-bearing and documented.
- **`space-y-8` between sections.** #290 landed it; size adds to spacing rather
  than replacing it.
- **The tuple's structure.** Seven kinds, six slots, links labelled by
  provenance. This is how it looks, not what it is.
- **Nothing in the contract.** Every finding here is CSS and markup.

### Open Points

- [ ] **Inside a group: lighter border or none?** Indentation may carry the
      grouping alone. Decide from a rendered board with a five-branch wave, not
      from the design.
- [ ] **Two type sizes or three?** A plan heading is *inside* a section and its
      indentation already says so, which may make a third size noise.
- [ ] The AGENT row shows status `open` and age `27m`, where the grammar asks for
      `thinking` and `session 27m · idle 4m`. Measure whether that is the mock's
      fixture or the renderer before filing it.

## Branches

### Sized
- `bug/size-states-the-level` — a section heading and its caret stop being row-sized; the click target and row height are untouched. Tests: a section heading's computed font size exceeds a row's; the caret glyph exceeds a row's text; **the fold target is still at least 24px**; row height is unchanged; `space-y-8` is unchanged; a folded section still folds and `aria-expanded` still flips.

### Marked
- `feature/one-icon-set-one-place` — the seven icons become inline SVG at one size in one colour; the kind word moves to the first column; the icon moves next to the item's name; the activity track holds activity alone. Tests: every kind's icon is an `<svg>`, never an emoji or text glyph; all seven render at the same size; all seven take their colour from `currentColor` and follow the theme; the first column holds the kind word for every kind; the icon is adjacent to the name; **the marks track is empty on a row with no activity**; no asset is fetched; Octicon attribution is present.

### Grouped
- `bug/grouping-is-indentation` — a group's rows are indented under its heading, and the borders express membership rather than separating everything equally; the arrival ring becomes transient. Tests: rows of one plan share an indent that non-members do not have; a group of five is recognisable as a set without reading its heading; the border between two rows inside a group differs from the border between groups; the arrival ring does not persist across pulses; **no row is rendered twice** — the one-wave duplication measured on the mock is gone.

### Fitted
- `bug/one-row-one-truncation-rule` — a name truncates at the end, a status never truncates, an artifact link truncates and never wraps. Tests: a long branch name keeps its head; a status renders whole or not at all — **never one character**; a PR's two artifact links stay on one line; row height is identical across all seven kinds; asserted through the mock payload, so reproducible without an estate.

## Notes

Collected from six screenshots in one evening. The operator's framing throughout
was *what a reader sees*, and that is why these four waves belong together rather
than in the five plans they were scattered across: **each one changes what the
others read as.**

The mock is what made them cheap to find. Before it, a component harness rendered
all seven kinds correctly while the live board showed wave names in the kind slot —
the harness bypassed the payload, the grouping and the sections, which is where
every defect above lives. A fixture that skips the pipeline tests the part that
was not broken.

## Where each wave went

Interrogated 2026-08-22 and found **already true**. No branch of this plan was
ever cut — each finding was delivered by work that reached the same lines from
another direction, and each is now pinned by a passing test:

| wave | delivered by | pinned by |
|---|---|---|
| **Sized** | the section-heading work | `row-withholds.browser.test.ts` — *"draws a section heading larger than the rows it introduces"* and *"…the fold caret larger than a row, without shrinking its target"* |
| **Marked** | the tuple row (#293, #301) | `KIND_ICON_PATH` in `tuple-row.ts` — inline Octicon paths taking size from the markup and colour from `currentColor`, with MIT attribution; slot 2 renders the kind as a visible word |
| **Grouped** | the wave-row work | `ml-6` group indentation, asserted across 4 test files |
| **Fitted** | the tuple row | the truncation rule, asserted across 23 test files |

**The plan was right about the findings and wrong about needing its own
branches.** Its own argument predicted this: it was written *because* eleven
waves across five plans were all editing `AgentList.tsx` and `TupleRow.tsx`, a
file that took 11 commits in one day. Gathering the legibility findings into one
plan was the correct response to that pressure — but the same pressure meant the
branches touching those files landed the findings first.

That is not a failure of the plan. A finding recorded, then delivered by
whoever next opened the file, is the outcome a shared-file plan should expect;
what it prevents is the finding being **lost**, and none of these were.

**One legibility finding is NOT covered here** and has its own plan: an
`eligible` wave takes no status colour, while `statusTone` colours exactly the
values a reader acts on. It arrived after this plan was written and would have
belonged to it.

