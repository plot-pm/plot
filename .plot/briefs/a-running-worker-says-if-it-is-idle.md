## Implementation brief — a-state-is-a-word-not-a-sentence (wave Marked)

- **Plan (canonical):** `docs/plans/2026-08-25-a-state-is-a-word-not-a-sentence.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `feature/a-running-worker-says-if-it-is-idle` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. Wave `Worded` merged as #421 — `agentStateStatus` now returns
`running` for a running agent.

### What to build

A running worker's row says whether its agent is actually doing work — as a
**secondary cue, not a sixth state**.

`running` is honest and coarse. Measured across the fleet 2026-08-25, it covered
at least three conditions, and 11 of 13 workers were in the worst of them: an
agent that had crashed hours earlier while the loop waited on it.

### The discriminator is the CHILD's CPU, not the shell's

This is the decision the plan settles, and getting it wrong makes a cue that
never fires:

```
shell pid 75455    cpu 0:00.01   elapsed 09:54:42     ← parked, ALWAYS
its claude child   cpu 1:06.77   elapsed 09:54:42     ← thinking
```

**The loop shell is near-zero CPU in every case** — it waits on its child. An
implementation reading the shell's own CPU distinguishes nothing. Across the
fleet: 9 of 11 shells at 0.01s, each with a live child holding 1.5+ minutes.

The dead case looks like this — same shape, but the child's CPU does not move:

```
child 75757   elapsed 10:07:04   cpu 1:07.19 → 1:07.19 over a 2s sample   state S
```

So the signal is **CPU growth of the child over an interval**, not an absolute
number and not the shell.

### The decisions the plan settles — do not re-derive them

**`plot-worker-state.sh` owns this.** It is the ONE answer to *is a worker
running in this worktree?* — sourced by both `plot-dispatch.sh` and
`plot-fleet-scan.sh` — and it already answers eight states including `waiting`
and `stalled`. The board renders what the script reports; do not build a second
liveness implementation in TypeScript.

**A cue, not a state.** `AgentStateSchema` stays **five** members and its size is
pinned by a test. `isLiveState` (a denylist) and `isBrokenState` (an allowlist)
are untouched — a sixth state would be live-by-default and broken-never, which
may be right but needs its own argument. An idle worker with a live child **is**
running; promoting a temporary condition to a peer of `stalled` overstates it.

**Do not use this to kill anything.** Ending a hung worker is
`a-hung-child-does-not-hold-the-loop`, a separate approved plan. This wave makes
the board SAY; that one makes the loop STOP. Both are wanted; neither
substitutes for the other.

### Done when

The plan's `## Done when` items 5, 6, 7 and 8 are this wave's specification
(1–4 belong to `Worded`, already merged). Two are the ones a naive
implementation fails:

- **Item 5** — a worker whose child is working reads differently from one whose
  child is not, asserted on **both**. A cue that never fires and one that always
  fires are equally useless — and since the shell's CPU is near-zero in both
  cases, an implementation reading the shell passes neither.
- **Item 6** — `AgentStateSchema` still has exactly five members, size pinned.
  Catches an implementation that adds `idle` as a sixth state, which would
  satisfy item 5 and change what `isLiveState`/`isBrokenState` classify.

Item 7: a worker with no live child at all is unaffected — it is `stalled` or
`unknown` by the existing rules, untouched here.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

**`plot-worker-state.sh` is sourced, not run**, by dispatch and the fleet scan.
A syntax error there breaks both together — run the shell suites before pushing.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Marked (Branch: feature/a-running-worker-says-if-it-is-idle, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-worker-state.sh`, the fleet payload
field that carries the cue, and the row rendering — plus their tests.

**Do not touch** `AgentStateSchema`, `isLiveState`, `isBrokenState`, or
`agentStateStatus` (wave `Worded` settled that one).

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: generated, marked `-merge`. Never read its diff — take
either side, run `pnpm build:board`, stage the **rebuild** (not the merge's
copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
