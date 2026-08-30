## Implementation brief — a-log-lives-with-its-worktree (slice 1: Resolving)

- **Plan (canonical):** `docs/plans/2026-08-30-a-log-lives-with-its-worktree.md` on `main`
- **Branch:** `infra/one-place-decides-where-a-log-lives` (base: `main`)
- **Ends as:** one PR to `main`

First of four. Only slice 2 depends on it.

### What to build

`packages/board/src/server/agent-log.ts` — one resolver for *where does the log
for `<kind>/<slug>` live*. The nine modules ask it instead of resolving
themselves. **The path it returns does not change in this slice** — only who
decides it.

### The decisions the plan settles — do not re-derive them

**Measured 2026-08-30: 22 call sites across 9 modules** — `dispatch.ts`,
`deliver.ts`, `approve.ts`, `idea.ts`, `resolver.ts`, `reslice.ts`,
`implement.ts`, `story.ts`, `commission.ts` — each hard-coding
`path.resolve(repoRoot, '..')`. One decision, made 22 times.

**READERS COUNT, and the plan missed them at first.** `auto-deliver.ts` and
`auto-dispatch.ts` **read** these logs and are not among the 22 writers. **A
missed reader is worse than a missed writer**: the writer puts a file somewhere
unswept, while the reader looks in the wrong directory and reports nothing
wrong.

**One grep covers both**, and that is why they are not counted separately — two
lists drift, one expression does not.

**Keep the move out of this slice.** Changing who decides and what they decide
in one diff means a reviewer cannot tell a missed call site from an intended
path change.

### Done when

The plan's Resolving `Done when`:

- `grep -rn "resolve(repoRoot, '\.\.')" packages/board/src/` returns **nothing**
- every log path — read or written — comes from the resolver
- the board's log links still open the right file

Repo gates: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`,
`pnpm build:board`, changeset. Node 24, `corepack pnpm`.

Board changesets use package frontmatter (`'@plot-pm/board': patch`), not a
`bumps:` block.

### Scope guard

Owns `agent-log.ts` and the call sites. **Does not change the returned path**
(slice 2), **does not touch `plot-reap.sh`** (slices 3 and 4).
