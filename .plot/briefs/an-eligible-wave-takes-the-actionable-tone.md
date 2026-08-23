## Implementation brief — a-startable-wave-says-so (wave: Toned)

- **Plan (canonical):** `docs/plans/*a-startable-wave-says-so.md` on `main`
- **Branch:** `bug/an-eligible-wave-takes-the-actionable-tone` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

`statusTone` colours what a reader ACTS on. An **eligible** wave is the single
most actionable state on the board — it means *this can be started now* — and it
currently takes no actionable tone.

One function in `packages/board/src/app/lib/tuple-row.ts`, plus its tests.

### The decisions the plan settles — do not re-derive them

**`statusTone` is reserved for the two values a reader acts on.** That is the
existing rule and it is why most states are untoned. Eligible qualifies BECAUSE
a person can act on it, not because it is important.

**Do not tone `blocked`.** It was considered and it is the opposite case: a
blocked wave is precisely the one a reader can do nothing about. If you find
yourself adding a second tone, stop and report it.

**No contract change, no server change.** `verdict` is already on the wire and
already renders as the word. This is presentation only.

### Done when

The plan's `## Done when` is the specification. Plus: `nvm use` (Node 24),
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `tuple-row.ts` (the `statusTone` function) and its tests.

`bug/the-wave-leaves-the-kind-alone` is being dispatched at the same time and
also touches `tuple-row.ts`, in the WAVE-rendering code — not `statusTone`. Keep
your diff to that one function so the two rebase cleanly. Do not touch
`AgentList.tsx`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
