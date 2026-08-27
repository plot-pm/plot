---
'@plot-pm/board': patch
---

The board reports how far its own checkout sits behind the ref it reads plans
from, and says nothing at all where there is nothing to report.

A DIAGNOSTIC RATHER THAN A FIX, and the distinction is worth stating because
this change's own plan was written before it was true. The board now reads its
plan estate from `origin/<default>`, so a stale checkout can no longer produce a
wrong badge or a wrong Deliver refusal — that defect is fixed upstream of this
number. What remained is that the drift was INVISIBLE: the board's worktree
moved 16 commits in about an hour on 2026-08-27, and twice that day an operator
met a wrong render with nothing on screen to explain it. This is the sentence
that would have made those diagnoses immediate rather than hour-long.

Three states, two of which are silent:

- **Behind by N** renders `· checkout N behind` beside the ref, in amber.
- **Level with the ref** renders NOTHING. A current checkout is the normal
  state, and an indicator that is almost always green teaches a reader to stop
  reading it — which is exactly how the next 16-commit drift would go unnoticed.
  The signal has to be the exception, the same rule the `not pushed` count
  beside it already follows at zero.
- **Cannot say** renders nothing either, and is NOT the same answer as zero. A
  detached HEAD parked at the ref's tip answers `git rev-list --count
  HEAD..origin/main` with `0`, indistinguishable from a genuinely current
  branch, so the count alone can never be trusted. `measureBehind` establishes
  that HEAD is a branch at all before it measures — establish that the question
  is answerable, then answer it. Absent is not false.

The distance is measured against the local mirror the fleet scan already
fetched on its own timer, so no network call joins the request path — pinned by
the existing no-network test rather than left to convention. It is therefore a
lower bound on the true drift, which is the right trade: a lower bound above
zero is the entire signal, and the exact answer would cost host latency on a
5 s poll.

The board reports; it never pulls. A `git pull` here would mutate a worktree a
human may be editing and would restart the server under `node --watch`, failing
exactly when someone is using it.
