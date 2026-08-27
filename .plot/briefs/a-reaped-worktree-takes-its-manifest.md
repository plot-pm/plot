## Implementation brief — a-reaped-worktree-takes-its-manifest (wave: Cleared)

- **Plan (canonical):** `docs/plans/2026-08-26-a-reaped-worktree-takes-its-manifest.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/a-reaped-worktree-takes-its-manifest` (base: `main`)
- **Ends as:** one PR to `main`

Single wave; depends on nothing.

### What to build

`plot-reap.sh` removes a worktree whose work has landed and leaves its registry
manifest behind. `readAgentRegistry` then reports an agent whose worktree does
not exist, and the board renders an `unknown` row for it.

**Measured twice on 2026-08-27, by an operator, hours apart.** Both times four
rows appeared in WAITING ON YOU reading `unknown` with a merged wave, and both
times they were cleared by hand:

```
8e9beb4b → plot-wt-feature-the-board-reads-approval-not-phase
adc9a0d5 → plot-wt-bug-a-dispatch-without-a-brief-refuses
b14d8af2 → plot-wt-bug-loose-checks-the-rollup
c5c57b69 → plot-wt-bug-the-header-names-its-branch
```

Every one had a merged PR and a reaped worktree. The manifest described nothing.

### The decisions the plan settles — do not re-derive them

**The worktree is removed BEFORE the manifest**, and `Done when` item 4 asserts
it by making the removal fail. Reversing the order leaves a live worktree with no
manifest — which is the OTHER defect (a synthesized, nameless row), traded for
the one being fixed.

**The five refusals are unchanged.** `plot-reap.sh` refuses on a live pid,
uncommitted changes, a `PLOT-BLOCKED*` marker, a tree on the default branch, and
no merged PR. A refused reap must leave the manifest alone (item 3): the agent is
still real.

**Clear an already-orphaned manifest in the same run** (item 2) — the estate
holds them now, and a fix that only prevents new ones leaves today's rows on the
board forever.

**`drop` must succeed on an entry whose worktree is gone** (item 5). Measured
today: the board's *Drop the agent* action refused these very rows, because
`classifyState` checks `!entry.worktree` (no path recorded) but never
`fs.existsSync(entry.worktree)` (path recorded, directory absent). The guard did
not misjudge the evidence — it never looked.

### Done when

All 6 items in the plan. Plus: `pnpm run validate`, `pnpm run test:reconcile`
green; a changeset with a `bumps:` block naming `plot` (this is a
`skills/plot/` change, NOT package frontmatter); Node 24; `trash` not `rm`.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)` — the
Waves dialect. A trailing `→ #N` parses as `prs=[]` and was found doing exactly
that on two plans today. Push your first real commit as soon as it exists.

### Scope guard

Owns `skills/plot/scripts/plot-reap.sh`, `packages/board/src/server/drop.ts`,
and their tests. Four sibling branches are in flight on other files
(`plot-dispatch.sh`, `/api/story`, two board client areas) — rebase onto current
main before you start.
