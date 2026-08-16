---
"plot": minor
---

A story is now an artefact you can open from the board.

**Stories were the board's axis and its dead end.** A plan card names its story as a badge, the swimlane view uses stories as row headers — and neither led anywhere. `StoryCardSchema` carried `slug`, `title` and `status` and **no path**, and the server had a `/plan/<file>` route but no `/story/`. The one concept that spans months, the thing plans belong to, was the only artefact the board could not open.

**Both viewer routes share ONE hardened resolver, rather than the second copying the first.** `/plan/` defends against two attacks and only the first is obvious. Traversal is handled structurally: a name resolves against the documents the board itself collected, never joined into a path — which matters more for a story than for a plan, since a story slug is a directory name *and* part of the filename (`<slug>/STORY-<slug>.md`), so a `../` has two positions to land in. The second attack is one line: `decodeURIComponent` **throws** a `URIError` on a malformed `%` escape (`/story/%E0%A4%A`), and an uncaught throw inside the request listener takes the single-process server down. A `/story/` route written from scratch would very plausibly get the allowlist right and that wrong, and one malformed URL would then kill the board. So the decode, the try/catch, the 400-vs-404, the CSP and the `?embed=1` handling are one code path; the routes differ only in which allowlist they consult, and that difference is a two-line table. The malformed-escape case is asserted for both routes **in one test**, because a test that checked each alone would still pass the day someone forked the handler.

**`StoryCardSchema` gains the resolved path**, for the same reason `planFile` exists on a fleet row: the consumer must not reconstruct it, because stripping and rebuilding a path is where the mistakes live. **A story with no file gets an empty path and renders no link** — the rule plan rows already follow for `planFile: ''`. The card keeps its title and status, which are true regardless; hiding it would lose real information to avoid a broken link, when not linking suffices.

**The plan modal gains an `Open story` button, and the badge becomes a link.** Both, not either — they answer different questions. The badge is where the story is *named*, on the card, at triage time; the button is where you *go*, in the modal, once you have stopped triaging. That is the same split the worktree path already makes. An earlier draft had only the badge, which satisfies "a story can be opened" while leaving the action invisible to anyone scanning the header for something to do — so the button is asserted as a `<button>`, not merely as reachable. It appears only when the story resolves to a file, rather than offering an action that 404s.

The badge no longer jumps to the story's swimlane row. A badge that sometimes opens a document and sometimes moves the page teaches a reader nothing about which it will do; the name refers to an artefact, so it points at the artefact. The `Story lanes` toggle still reaches every lane, and the story overlay's own *Show in board* lands on the row when lanes are on.

**The swimlane row header opens its story too** — the lane view is the other place a story is named and led nowhere. Both surfaces follow the same rule: a header naming a story with no file (the orphan and catch-all rows) stays plain text.

**The overlay's header mirrors the plan modal's exactly** — *Show in board*, *Open in new tab*, *Close*. Three, not two. Symmetry matters more than novelty: a reader who has learned the plan modal should not have to learn a second set of controls. They are the same component, which makes "they match" a fact rather than a promise — and the test asserts it by **comparing the two headers** rather than listing three names in both places, since a listing would still pass the day one modal grew a fourth control.

**The body is the story's own.** The header answers *where do I go*; the body answers *what now*, and a story has no worktree. What belongs there is the thing the story card cannot say: **which plans make it up, and what phase each is in** — derived from the board's own cards, which already carry `story` and `phase`, rather than parsed from the STORY file's hand-maintained "Current Plan" prose. Hand-maintained is precisely the problem: nothing marks an item resolved when its plan lands, and four of twelve open points in one story were stale when swept. A derived list cannot drift. Asserted against a fixture whose hand-written section names a plan that does not exist and omits both that do — the derived list must win, and the stale prose is confirmed present in the rendered document below it, so the assertion is a disagreement rather than an absence.

**Opening a story from an open plan modal replaces it, and does not stack.** An overlay above an overlay gives two Close buttons and an ambiguous Escape, for the sake of keeping context the header already names. Replacement is predictable, and the way back is the same click in reverse — a plan opened from the story overlay replaces it in turn.

<!--
bumps:
  skills:
    plot: minor
-->
