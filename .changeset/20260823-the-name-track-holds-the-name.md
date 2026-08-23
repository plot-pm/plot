---
'@plot-pm/board': patch
---

board: the name track holds the name

Slot 3 of the tuple grid — the row's own NAME — was a fixed `12rem` while slot 4
(the artifact links) took `1fr`. On a plan-group head slot 4 is empty, so the
flexible track absorbed the width the name needed and a plan slug past ~20
characters clipped while the row sat half empty. 80% of this repo's own plan
slugs exceed that width, so the clip was the normal case rather than the tail.

Slot 3 is now `minmax(12rem, auto)`: the 12rem floor keeps a narrow viewport
unchanged, and the `auto` ceiling lets a long name claim the room slot 4 is not
using. The name's own span still carries `truncate`, so the fix is *clip when
needed* — the ellipsis returns exactly when the text genuinely exceeds the space,
proven in a real browser by comparing `scrollWidth` against `clientWidth`, not by
counting characters against yesterday.

The breakpoint arithmetic is unchanged: `minmax` keeps the floor at 12rem, so the
grid still needs 508 / 604 px before the flexible track gets a pixel, with 36 px
of headroom under the 640 px `sm` breakpoint. The guard test's three assertions
were re-expressed against the `minmax` shape — the track-equality list, the
"exactly one track absorbs the slack" predicate (now naming `1fr` directly), and
the `fixedPx` floor derivation — so each still tests what it was written to test.

**Overridden 2026-08-23:** each row is its own CSS grid, so `auto` sizes to that
row's content and column edges no longer line up between a plan head and a branch
row beneath it. That was the property `agent-rows-line-up` established, and the
operator deliberately gave it up so the name renders in full: a reader who cannot
read the name loses more than one whose columns do not align. The marks track
(slot 1) still aligns; only slots 3+ move.
