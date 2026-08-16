---
"plot": minor
---

`/plot-dispatch` now records a `Started:` entry when it fans out, so a
dispatched plan reads as started.

`/plot-implement` has always written that record; dispatch never got the
equivalent, so a fanned-out plan sat in Design badged *Ready* while agents
edited its branches — the board's two tabs disagreeing by construction, because
the card reads the plan file while the Agents tab reads git refs.

The record is written **on the default branch**, through a disposable
`plot/start-<slug>` branch pushed with `plot-push-main.sh`. That is the whole
difficulty: `plot-dispatch.sh` finds the plan in its local working tree on
whatever branch the dispatcher is standing on, while the board reads the plan
from the default branch. Appending to the local file would book the start where
the board never looks.

One line per branch the run newly claimed, written **after** the claim push
succeeds — a `Started:` record for a branch another dispatcher won would be a
lie in the file. A re-run adopts existing worktrees and books nothing it did
not newly claim.

**A failed booking never unwinds a fan-out.** Offline, refused, or beaten to
the ref: by then the worktrees exist and the claims are pushed, and those are
the real state. The script reports that the record is missing and carries on.
`--dry-run` writes no branch, no commit and no push.

<!--
bumps:
  skills:
    plot-dispatch: minor
-->
