---
'plot': minor
---

An agent takes the desk it already holds and works the next slice in it, instead
of creating a worktree per branch and abandoning the one it left.

Measured 2026-09-02 on this estate: 2 manifests, 11 worktrees, 8 loop processes,
5 desks whose branch had already merged. An identity issued once per agent was
being issued once per slice, and `plot-reap.sh` — a backstop carrying five
refusals — was the only actor that ever removed one.

**The agent decides, because it is the only party that can see its own tree.**
The registry sees identities and the machine sees processes; neither sees an
uncommitted change, a `PLOT-BLOCKED` marker, or a checkout holding unpushed
commits. So the decision is made at the desk, from three measurements
`plot-worker-state.sh` already owns — reused rather than reimplemented, because
two implementations would drift and then disagree about one desk while only one
of them acts.

**The reset checks out `origin/<main>` before the slice's branch, and that order
is the deliverable.** `.gitignore` is per-checkout: a worktree sees an ignore
entry only once the branch it holds carries it. That stranded 19 desks on
2026-09-02, every one held back by a single untracked artifact the ignore list
had gained after the desk was cut. One extra checkout buys a desk whose state is
independent of whatever it held before, and a test fails on the reverse.

**No `reset --hard` and no `clean -fdx`.** Those destroy whatever the guard
failed to notice, and the guard being wrong is exactly the case where the
destruction cannot be undone. A guard that misjudges leaves a desk the sweep
reports, not deleted work — a leftover desk costs a sweep, lost work costs the
work. Every checkout is plain, so a file the guard missed makes git refuse and
the loop cuts a new desk instead.

**A rejected claim push stops being routine.** The line read *"another worker won
the race"* and removed the worktree in silence. The registry is the assignment
lock and the push is only its backstop, so a rejection means two agents were
handed one branch — the estate is already broken at the moment it fires. It is
now logged as a registry-lock violation. The retry stays; the silence does not.

`git worktree add` becomes the exception: a full checkout is paid once per agent
rather than once per slice.

<!--
bumps:
  skills:
    plot: minor
-->
