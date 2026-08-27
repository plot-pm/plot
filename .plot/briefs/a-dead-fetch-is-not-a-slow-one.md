## Implementation brief — a-dead-fetch-is-not-a-slow-one (wave: Bounded)

- **Plan (canonical):** `docs/plans/2026-08-26-a-dead-fetch-is-not-a-slow-one.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/a-dead-fetch-is-not-a-slow-one` (base: `main`)
- **Ends as:** one PR to `main`

Single wave; depends on nothing.

### What to build

The doc viewers bound their fetch and report a timeout as a FAILURE naming the
likely cause, instead of showing `Loading…` forever. Every other client fetch is
audited for the same gap.

An unbounded `fetch` against a server that has died never rejects — it hangs. The
reader sees the same `Loading…` a slow-but-healthy load shows, and the two states
are indistinguishable on screen. A dead server and a slow one require opposite
actions: restart it, or wait.

### The decisions the plan settles — do not re-derive them

**A slow-but-successful load must still succeed** (item 2). This is the item a
naive fix fails: a bound tight enough to catch a dead server but tighter than a
real slow load turns a working board into a broken-looking one. Choose the bound
against the measured slow case, not against what feels responsive.

**The message names the RESTART, not the exception class** (item 3). A reader who
sees `AbortError` learns nothing they can act on; a reader told *the board server
may have stopped — restart `pnpm board`* knows the next move. This repo's rule
throughout: a failure states what to do, not what threw.

**Audit every client `fetch`** (item 4) — and where one is deliberately left
unbounded, say so in a comment naming why. A silent exception is how the next
unbounded call gets added without anyone noticing the rule exists.

### Done when

All items in the plan. Plus: `pnpm run test:board`, `pnpm run typecheck` green;
artifact rebuilt and committed (`pnpm build:board` from the repo root); a
changeset with `'@plot-pm/board': patch` frontmatter (package frontmatter, NOT a
skills `bumps:` block); Node 24; `trash` not `rm`.

Board browser tests load the BUILT artifact — build before running them.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns the board CLIENT's fetch calls and their tests. A sibling branch
(`bug/the-board-says-how-old-its-plans-are`) is in flight on the board's staleness
reporting — if you both touch a file, keep to your own function. Rebase onto
current main first.
