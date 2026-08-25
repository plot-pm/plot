## Implementation brief — the-registry-lives-where-the-dispatcher-writes-it (wave Dropped)

- **Plan (canonical):** `docs/plans/2026-08-25-the-registry-lives-where-the-dispatcher-writes-it.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/the-drop-writes-where-the-registry-reads` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 3. Wave `Named` merged as #420; `Counted` (the board reports which
registry it read) is independent of this one.

### What to build

`drop.ts` resolves the manifest directory the same way the reader does, so the
Drop action removes the file the board is showing.

**#420 fixed the read path and left the write path behind.** Two call sites
still join the constant:

```
drop.ts:6    import { AGENT_MANIFEST_DIR, … } from './registry.js'
drop.ts:85   const file = path.join(repoRoot, AGENT_MANIFEST_DIR, `${session}.json`)
drop.ts:187  const file = path.join(opts.repoRoot, AGENT_MANIFEST_DIR, `${session}.json`)
```

Measured 2026-08-25, after #420 merged and the board was restarted from a
worktree with the `Agent registry` key pointing elsewhere: dropping four entries
returned **`dropped=true` with `"no manifest found"`** — four times, over four
files that were still on disk:

```
.plot/agents/24141934-….json    existiert
.plot/agents/218fcf4c-….json    existiert
.plot/agents/35f6028d-….json    existiert
.plot/agents/bff77e93-….json    existiert
```

The endpoint looked in the board's own worktree; the files sat in the
dispatcher's checkout.

### The decisions the plan settles — do not re-derive them

**A drop that removes nothing must not report success.** This is the sharper
half. `dropped=true` over a file that still exists is worse than a refusal: the
row returns on the next pulse, and nothing distinguishes the action from a
no-op. The operator (this session, 2026-08-25) believed four entries were gone
and reported them as such — the manifests were untouched.

So the endpoint must distinguish *there was no manifest* from *I looked where
the reader does not look*. The first is a legitimate `dropped=true` (the entry
was synthesized, or reconciliation got there first); the second is a bug that
should never be reachable once this wave lands.

**Reuse the reader's resolver.** `registry.ts` already resolves the directory
through `plot-config.sh` with the constant as its default — #420 built exactly
that. Do not write a second resolution path; import the one that exists. Two
implementations of *where is the registry* is how they drift, which is the
defect this wave is fixing one level down.

**The guard stays.** `if (!agent.session) return null` in `BrokenAgentMenu` is
correct — a Drop offered without a session acts on nothing. Untouched here.

### Done when

The plan's `## Done when` items 7, 8 and 9 are this wave's specification.
Item 8 is the one a naive implementation passes without: fixing only the path
makes the four-file case work while leaving `dropped=true` reachable over a
missing file for any other reason.

Assert with the **configured directory differing from the repo-relative
default** — that is the measured case, and a test using the default alone
passes against the broken code.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

**`/api/registry/drop` is a write route.** Adding or changing one means the
write-gate test needs it in its `WRITE_ROUTES` list, or the suite fails.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Dropped (Branch: bug/the-drop-writes-where-the-registry-reads, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/drop.ts` and its tests.

**Do not touch** `registry.ts`'s resolver (it is correct — import it),
`synthesizeEntry`, `AgentEntrySchema`, or `BrokenAgentMenu`.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: generated, marked `-merge`. Never read its diff — take
either side, run `pnpm build:board`, stage the **rebuild** (not the merge's
copy), then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
