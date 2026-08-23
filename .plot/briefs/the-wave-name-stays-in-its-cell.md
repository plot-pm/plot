## Implementation brief — a-split-plan-says-it-is-split (wave: first)

- **Plan (canonical):** `docs/plans/*a-split-plan-says-it-is-split.md` on `main`
- **Branch:** `bug/the-wave-name-stays-in-its-cell` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

A 53-character wave name currently paints over its neighbours: the name escapes
its cell instead of being contained by it. Board-only —
`packages/board/src/app/components/AgentList.tsx` (the plan-head grouping and
the wave row's name cell).

### The decisions the plan settles — do not re-derive them

**`bug/a-wave-is-one-row` HAS LANDED** (#339, merged today). It rewrote the wave
grouping in this same file, so rebase onto current `main` before you start and
read what is there rather than what the plan describes — the plan predates it.

**Containment, not truncation-everywhere.** The fix is that a long name stays in
its cell. A name genuinely wider than the space still elides; do not remove
truncation, which would pass a naive test while breaking narrow viewports.

**Precedent to follow, not re-litigate:** `the-name-track-holds-the-name` is the
sibling problem in `TupleRow.tsx` and is NOT yours. If the fix seems to require
changing the track definitions, stop and report — that is the other branch.

### Done when

The plan's `## Done when` is the specification. Plus: `nvm use` (Node 24),
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `AgentList.tsx` (the plan-head grouping and the wave row's name cell)
and its tests. Do NOT touch `TupleRow.tsx`'s `TUPLE_TRACKS` — that is
`the-name-track-holds-the-name`, which is conflicted and unmerged.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
