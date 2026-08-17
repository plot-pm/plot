---
"@plot-pm/board": minor
---

A stuck branch now says so in its row, names which of the four states it is in, carries the evidence, and — for the two the pulse cannot fix — offers its action on the row with an animated cue.

**The facts reached the row and stopped.** The previous wave landed the detection and put `stuck` on `AgentRow`; measured on `main`, `AgentList.tsx` rendered zero occurrences of it. Closing that gap is the whole of this change.

**Four states, four words.** *Stuck* as one label would be the one-label-many-states defect this board keeps removing: `artifact conflict`, `conflict`, `CI failed` and `unpushed work` differ in the only way that matters, which is what a person does next. `artifact-conflict` and `conflict` in particular are not degrees of one thing — the first has a resolution a rebuild and a CI no-diff gate can prove without anyone reading a diff, and the second does not.

**Evidence travels with the state, always.** A row that says *stuck* and makes the reader go find out why has moved the ten minutes of log-reading rather than removed it. A conflict prints its conflicting paths, unpushed work prints its commit count, and a failing check prints three lines — the failing step, the branch's changed paths, and the branch's own recent run history:

```
CI failed — step: Install Playwright browser
this branch changes docs/plans/a.md
recent runs: failure at 10:19, success at 10:17
```

Nothing compares those runs and nothing classifies the failure. A heuristic mapping failing steps to changed paths was rejected: that table is unmaintained by construction and goes silently wrong the first time a workflow is restructured (Principle 3). An empty evidence field says *unavailable* rather than vanishing — `runHistory: []` is *this host has no run listing*, never *this branch has never failed before*.

**The action goes on the row, not in the three-dot menu**, and that is measured rather than preferred: `RowActions` hides its action behind a menu that only opens if something inside could act, so a row with a waiting action looks identical to a row with none until you click it. A cue nobody finds is not a cue.

**The cue animates, and this is the one place on this board where motion is right.** A neighbouring wave settled the opposite for the activity mark — *a thing true for hours has less claim on motion than a thing true for three seconds* — and a stuck branch is neither: it is true **until someone acts**, and the acting is the point. Motion here marks an unanswered request, not a state.

It is bounded so it cannot become wallpaper:

- **Only where an action is offered.** `unpushed` is reported in words — the fix is a push, and pushing someone else's judgement is not ours to make. `artifact-conflict` offers nothing in this wave; the repair is a separate one.
- **It stops when the action is TAKEN**, not when the branch unsticks. The request has been answered; whether the answer worked is what the row's other marks report.
- **`motion-reduce` keeps the cue and stops the animation.** Both halves — hiding the element would take the marker along with the movement.
- **Never motion alone and never colour alone.** The action carries a word, the reason reaches the accessible name, and the cue is `aria-hidden`.
- **A healthy row carries no cue.** A cue on every row makes the stuck ones invisible.

**Over a non-localhost binding the cue shows and the action refuses, naming the reason.** `/api/dispatch` is localhost-only — *whoever reaches localhost:7777 is sitting at the machine that owns the worktrees* — so over Tailscale the board is a reading surface. The information is true everywhere, so hiding the cue would let a phone report a healthy fleet while branches sit stuck: a worse lie than an action you cannot take from where you are.

**A stuck branch keeps its group**, and a row with `stuck: null` renders exactly as before. No row moves, no section is added, and the common case costs nothing.

**No write path was added and no route was widened.** The conflict action dispatches through the existing guarded `/api/dispatch`, with `plot-dispatch.sh` deciding everything it already decides. There is no rerun route on this server, so a failing check offers a **link to the failing run** rather than a rerun — navigation to where the rerun button already lives, on the host. `[data-live-dot]`, `[data-change-mark]` and `[data-activity-mark]` are untouched: four marks, four meanings, and no mark implemented by modifying another.

<!--
bumps:
  skills: {}
-->
