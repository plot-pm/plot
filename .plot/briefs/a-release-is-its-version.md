## Implementation brief — a-mock-row-shows-what-the-tuple-still-gets-wrong

- **Plan (canonical):** `docs/plans/*a-mock-row-shows-what-the-tuple-still-gets-wrong.md` on `main`
- **Branch:** `bug/a-release-is-its-version` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

A release row currently shows a **PR number** where its name should be. Its name
is the **version being cut** — `2.7.0`, not `240` — read from the PR title
through a new contract field. Its PR and its branch become **artifact links in
slot 4**, never links in the status column.

### The decisions the plan settles — do not re-derive them

**Read the version from the PR TITLE, through a new field on `PrSchema`.** Not
parsed in the renderer, not guessed from the branch name. The row passes the
title through; the naming happens where the row is created. `schema.ts`'s own
rule: *"a derivation is a guess with a rule attached"*.

**A release whose PR title names no version keeps a sensible fallback** — the
plan's test list ends on that case. Absent is not false: do not invent a version.

**The status column holds no links.** Assert it by looking for **anchors in that
cell**, not by matching text — a text assertion passes while an `<a>` is still
rendered.

**This matters beyond cosmetics.** `changeset-release/main` is one of only two
rows in the whole fleet with no plan behind it, and it is the control a person
reaches for at the end of a sprint. A row labelled `240` is the one row nobody
should have to decode.

### Done when

The plan's test list for this branch is the specification — it is unusually
explicit, including the anchors-not-text rule above. Plus: `nvm use` (Node 24 —
pnpm crashes on 26), `pnpm run test:board`, `pnpm build:board` with the artifact
committed, and a changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `packages/board/src/contract/schema.ts` (the new `PrSchema` field), the
release-row construction in `packages/board/src/server/fleet.ts`, the slot-4
link rendering, and their tests.

**`feature/the-sections-ask-the-wave` is dispatched alongside you and also
touches `schema.ts`.** It adds wave lookups; you add a PR title field. Keep your
diff to that field so the two rebase cleanly.

`feature/the-plan-row-offers-deliver` is live in `AgentList.tsx` and a server
route — **do not touch `AgentList.tsx`**.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
