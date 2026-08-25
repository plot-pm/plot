## Implementation brief — the-registry-lives-where-the-dispatcher-writes-it (wave Named)

- **Plan (canonical):** `docs/plans/2026-08-25-the-registry-lives-where-the-dispatcher-writes-it.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `feature/the-registry-directory-is-configured` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. Wave `Counted` (the board reports which registry it read) waits on
this one.

### What to build

The board resolves its agent-manifest directory through `plot-config.sh` instead
of hardcoding the repo-relative `.plot/agents`, so a board served from a worktree
the dispatcher never wrote to still finds the registry.

The concrete failure, measured 2026-08-25: a board restarted from a fresh
worktree reported **all 12 agents with `session: ''`**, so `BrokenAgentMenu`'s
`if (!agent.session) return null` fired for every row and the one broken agent
could not offer *Drop this agent*.

```
.plot/agents/ in the main checkout          7 manifests
.plot/agents/ in the previous board tree   25 manifests
.plot/agents/ in the current board tree     0 manifests
```

### The decisions the plan settles — do not re-derive them

**The session field is NOT lost, and nothing serializes it away.** Three facts
disprove that, and each is one grep:

- `AgentEntrySchema` defaults `session` to `''` **deliberately** — *absent is a
  real state, not a rejection* (`schema.ts:2899`).
- `registry.ts:135` REJECTS a manifest with no session (`if (session === '')
  return null`), so a manifest-backed entry always carries one.
- `synthesizeEntry` builds entries for worktrees with no manifest and *"invents
  NOTHING it does not have"* — `session: ''` is its documented behaviour.

Every one of those 12 rows was **synthesized**. Do not go looking through
serialization code for a field nothing drops.

**`AGENT_MANIFEST_DIR = '.plot/agents'`** (`registry.ts:110`) is repo-relative,
and `.plot/agents/` is gitignored (`.gitignore:45`) — hence per-worktree. That
combination is the whole defect.

**Config, not a special case.** Reading the main worktree directly was
considered and rejected: it hardcodes this repo's layout, and it is wrong for a
project whose dispatcher runs elsewhere. Use `plot-config.sh get <key> <default>`
— the mechanism this project already uses for every adopting-project convention
(Principle 5). **The default must be today's path**, so a single-checkout
project sees no change at all.

**The synthesis path STAYS.** It is what makes a hand-made worktree visible.
Deleting it would satisfy the headline and make undispatched worktrees vanish.

**The guard stays too.** `if (!agent.session) return null` is correct — a Drop
offered without a session acts on nothing or on the wrong entry.

### Done when

The plan's `## Done when` items 1, 2, 4, 6 and 7 are this wave's specification
(items 3 and 5 belong to wave `Counted`). Two exist because a naive
implementation passes without them:

- **Item 2** — a worktree that genuinely has no manifest still synthesizes an
  entry with `session: ''`. Catches deleting the fallback.
- **Item 6** — a project with no config key set behaves exactly as today.
  Catches a change that fixes this estate and breaks every other adopter.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`) — pnpm crashes
on 26. Add a changeset with `'@plot-pm/board': patch` frontmatter.

If you add a `## Plot Config` key, document it in the CLAUDE.md config list and
in `plot-config.sh`'s own key documentation — the repo keeps both in sync.

### Bookkeeping

When the PR exists, annotate the wave heading on main — this is a `## Waves`
plan, so the PR goes **inside** the heading:

```
### Named (Branch: feature/the-registry-directory-is-configured, PR: #N)
```

A trailing `→ #N` parses as `prs=[]` on a Waves plan. Check
`git branch --show-current` is main before that edit. Push your first real
commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/registry.ts` and its tests, plus the
config-key documentation.

**Do not touch** `BrokenAgentMenu`, `AgentEntrySchema`, or `synthesizeEntry`'s
behaviour — all three are correct and the plan says so.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: it is generated and marked `-merge`. Never read its diff —
take either side, run `pnpm build:board`, stage the **rebuild** (not the merge's
copy), then commit. Staging before rebuilding produces a commit that looks
repaired and fails CI's freshness gate.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
