---
"@plot-pm/board": patch
---

plot: the reaper the scan already assumed exists

`plot-reconcile-scan.sh:323` has referred to "the reaper" since it was written —
*"with a `deferred:` annotation the reaper would offer to DELETE real work"* —
describing a component that did not exist. The scan reported; nothing reaped.

Measured on this estate 2026-08-25: **56 worktrees, 42 of them dispatch trees,
of which 29 were finished** and 32 held pid files for processes that had exited.

`plot-reap.sh` removes a dispatch worktree whose work has landed, and nothing
else. It is a script rather than an agent for the reason
`plot-resolve-artifact.sh` states for the one other automatic write: every
refusal is a MEASUREMENT, not a judgement — is a process alive, is the tree
dirty, did the host merge the PR. An agent asked *is this safe to delete?* can
reason its way past any of the three; a script cannot, and judgement's absence
is what licenses the delete.

Five refusals, in the order they run:

1. a live worker process — a desk somebody is sitting at
2. uncommitted changes — work that exists in exactly one place
3. a `PLOT-BLOCKED*` marker — a worker stopped to ask a person something
4. a branch on the default branch — its dispatched branch is not checked out,
   so its state was never measured
5. no merged PR — the host is the authority on landed

**It reads `mergedAt`, never `state`.** A merged PR reports `state: CLOSED`, and
squash-merge rewrites the commits so the branch stays "ahead of main" forever.
Ancestry alone clears 1 of 29 finished trees here; the host clears the other 28.
That gap is why they accumulated — the naive test says *keep*.

Default is `--dry-run`; removal needs `--yes`. Branches and refs are untouched,
so a reaped tree is re-creatable with `git worktree add` — the destructive act
is bounded to disk and never to history.
