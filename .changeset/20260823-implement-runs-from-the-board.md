---
"@plot-pm/board": minor
---

board: Implement runs from an approved plan's row

The **Implement** control on an approved plan's row now acts rather than
refusing. A new `POST /api/implement` route spawns `/plot-implement <slug>`
detached the way `/api/idea` spawns `/plot-idea` and `/api/commission` spawns a
plot agent: slug-scoped, through a new `Implement command` binding, answered 202
immediately because the server is single-threaded and the outcome is read back
from `GET /api/implement/<slug>`.

Unlike `/api/idea`, this composes no prompt file — `/plot-implement` takes a
slug and reads the plan itself — so the slug is `SLUG_RE`-bounded and passed as
one argument, and nothing a page supplies becomes a shell word. The route
refuses with a named reason rather than silently: `no-implement-command` where
no runner is configured (creating the preparation a person does before writing
code runs the `/plot-implement` skill, which no script can do), and the same
cross-origin and malformed-slug refusals `/api/dispatch` gives.

It joins the router's write table, so it inherits the loopback gate by
construction and is covered by the write-gate test; an `implement` capability
flag rides on `/api/board` beside `commission`, kept its own field for the
reason every flag above it is — one flag for two capabilities is how they
diverge. The client's `ImplementButton` reads that flag and posts, replacing the
present-but-refused stub wave 1 left for it.

<!--
bumps:
  skills:
    plot-implement: minor
-->

The `/plot-implement` skill gains the unattended clause its step 2 was missing:
on staleness drift it now **stops and reports** with a `PLOT-UNASKED` line
naming what moved, rather than ending "the user decides" with no defined
behaviour when the board is the one that ran it and nobody is there. Which
re-validation drift needs is a verdict, not a default.

From plan: docs/plans/2026-08-22-an-approved-plan-offers-its-two-starts.md (wave 2)
