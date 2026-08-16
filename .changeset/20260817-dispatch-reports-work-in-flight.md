---
"plot": minor
---

`plot-dispatch` now reports what work is already in flight before it fans out.

Waves are a within-plan ordering, so a correctly eligible branch can still name
a file an agent has open on a different plan's branch — nothing in the wave
model represents that. Each candidate line is now followed by what is held:

```
would dispatch feature/agent-view-phase-ui → …
  in flight: bug/board-shows-staleness holds App.tsx, AgentList.tsx
```

Measured from **local refs and worktrees**, not the remote: the collision that
blocked a dispatch on 2026-08-16 lived in an unpushed commit, and uncommitted
work is invisible to refs entirely. That is sound rather than a violation of
refs-as-truth, because dispatch is inherently machine-specific — it creates the
worktrees here.

Each branch is compared against **its own merge-base**, so a rebased branch does
not report every commit it picked up from main as its own work. The generated
`board-server.mjs` is excluded: every board branch rebuilds it, so including it
would make every board pair look like a collision.

It **reports and refuses nothing** — nothing on the candidate side is predicted,
so there is no prediction worth acting on. `git merge-tree` cannot help at this
moment (dispatch creates the candidate branch, so it is identical to main and
the comparison is clean for every candidate, forever), and a `Touches:`
self-declaration would fire on nearly every board pair because the real scope
guards nest inside one another.

<!--
bumps:
  skills:
    plot: minor
-->
