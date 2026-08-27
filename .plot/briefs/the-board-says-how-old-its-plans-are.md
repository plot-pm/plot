## Implementation brief — the-board-says-how-old-its-plans-are (wave: Aged)

- **Plan (canonical):** `docs/plans/2026-08-26-the-board-says-how-old-its-plans-are.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/the-board-says-how-old-its-plans-are` (base: `main`)
- **Ends as:** one PR to `main`

Single wave; depends on nothing.

### What to build

The board reports how far its checkout sits behind `origin/<main>`, and says
*cannot say* where there is no upstream to measure against.

**Read this before you start — the ground moved.** #469 merged earlier today
(`board: read plans and sprints from the ref, not the checkout`), so the board no
longer reads that checkout for plan content. The distance is therefore a
**diagnostic**, not a correctness bug: a stale checkout can no longer produce a
wrong badge or a wrong Deliver refusal, which is what it did before #469.

That does not retire this wave — it sharpens it. Measured on 2026-08-27 the
checkout drifted **16 commits in about an hour**, and twice that day an operator
met a wrong render with nothing on screen to explain it. What this wave adds is
the sentence that would have made those diagnoses immediate.

**#469 already renders `readRef` and `readRefAge`** from the fleet pulse. Look at
what it landed before adding a second, adjacent thing: this wave should extend
that reporting, not duplicate it.

### The decisions the plan settles — do not re-derive them

**A current checkout says NOTHING** — no badge, no banner (item 2). A permanent
indicator that is almost always green teaches a reader to stop looking at it,
which is how the next 16-commit drift goes unnoticed again.

**A detached HEAD reads *cannot say*, never *up to date*** (item 3). Absent is
not false — this repo's recurring rule. There is no upstream to measure against,
and reporting zero would be an invented answer.

**No fetch on the request path** (item 4), asserted by the existing no-network
test. The fleet scan already fetches every pulse; the refs are current without
this code touching the network.

**The board does not pull** (item 5). It reports; it never writes to the
checkout. A `git pull` would mutate a worktree a human may be editing, and would
fail exactly when someone is using it.

### Done when

All items in the plan. Plus: `pnpm run test:board`, `pnpm run typecheck` green;
artifact rebuilt and committed (`pnpm build:board` from the repo root); a
changeset with `'@plot-pm/board': patch` frontmatter (a board change uses package
frontmatter, NOT a skills `bumps:` block); Node 24; `trash` not `rm`.

Board browser tests load the BUILT artifact — build before running them or you
test a stale bundle and get reassuring green.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns the board server/client code that reports the distance, and its tests. A
sibling branch (`bug/a-dead-fetch-is-not-a-slow-one`) is in flight on the board
CLIENT's fetch calls — if you both touch the same file, keep to your own
function. Rebase onto current main first: #469 landed there today and is the
thing you are extending.
