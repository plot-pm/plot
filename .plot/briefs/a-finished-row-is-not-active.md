## Implementation brief — done-holds-what-is-still-yours (wave: Still)

- **Plan (canonical):** `docs/plans/2026-08-23-done-holds-what-is-still-yours.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `bug/a-finished-row-is-not-active` (base: `main`)
- **Ends as:** one PR to `main`

Independent of the wave model — nothing blocks you and you block nothing.

### What to build

**A finished row reports neither a pulse nor a live worker state.** Two faces of
one category error, in one file.

**The activity mark.** `isActive` is `localDirty || localLocked` — a fact about a
**worktree**, asked without reference to whether the work is finished. Measured
2026-08-23: seven DONE rows report it, and every one is dirty on the same file:

```
M packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json
```

That is the board's own test fixture, which the board's own suite rewrites.
**The board is reporting activity caused by running its tests.**

**The worker state.** Three DONE rows carry `worker: failed` or `waiting` on
branches that are `merged` or `deferred`. The branch landed; the worklog's last
recorded state never cleared.

### The decisions the plan settles — do not re-derive them

**Do NOT special-case `last-pulse.json`.** Ignoring that filename silences
today's instance and leaves the rule wrong — any uncommitted file in any stale
worktree brings it back, looking like a new bug. **The defect is asking a LOCAL
question about FINISHED work**, not this one file.

The model states the boundary (`docs/board-domain-model.md`): a local fact may
**describe** a row and may never **order** the fleet. `isActive` crosses it.

**This does not self-resolve when DONE is filtered.** Two of the three stale-worker
rows are `Development`/`Endgame` and stay in DONE under the new membership rule.

**A stale worktree on a merged branch is a real condition** worth reporting — but
it earns a **static** mark, never the motion mark. Same argument `localAhead`
already won: *unpushed commits are finished work sitting STILL.*

### Done when

The plan's `## Done when` is the specification. Beyond it:

- A **merged** row whose worktree is dirty reports **no** activity mark — asserted
  with `localDirty: true` on a merged row, which is the exact live shape. An
  implementation keyed on the fixture's filename passes every other test here.
- A **merged** row whose worker is `failed` or `waiting` does not present that as
  current.
- A row in **WORKING** with `localDirty` still reports activity — the mark must
  keep working where it was right. This is the regression that matters.

Plus the repo's gates: `nvm use` (Node 24), `pnpm run test:board` green,
`pnpm build:board` with the artifact committed, `trash` not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line on `main` when the PR exists. **Push
your first real commit as soon as it exists**, and run tests in the foreground —
three workers stalled today with sound work uncommitted.

### Scope guard

You own `isActive` and the worker-state read. **Not** DONE's membership filter —
that is `bug/done-holds-finished-plans-only`, in another plan's blocked wave.

`AgentList.tsx` is held by several in-flight branches. Keep the diff minimal.

**Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`** —
which is, with some irony, the very file this branch is about.
