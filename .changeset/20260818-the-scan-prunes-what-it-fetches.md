---
"@plot-pm/board": patch
---

plot-fleet: the scan prunes what it fetches, so a stale ref stops outranking the host

A branch squash-merged and deleted at merge reported `in progress` for as
long as one local ref nobody pruned still pointed at it. Measured
2026-08-18, minutes after PR #218 merged: the host answered `MERGED`, the
remote had no such branch, no worktree and no claim remained — and
`--list-eligible` returned nothing, so wave 2 could not be dispatched at
all. `git fetch --prune` by hand cleared it and the wave opened
immediately.

`git fetch` does not remove remote-tracking refs for branches deleted
upstream; only `--prune` does, and the scan's fetch did not pass it. So
every branch merged with `--delete-branch` left one behind on every machine
that had fetched it, surviving until an operator pruned for unrelated
reasons — which is what made this look intermittent.

**The stale ref did not add noise; it disabled the check that would have
been right.** `branch_state()` picks its arm on the ref's PRESENCE: with
the ref there the scan takes the ancestry path, which a squash merge breaks
by construction (the squash commit does not contain the branch tip), so the
branch fell to `wip` — and the host lookup that would have answered
`merged` lives in the other arm and was never reached. Under a merge commit
the ancestry test is true anyway, which is why only squash merges expose
it; this repo squash-merges by default.

The fetch at the top of the scan now prunes, on the connection it already
opens. No new host call and no new logic: the stale ref never exists, the
no-ref arm is entered, and the host lookup added in #216 answers.

**The merge lookup did not move.** It is safe only by placement — a branch
someone *recreated* has a ref and takes the ancestry path deliberately, so
hoisting the lookup would report in-flight work as `merged` and open the
next wave onto work still being done. Pruning is safe precisely because it
reorders nothing: it makes the local view match the remote, and the
existing arms then apply as designed.

One detail is load-bearing and easy to get wrong. **The explicit refspec is
required.** `git fetch --prune origin <main>` prunes *nothing* outside
`<main>`: naming a refspec scopes the prune to that refspec's destination
namespace. The obvious fix — a bare `--prune` on the narrow fetch the scan
already made — is therefore a no-op for exactly the branches it exists to
clear, and it looks correct. Restating the default heads refspec alongside
`<main>` widens the prune back to the whole mirror, still in one connection.
A test pins this against git directly, so the refspec is not later read as
redundant and removed.

Nothing depended on a stale ref surviving. `local_ahead_of()` reads
`refs/remotes/origin/<br>..refs/heads/<br>`, and already answers 0 on a
missing ref by exit code rather than by emptiness — the same answer it
gives for every branch living on another machine, so the count degrades to
absent rather than to a wrong number. `local_dirty`, `local_locked` and
`local_worktree` read the worktree rather than the mirror, so uncommitted
work stays visible; conflict prediction is gated to `wip|claimed`, which a
pruned branch is not; and `--prune` removes only remote-tracking refs, so
no local branch or work is touched.

`--offline` is decided and stated rather than left to be discovered: it
skips the fetch, so it cannot prune, and a surviving ref may keep a merged
branch reading `wip` and hold its wave blocked. That is the honest answer
for a scan that asked nothing — but the symptom looks nothing like "you
passed `--offline`", so the footer now says so, and a failed fetch says
that it failed to prune too.

<!--
bumps:
  skills:
    plot-fleet: patch
-->
