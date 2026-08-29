---
"@plot-pm/board": patch
---

Assert the rewritten story link, not the broken relative one.

`d23c03a0` taught the plan viewer to rewrite relative story and plan links to
board routes, because `../stories/raised-beds/STORY-raised-beds.md` resolves
against `/plan/<file>` rather than the docs tree and is therefore dead in a
browser. It changed the renderer and rebuilt the artifact, but touched no test —
and the `tiny-garden` plan-viewer test was still asserting the un-rewritten
path, so it became an assertion that the bug was still present. main went red at
that commit and stayed red; the release PR inherited the failure.

The assertion now checks both halves — the board route arrives AND the relative
path is gone. Neither alone is discriminating: the route by itself would pass on
a renderer that emitted it for every link, and the absence by itself would pass
on one that dropped the link. Mutation-tested by making `rewritePlanLinks` a
no-op, which turns the test red.
