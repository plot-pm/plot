# The page is as tall as the screen, and it is thirteen pixels taller

> The board's wrapper carries `min-h-screen` and starts 13px down the document,
> so every board scrolls by 13px whatever it contains.

## Status

- **Phase:** Draft
- **Type:** bug
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board no longer scrolls by a fixed 13px on a page whose content fits.

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

### Open Questions

- [ ] What are the 13px? Measured as the wrapper's top offset, not yet attributed
      to a specific element.
- [ ] Does any test currently depend on the 13px overflow? A test asserting the
      page scrolls would pass today for this reason rather than for its own.

## Branches

### Fits

- `bug/the-page-is-as-tall-as-the-screen` — attribute the 13px, give the
  viewport minimum to exactly one element in the chain, and assert
  `scrollHeight <= clientHeight` on a board whose content fits.

## Notes

Found while implementing `bug/a-section-is-not-a-row`, which needed the footer
assertion rewritten before it could be trusted. That rewrite deliberately
measures the **footer** against `window.innerHeight` rather than the document
against a constant, and says in a comment why it does not assert on
`scrollHeight`: doing so would fail that test for this defect, which no collapse
can fix and which moves no content out of reach. This plan is that comment's
other half.
