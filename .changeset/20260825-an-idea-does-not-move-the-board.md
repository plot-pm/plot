---
'@plot-pm/board': patch
---

An idea gets its own worktree, and the header follows a checkout

**The board served a branch nobody chose.** `/plot-idea` runs `git checkout -b
idea/<slug>` (SKILL.md:250), and `/api/idea` spawned it with `cwd: repoRoot` —
the board's own checkout. That checkout is therefore the one that moved.

Measured 2026-08-25: clicking *Create plan* on issue #333 left the board's
worktree on `idea/the-pr-list-join-is-silently` with **no worktree anywhere on
`main`**. A WORKING row then inherited that branch's PR and offered *Review* for
a PR the agent had never opened.

The route now adds a detached worktree beside the checkout and spawns there. It
refuses rather than falling back to `repoRoot`, because falling back is the
defect. Where `repoRoot` is not a git repository at all — every unit test here
builds a plain directory — there is no checkout to displace and spawning in
place is correct, not a fallback. Where there is no remote, the new tree starts
at `HEAD` rather than an invalid `origin/<base>`.

The other spawning routes keep `repoRoot` and are right to: approve, deliver and
reslice edit plan files and move no checkout.

**And the header went on saying `main` for the process's whole life.**
`currentBranch` memoised on the reasoning that *"a process serves exactly one
worktree"* — true, but that worktree can change BRANCH. It is now cached for
five seconds: the per-request `git` fork this file was written to avoid stays
avoided, and a checkout shows up before a reader concludes the board is broken.

That was the worst field to get stuck: the release checklist tells a reader to
trust the header when a row looks stale, so the display kept as ground truth was
the one that had gone wrong.

The new test asserts the board's checkout does not move, by making the spawned
command itself run `git checkout -b`. Asserting only that a worktree exists
passes with the defect still present — verified by mutation.
