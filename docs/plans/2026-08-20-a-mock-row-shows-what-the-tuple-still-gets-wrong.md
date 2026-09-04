# A mock row shows what the tuple still gets wrong

> `PLOT_BOARD_MOCK=1 pnpm board` renders one row per kind. Six defects were
> visible in the first screenshot of it, none of which needed a real estate, a
> scan, or a running agent to reproduce.
>
> The tuple structure works: seven kinds, each with its own icon, the kind at the
> left, the name as a link, `PLAN`/`BRANCH` prefixes on the artifact links, status
> and age at the right. What follows is what it gets wrong.

## Status

- **Phase:** Released
- **Type:** bug
- **Sprint:** the-board-tells-the-truth-in-every-section
- **Story:** plot-board
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Assignee:** jwloka
- **Started:** 2026-08-23, Jan Wloka, `bug/the-wave-leaves-the-kind-alone`
- **Started:** 2026-08-23, Jan Wloka, `bug/the-wave-leaves-the-kind-alone`
- **Started:** 2026-08-23, Jan Wloka, `bug/a-release-is-its-version`
- **Started:** 2026-08-23, Jan Wloka, `bug/the-wave-leaves-the-kind-alone`
- **Delivered:** 2026-08-24
- **Released:** 2026-08-26, 2.9.0

## Approval

- **Assignee:** Jan Wloka

## Changelog

- `PLOT_BOARD_MOCK` renders one row of every kind, so the board's rendering can be exercised without a real estate, a fleet, or a git host.

## Problem

### Why a mock, and why it earns its keep immediately

Measured 2026-08-20: every kind rendered correctly in a **component harness**
while the live board showed wave names in the kind slot. The harness was right
and useless — it proved the component works and said nothing about what the board
renders, because the board renders from a payload.

So the mock is an `AgentRow[]` validated by the same `FleetSchema` a real pulse
is, travelling the same route through the same grouping into the same sections. It
**replaces** the payload rather than merging into one: a mock beside real rows is
indistinguishable from a real estate behaving oddly, and the first confused
reading would cost more than the aid saves.

`PLOT_BOARD_MOCK=1` is an env var rather than a flag because this server parses no
arguments at all — `PLOT_BOARD_REPAIR` and `PLOT_BOARD_ALLOW_REMOTE_WRITES` are
how it is already configured, and it is on for an exact `1` only.

### The six defects

| # | kind | observed | wanted |
|---|---|---|---|
| 1 | STORY | status renders **`o…`** — one character of `open` | the whole word, or nothing |
| 2 | BRANCH | name renders **`bug… h-with-no-pr`** — cut mid-word | truncated at the end, so the head is readable |
| 3 | BRANCH, AGENT, PLAN | a **wave name** (`Shaped`, `Inverted`) sits beside the item name | the wave belongs to the branch, not next to the kind |
| 4 | RELEASE | **240 twice** — as the item name and again as `⑂240` in the status | once |
| 5 | PR | its two artifact links **wrap to a second line** while other kinds do not | one row is one line, or every kind wraps |
| 6 | STORY | its artifact link has **no `PLAN` prefix** where every other kind's does | the same prefix, or a stated reason for none |

**Three of these are the same defect at different widths.** 1, 2 and 5 are all
the row deciding what to drop when a track is too narrow, and each drops
differently: the status truncates to one character, the name truncates in the
middle, and the links wrap. A row of seven tracks needs one rule for that, not
three.

### Why 3 is the one that matters most

`Shaped` and `Inverted` beside `PR`/`BRANCH`/`AGENT` is the four-meanings column
in its last form. The tuple was supposed to end it: slot 2 holds the kind, and the
wave moves beside the **branch name**, where `a-branch-row-names-its-wave` (#275)
put it.

Measured on the mock page: **8 `data-tuple-kind-label`** and **3 `data-wave`**,
both rendered. So the wave did not move — it was joined. A reader scanning that
column sees `PR`, `BRANCH`, `Shaped`, `RELEASE`, `Inverted` and cannot tell which
words name a kind.

## Design

### One truncation rule for the whole row

A track too narrow for its content does one of three things today. It should do
one thing, and which one depends on what the content **is**:

| content | rule | why |
|---|---|---|
| a **name** (branch, plan, PR title) | truncate at the **end**, with the head kept | the head is what identifies it; `bug/a-branch-with…` is findable, `bug… h-with-no-pr` is not |
| a **status** | never truncate — it is at most two words | `o…` is worse than a wider track; if it does not fit, the track is wrong |
| an **artifact link** | truncate at the end, and never wrap | a wrapping row breaks the scan the sections exist for |

**Row height stays one line.** #290 established it and a reader's scan depends on
it; a PR wrapping to two lines while a branch does not is the strongest argument
for the rule rather than an exception to it.

### The wave leaves the kind's neighbourhood

The wave renders **beside the branch name** and nowhere else — its position from
#275, unchanged. What goes is the second placement, next to the kind slot, which
was never intended and is what the tuple was meant to remove.

A plan row has no branch, so it has no wave to show; its phase is stated in the
plan heading, which is where `PlanRow` already put it.

### A release is its version, and its PR is an artifact link

Two defects on one row, and they break the tuple's two rules at once.

**The name is wrong.** A release's item name must be its **version** — `2.7.0` —
because that is what a reader decides about; the PR is how it gets there. The code
already says so at `tuple-row.ts:345`: *"The version is the thing a reader is
deciding about — is 2.7.0 ready — and the PR is how it gets there."*

But `releaseVersion` cannot find one:

    export function releaseVersion(row: AgentRow): string {
      return /^\d+\.\d+\.\d+/.test(row.plan) ? row.plan : '';
    }

It reads `row.plan`, and **a release row has no plan** — measured, empty. So the
fallback to the PR number fires every time, and the version never appears.

Where the version actually is:

| source | value |
|---|---|
| the PR **title** | `release: 2.7.0` |
| `package.json` | `2.6.0` — the version being *released from*, not the one being cut |
| the branch | `changeset-release/main` — no version at all |

**The PR title is the only source that names the version being cut**, and
`PrSchema` carries no `title` — measured, zero occurrences. So this needs a
contract field before the renderer can be right, and `package.json` is the wrong
source: it holds the *current* version, and a release row is about the *next* one.

**And `⑂240` is in the status column, where no link belongs.** That is the second
rule: **artifact links have their own slot**, and a release has more than one — its
**PR** and its **branch** — exactly as a PR row has its plan and its branch. Both
belong in slot 4 with `PR` and `BRANCH` prefixes, and the status column says
`no checks` and nothing else.

The tuple already establishes the shape (*"a PR row carries three — the PR, its
plan, its branch"*); the release row is the kind that did not follow it.

### A ticket's artifact link is labelled like every other

`STORY` links its plan without the `PLAN` prefix the other kinds carry. Either the
prefix is universal or its absence is stated; the plan picks universal, because a
reader learning `PLAN`/`BRANCH` as the vocabulary should not find one kind
speaking a different one.

### The icons become one set, one size, one colour

Settled 2026-08-20, and the measurement explains what the operator saw:

    ticket 🎫   plan 📋   release 🏷      ← EMOJI
    pr ⇅        build ⚙   agent ⬡   branch ⑂   ← symbol characters

**Emoji render in system colour and ignore CSS.** That is why three of seven look
yellow-orange and four look grey — not a styling omission, a property of the
glyph. Emoji are also drawn to their own metrics, so the row's leading track
changes width by kind.

One set fixes both: **inline SVG, sized in the markup, coloured by
`currentColor`.** The board already carries one inline `<svg>`, so nothing new is
introduced, and no asset is fetched — the artifact must stay self-contained.

**Borrow shapes people already know.** Octicons are the right vocabulary here
because the objects are GitHub's objects: the fork for a branch, the arrow pair
for a PR, the circle for an issue. A reader who has used a git host reads them
without a legend, and a legend is what the kind label is for anyway. Licence:
Octicons are MIT — the paths can be copied in with attribution, which is what
keeping the artifact self-contained requires.

**Bigger and uniform**, both stated because they were asked for: one size for
every kind, and larger than the 13px the symbol characters use — the icon is the
row's first mark and currently the faintest.

### The Type moves to the first column, the icon to the name

The operator's layout, and it separates two jobs the current row conflates:

| | today | becomes |
|---|---|---|
| first column | the **icon** | the **kind** — `PR`, `BRANCH`, `STORY` |
| beside the name | nothing | the **icon**, immediately before the number or link |

The reason is what each is for. The **kind word** is a column: a reader scans it
vertically to sort a section by type, and a column of words scans faster than a
column of pictures. The **icon** is a mark on the thing: it belongs next to what
it marks — `⑂ feature/x`, `⇅ 57` — the way a git host puts it.

This is also how PR and issue already read elsewhere on this board: `⑂240`,
`⊙228` — glyph immediately before the number, one unit. The tuple put the icon in
a track of its own and lost that adjacency.

**The activity track is left free, and that is the point of the move.**
`TupleRow.tsx` (SLOT 1) records the conflict it was built to survive:

> *"where the two compete for this track, **the icon gives way**: a row's activity
> is NOW … and the icon is constant."*

That decision is right — activity beats a constant — but it accepted the
competition rather than removing it. Moving the icon next to the name removes it:
the marks track holds **only** activity, the "icon gives way" rule disappears
because nothing is left to give way to, and the track becomes available for what
activity information actually needs.

**What that track may hold later is deliberately not decided here.** A pulse
count, a last-changed pip, a spinner while a worker writes — all plausible, all
requiring their own measurement. What this branch guarantees is that the space is
**free**: no icon, no kind, nothing constant. A track shared with something
permanent is a track that cannot show a moment.

### What must not change

- **The tuple structure.** Seven kinds, six slots, kind at the left, links
  labelled. It works and the mock proves it.
- **The mock's replace-not-merge rule.** A mock that merged into a real payload
  would be a source of confusion worse than the defects it finds.
- **`PLOT_BOARD_MOCK` requires an exact `1`.** The write gate's rule, for the
  same reason: an opt-in must be typed knowingly.
- **Section membership.** Nothing here moves a row between sections.

### Open Points

- [ ] Should the mock be reachable from the UI — a *demo* toggle — rather than an
      env var? Argued no for now: a toggle in a board serving a real estate is a
      way to confuse a real reader, and the env var is set by whoever starts the
      server. Worth revisiting if the mock becomes the way UI work is reviewed.
- [ ] The AGENT row shows status `open` and age `27m`, where the grammar asks for
      `thinking` and `session 27m · idle 4m`. Is that a mock defect (my fixture
      says `worker: running` and no status) or a renderer defect? Measure before
      filing — the mock is new and may simply be wrong here.

## Slices

> **Two branches were removed from this section on 2026-08-20** — the truncation
> rule and the one-icon-set work; their names are deliberately left UNBACKTICKED
> below, because `plot-plan-meta.sh` collects every backticked name in this
> section and a note explaining a removal would re-declare exactly what it
> removed. (Measured: it did, and the collision survived the edit.)
>
> They were bug/one-row-one-truncation-rule and
> feature/one-icon-set-one-place. Both
> were also declared by `the-row-is-legible`, which was written later to
> consolidate the legibility work and carries the same specifications in nearly
> the same words.
>
> A branch named by two plans is a **double claim**: `plot-dispatch` would hand an
> agent one of two briefs with no way to choose which. The board now reports it as
> a `double-claimed` stuck state — and it was the board that found this one, by
> flashing. Two rows for one branch shared a `rowKey` (`repo/branch`, no plan), so
> each pulse one overwrote the other's remembered wave and lit the change mark for
> hours on a branch nobody had touched.
>
> `the-row-is-legible` keeps them.

### Sized
<!-- deferred: 2026-08-24 — never cut as a branch. Defects 1, 2 and 5 (the row
     deciding what to drop when a track is too narrow) were addressed by
     `the-name-track-holds-the-name`, delivered 2026-08-23, which changed slot 3
     to `minmax(12rem, auto)` and let the name use the room it has. This wave's
     "one rule, not three" framing did not survive that: the alignment
     requirement it assumed was explicitly withdrawn by the operator when
     Chromium showed it self-contradictory. -->

### Placed
- `bug/the-wave-leaves-the-kind-alone` → #346 — the wave renders beside the branch name only, and never beside the kind slot. Tests: a branch row's wave is adjacent to its branch name; **no `data-wave` element sits in the kind's track**; a plan row shows no wave; the kind slot's column contains only kind labels, asserted by reading every cell in it.

### Marked
<!-- deferred: 2026-08-24 — never cut as a branch. Defect 6 (a STORY artifact
     link carrying no `PLAN` prefix) is not reproducible on main: the prefix is
     rendered for every kind that carries an artifact link. Absorbed by the
     tuple work rather than fixed here. -->

### Named
- `bug/a-release-is-its-version` → #352 — a release's name is the version being cut, read from the PR title through a new contract field; its PR and its branch are **artifact links in slot 4**, never in the status column; a ticket's artifact link carries the same prefix every other kind's does. Tests: `PrSchema` carries the PR title and the row passes it through; a release row's name is `2.7.0`, not `240`; **the status column of a release contains no link** — asserted by looking for anchors in that cell, not by matching text; the PR and the branch both appear as labelled artifact links; a release whose PR title names no version falls back to the PR number **and says so**, rather than showing a number that reads like a version; a ticket's artifact link renders a `PLAN` prefix; every kind with an artifact link labels it.

## Notes

The mock was the operator's idea — *"Kannst sie nicht als MockDaten ins Board
rendern. Vielleicht starten wir das Board mit --mock-data oder so"* — after a
component harness produced a screenshot that looked right while the board looked
wrong.

That gap is the finding worth keeping. I had rendered all seven kinds in a
harness, reported that they worked, and been wrong about what the operator would
see: the harness bypassed the payload, the grouping and the sections, which is
where the defects live. **A fixture that skips the pipeline tests the part that
was not broken.**

One more thing the mock settled, and it cost two screenshots to find: a stale
browser tab. The kind labels and icons were absent for the operator and present
for a headless run of the same server in the same second — an old JS bundle held
by a tab that had survived several restarts. The board says *"No contact with the
board server for 20 polls"* when that happens, which was on screen and which I
read as a server problem rather than a client one.
