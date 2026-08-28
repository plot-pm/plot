---
'@plot-pm/board': patch
---

The board header names the repository it is serving.

`serverInfo()` reported the port and the branch and not the repository — so two
boards on one machine were told apart by neither. Measured 2026-08-28: a board
left running by a test served a one-plan scratch estate on :7777, the usual
port, with a plausible branch. It was read as the real board for two hours, and
the conclusions drawn were *the sprint is empty*, *the board shows nothing* and
finally *we cannot ship the release* — none of them true.

**This is not the branch chip returning.** That one was removed for a good
reason: it answered *which worktree is the server in* while appearing to answer
*where am I*, and two branch names in one header is worse than either alone. A
repository carries no such ambiguity — exactly one is served, and a reader
comparing two tabs is asking precisely which.

The chip shows the basename, because that is the tell a reader needs at a
glance: `plot` against `plot-smoke-0oMvVS` settles it, where two long paths do
not. The full path is the element's `title`.

`repo` is a startup fact the server already holds, so it costs no fork on the
request path — and unlike `branch` it is reported even where git cannot answer,
because a board serving a broken checkout still needs to say which one.
