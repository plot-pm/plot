# Implementation brief — the-board-says-slice (Binding to it)

- **Plan (canonical):** `docs/plans/2026-09-03-the-board-says-slice.md` on main
- **Branch:** `infra/the-tests-select-slice` (base: `main`)
- **Ends as:** one PR to main
- **Runs last**, and the ordering is the point: a selector and the test gripping it must change in ONE commit, so this cannot ride with either slice before it.

### What to build

`data-wave-row` and its siblings, renamed **together with every test that selects on them**.

Measured 2026-09-03, the attribute appears in both trees:

```
packages/board/src/app/components/AgentList.tsx
packages/board/src/app/components/TupleRow.tsx
packages/board/src/app/lib/agent-rows/marks.tsx
packages/board/src/app/lib/agent-rows/menus.tsx
packages/board/src/app/lib/agent-rows/rows.tsx
packages/board/test/catalogue/index.ts
packages/board/test/catalogue/states.ts
packages/board/test/helpers.mjs
```

**Five source files and three test files.** The two halves are one commit.

### Why this is the risky slice, and what protects it

A renamed attribute with an un-renamed selector produces a test that **finds nothing and passes** — `querySelectorAll` returning an empty list is not an error. The prose and identifier slices cannot fail this way; this one can.

**So the guard is a count, not a match.** Assert the number of rows a fixture yields, not merely that the selector runs: a fixture known to render N rows must still yield N. That is the assertion that distinguishes *renamed correctly* from *renamed into silence*.

`packages/board/test/helpers.mjs` is where the shared selectors live — moving them there once is cheaper than chasing each call site, and it is the file that makes the count assertion reusable.

### The decisions the plan settles — do not re-derive them

**The board's `Wave` is a Slice** — `{ plan, name, branches }`, one plan, named by a `### ` heading; 58 on this estate, all holding one branch. The domain's `entities/wave.ts` Wave is the one correct use and is untouched.

**`branches` stays plural**, because it is how an over-full slice is detected.

### Done when

- Every `data-wave-*` attribute and every selector that grips it moved in one commit.
- **A fixture's row count is unchanged** — the assertion that catches a rename into silence.
- `pnpm run test:board` green, including the browser tests. **Run `pnpm build:board` FIRST**: the browser tests load the built artifact, so a stale one fails reassuringly and tells you nothing.

Plus: `pnpm test`, `pnpm run typecheck`, the artifact committed, a changeset. **Do NOT run `pnpm run test:e2e` locally** — CI owns it.

### Bookkeeping

When the PR exists, append `→ #<number>` to this branch's bullet under `### Binding to it` — trailing arrow, not the heading form. Push the first real commit as soon as it exists.

### Scope guard

Attributes and the tests that select them. The prose (slice 1) and the type and identifiers (slice 2) are already landed when this runs — if either left something behind, note it rather than fixing it here.
