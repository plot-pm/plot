## Implementation brief — the-blocking-wave-is-found-wherever-it-is (wave: Found)

- **Plan (canonical):** `docs/plans/2026-08-23-the-blocking-wave-is-found-wherever-it-is.md` on main
- **Approved:** 2026-08-24, in-session, after one interrogation round
- **Branch:** `bug/the-blocking-wave-is-found-wherever-it-is` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

`BlockedByMark`'s ⓘ silently does nothing when the blocking wave is in a
collapsed section. Expand that one section, then scroll to and flash the target
as it already does.

### THE DECISION THAT MATTERS MOST — do not re-derive it

**The query is already correct. Do NOT widen it.**

An earlier draft of this plan said the selector was scoped to one section's wave
list and proposed widening it. That is wrong: `BlockedByMark` already calls

```js
document.querySelector(`[data-wave-list="…"] [data-wave-row="…"]`)
```

— one selector, both attributes, **document-wide**. Widening it is a no-op that
passes every test written for it. If you find yourself editing that selector,
stop: you are fixing the cause the interrogation refuted.

**The real cause is one line in `collapse.ts`:**

```ts
export const COLLAPSED_BY_DEFAULT: WaitingGroup[] = ['quiet', 'done'];
```

and one comment in the renderer: folded rows are *"removed from the tree rather
than hidden with CSS"*. A collapsed section has **no rows in the DOM**, so there
is nothing for any selector to find. DONE is folded by default for every reader
on every load.

### Settled

**Expand only the ONE section holding the target.** Never a general unfold, and
**never a fold** — the mark may open a section, never close one. The wave's own
`section` in the payload says which.

**The cost is accepted and must not be designed away.** `writeCollapsed`
persists to `localStorage`, so unfolding DONE changes the reader's layout until
they fold it back. That is deliberate: the reader ASKED which wave, and silence
is the defect being removed.

**Never fail silently.** If the row still cannot be reached — filtered out, other
tab — the mark states the wave's NAME and that it is not on screen. `if (!target)
return` is the whole reason this survived to be reported from the board rather
than caught by a test.

### Done when

The plan's 8-item list. Two are easy to miss:

- **Leave DONE folded in the browser test.** A test that expands it first passes
  against today's broken code and proves nothing.
- **The query is unchanged**, asserted by reading the diff.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Waves` section on
main once the PR exists. Add a changeset (`'@plot-pm/board': patch`). Run
`pnpm build:board` in THIS worktree and commit the artifact.

### Scope guard

`packages/board/src/app/components/AgentList.tsx` (BlockedByMark) and
`packages/board/src/app/lib/agent-rows/collapse.ts`, plus their tests.

`the-row-says-whether-you-can-start-it` is in flight and editing
`row-identity.ts`, `schema.ts`, `fleet.ts` and `mock-fleet.ts` — small overlap,
but merge `origin/main` before opening the PR rather than discovering it at
merge time.
