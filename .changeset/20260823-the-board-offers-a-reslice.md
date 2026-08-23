---
"@plot-pm/board": minor
---

The board can now reslice a tangled wave from the `unsliced-wave` row. A new
`POST /api/reslice` route spawns `/plot-reslice` the way `/api/idea` spawns
`/plot-idea` and `/api/commission` spawns a plot agent: slug-scoped, through the
`Idea command` binding, with the prompt written to a file so no plan text
becomes a shell word. It writes none of the slice itself — `/plot-reslice` reads
the branches, proposes an order, and asks a person before rewriting
`## Branches`, which is the standing rule for board writes.

The route refuses with a named reason rather than silently: `no-idea-command`
where no runner is configured, `plan-unreadable` where the plan's waves cannot
be parsed, and `nothing-to-slice` where no wave holds more than one live branch
(a `complete` wave whose work has landed is history the reslice must not touch).
The sliceability precondition is read through `plot-plan-meta.sh`'s `waves[]` —
the one parser that owns the format — counting only non-deferred branches, the
same arithmetic the `unsliced-wave` detector applies.

It joins the router's write table, so it inherits the loopback gate by
construction and is covered by the write-gate test; a sixth `reslice` capability
flag rides on `/api/board` beside `commission`, kept its own field for the
reason every flag above it is — one flag for two capabilities is how they
diverge. `GET /api/reslice/<slug>` reads the command's own words back for a
refusal, since a reslice that asks before writing may move no row.
