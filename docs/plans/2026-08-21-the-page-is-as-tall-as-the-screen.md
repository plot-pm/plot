# The page is as tall as the screen, and it is thirteen pixels taller

> The board's wrapper carries `min-h-screen` and starts 13px down the document,
> so every board scrolls by 13px whatever it contains.

## Status

- **Phase:** Delivered
- **Type:** bug
- **Sprint:** the-board-serves-an-enterprise-stack
- **Story:** plot-board
- **Review:** pr
- **Impl:** none
- **Rounds:** 1
- **Delivered:** 2026-08-26

## Changelog

- **No change shipped: the defect does not exist.** Measured 2026-08-26, the
  board's wrapper starts at the document origin and a page whose content fits
  scrolls by exactly zero. The 13px was the board's own content at a viewport
  too short to hold it.

<!-- Board impact: board-only. No plan-format field, helper script or
     docs/plans layout is involved — this is one CSS class on the page wrapper. -->

## Motivation

Measured 2026-08-21 on macOS at 1280x800, while rewriting the footer assertion
in `agents-tab.browser.test.ts`:

    document.scrollHeight  813
    document.clientHeight  800
    footer bottom          797
    wrapper bottom         813   DIV.mx-auto min-h-screen max-w-[1600px] px-4

The footer's own position is platform-dependent and is not what this plan is
about — at that viewport it is inside the fold on macOS and 1.3px outside it on
CI's Linux. The **wrapper** is outside on both, by 13px.

`min-h-screen` is `min-height: 100vh` — a full viewport's worth of height —
applied to an element that does not start at the top of the document. It starts
13px down, so it ends 13px past the fold by construction: on every board, at
every viewport, regardless of how many rows are in it and regardless of which
platform renders it. That last part is what separates it from everything else
measured that day.

Nobody reported this, and that is itself informative: 13px of scroll on a page
whose content already fits reads as a slightly loose page rather than as a
defect. It surfaced only because a test asked the document its height instead of
asking one element for its position.

**It was also hiding behind a test that could not see it.** The footer
assertion compared a document coordinate against a hard-coded `800`, and passed
at 797 while the document ran to 813 — green for the wrong reason, on a page
that genuinely scrolled.

That test has since been rewritten to measure the footer against
`window.innerHeight` at a 900px viewport, which is what makes this plan's
finding visible and separable. Two distinct facts were tangled in the old
number: the footer's own position, which depends on content and on ~4px of
font-metric spread between macOS and CI's Linux, and this 13px, which depends on
neither. At 900px the footer clears the fold on both platforms by ~100px — and
the document still scrolls by 13px, because that overflow has nothing to do with
the content or the viewport. It is the wrapper's own geometry.

## Design

### Approach

Find what the 13px above the wrapper is — a header, a tab strip, a margin — and
make the wrapper's minimum height account for it instead of assuming it owns the
whole viewport. The likely shapes:

- `min-h-screen` → `min-h-0` on the wrapper, with the *outermost* element
  carrying the viewport minimum, so only one element in the chain claims 100vh.
- A flex column on the page root with the wrapper as `flex-1`, which asks the
  layout for "the rest of the screen" rather than for "a screen's worth".
- `min-h-[calc(100vh-13px)]`, which is the wrong answer written down: it hard-codes
  a measurement that will drift the moment the header above it changes.

The first two are real candidates; the third is listed to be refused.

### What must stay true

- The board still fills the viewport when it has few rows — `min-h-screen` is
  there so a nearly-empty board does not leave the footer floating mid-screen.
  A fix that deletes the minimum trades this defect for that one.
- `docs/definition-of-done.md` gates the board artifact; the fix is CSS in
  `packages/board/src/app`, so `pnpm build:board` must be run and the artifact
  committed.

### Open Questions — both answered, and the premise did not survive

- [x] **What are the 13px?** There are none. Measured 2026-08-26 against the
      running board with Playwright: `wrapperTop = 0` on both tabs and at every
      viewport tried. The wrapper starts at the document origin, `min-height`
      resolves to exactly the viewport, `box-sizing: border-box` keeps `py-4`
      inside it, and `body`/`html` carry `margin: 0`.
- [x] **Does any test depend on the overflow?** Moot — there is no overflow to
      depend on.

### The measurement that closes this plan

```
viewport 1280x900 :  scroll=1719  client=900   OVERFLOW=819   wrapper 0..1718.7
viewport 1280x1800:  scroll=1800  client=1800  OVERFLOW=0     wrapper 0..1800
viewport 1280x2400:  scroll=2400  client=2400  OVERFLOW=0     wrapper 0..2400
```

**Zero overflow at every viewport whose content fits.** The 819px at 900 is the
board's own rows, not geometry: give the page room and it stops scrolling
entirely. That is precisely the behaviour this plan asked for, and it is already
the behaviour.

`#root` renders `App` directly and `App`'s first element IS the wrapper, so
there is nothing above it to offset it — the shape the plan went looking for
does not exist in the tree.

### Why the original reading was not wrong, only differently caused

The 2026-08-21 measurement (`scrollHeight 813` against `clientHeight 800` at
1280x800) was real. What it was not is the wrapper's geometry, because the
wrapper's top was 0 then as now unless something has since moved it.

The likeliest explanation is the one the plan itself brushes past: **at 1280x800
the board's content already overflowed**, and 13px was simply how much. Today at
that viewport the same board overflows by 737px — the content grew, the constant
did not. A fixed 13px "on every board, at every viewport, regardless of how many
rows" is the claim the new measurement contradicts most directly: the number
moves with the rows.

Two lessons worth keeping, since both are cheap and both were skipped:

- **Attribute a measured offset before designing against it.** The plan reasoned
  carefully from *the wrapper starts 13px down* and never checked that it does.
- **A page that scrolls by 13px and a page that scrolls by 819px are the same
  page with different content.** Only a viewport tall enough to hold the content
  can tell geometry from rows apart, and the original measurement had none.

## Waves


### Fits (Branch: bug/the-page-is-as-tall-as-the-screen) <!-- deferred: premise falsified 2026-08-26 — no 13px exists; nothing to build -->
- Retired unbuilt. The wave asked to attribute the 13px and remove it; the
  attribution found there is no offset to remove, so there is no change to make.

## Notes

Found while implementing `bug/a-section-is-not-a-row`, which needed the footer
assertion rewritten before it could be trusted. That rewrite deliberately
measures the **footer** against `window.innerHeight` rather than the document
against a constant, and says in a comment why it does not assert on
`scrollHeight`: doing so would fail that test for this defect, which no collapse
can fix and which moves no content out of reach. This plan is that comment's
other half.

### Closed 2026-08-26 as not-a-defect

Interrogated once, and the round ended the plan rather than sharpening it.

The plan's argument was careful and its premise was untested: *the wrapper
starts 13px down the document*. It starts at 0. With `min-height` resolving to
the viewport, `border-box` keeping `py-4` inside it, and `margin: 0` on
`html`/`body`, there is no construction by which the page exceeds the fold — and
the measurement agrees at every viewport tall enough to test it.

**Kept as a record rather than deleted**, because the reasoning is worth having
next to its refutation: a defect argued from a number nobody attributed, closed
by the one check that would have prevented it. The plan cost less to disprove
than the fix would have cost to write.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {
      "q": "What are the 13px?",
      "a": "There are none — wrapperTop is 0 and overflow is 0 at any viewport that fits the content; the original reading was content, not geometry",
      "category": "technical"
    },
    {
      "q": "How should a plan whose premise is falsified be closed?",
      "a": "Delivered as not-a-defect, wave retired deferred, record kept for the lesson",
      "category": "tradeOffs"
    }
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": { "stack": false, "architecture": true, "implementation": true },
    "domain": false,
    "ux": { "happyPath": true, "edgeCases": true, "errors": false, "accessibility": false },
    "nonFunctional": { "security": false, "performance": false, "scalability": false },
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
