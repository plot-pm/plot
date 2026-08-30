## Implementation brief — a-log-lives-with-its-worktree (slice 2: Moving)

- **Plan (canonical):** `docs/plans/2026-08-30-a-log-lives-with-its-worktree.md` on `main`
- **Branch:** `infra/a-log-lives-under-worktrees` (base: `main`)
- **Ends as:** one PR to `main`

Needs `infra/one-place-decides-where-a-log-lives`.

### What to build

The resolver returns a path under the configured worktree root. A path guard on
`/api/dispatch-log`. A one-time move of existing logs.

### The decisions the plan settles — do not re-derive them

**The old location was half right, not wrong.** `dispatch.ts:145` put logs
beside the repo because a log INSIDE it would be an untracked file every
`git status` reports and every worktree inherits. **But "not in the repo" was
implemented as "the parent directory"**, which Plot does not own. `.worktrees/`
only became available on 2026-08-30 with the `Worktree root` key.

**Read the same key `plot-config.sh` and `resolve_wt_root()` read**, so a
project with a different root gets its logs there. **The fallback is today's
location, not an error** — a repository with no key has no `.worktrees/`, and
creating one because a log needs somewhere to go invents a directory nobody
asked for.

**`/api/dispatch-log` serves these files to a browser.** Its existing guard
validates the SLUG against `SLUG_RE` — directory-independent, already excludes
`../` — so **leave it exactly as it is**. Add a second check: the resolved path
sits under the configured root. That is the invariant the resolver now owns and
the one a future caller could violate without touching the slug.

**Correct the route's comments.** They describe the old location; prose naming a
path goes stale silently.

**The one-time move is bounded, and the boundary is the point.** A dispatch that
touches files in the parent directory does more than it says. So:

| | |
|---|---|
| moves | `plot-<kind>-*.log`, `.state`, `.prompt.md` — nothing else |
| moves, never deletes | a file Plot did not write is not Plot's to remove |
| runs once | a marker in `.worktrees/` records it |
| failure is not fatal | **a failed move must not fail the dispatch** |

**The migration is convenience; the dispatch is the job.**

### Done when

The plan's Moving `Done when` — all six points, including: a second dispatch
moves nothing, a failed move leaves the dispatch working, and the path guard
rejects a resolved path outside the root.

Repo gates: `pnpm test`, `pnpm run typecheck`, `pnpm run test:board`,
`pnpm build:board`, changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns the resolver's return value, the path guard, and the migration. **Does not
touch `plot-reap.sh`.**
