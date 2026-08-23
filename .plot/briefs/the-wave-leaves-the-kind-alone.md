## Implementation brief — a-mock-row-shows-what-the-tuple-still-gets-wrong (wave: first)

- **Plan (canonical):** `docs/plans/*a-mock-row-shows-what-the-tuple-still-gets-wrong.md` on `main`
- **Branch:** `bug/the-wave-leaves-the-kind-alone` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

The wave name must render **beside the branch name only**, never in the kind
slot. Today a `data-wave` element can land in the kind's track, so a row reads
its wave where it should read what kind of thing it is.

### The decisions the plan settles — do not re-derive them

**The assertion is about WHERE, not whether.** The plan's tests name it
precisely: a branch row's wave is adjacent to its branch name, and **no
`data-wave` element sits in the kind's track**. A plan row shows no wave at all.

Assert the negative directly — an implementation that merely moves the element
usually still leaves the old one rendering in some row kind, and only the
"nothing in the kind track" assertion catches that.

### Done when

The plan's `## Done when` is the specification. Plus: `nvm use` (Node 24),
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own the wave-rendering path in `tuple-row.ts` / `TupleRow.tsx` and its tests.

`bug/an-eligible-wave-takes-the-actionable-tone` is being dispatched at the same
time and also touches `tuple-row.ts` — but only the `statusTone` function. Stay
out of `statusTone` and the two rebase cleanly.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
