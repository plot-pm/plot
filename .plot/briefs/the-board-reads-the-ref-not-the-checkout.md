## Implementation brief — the-board-reads-the-ref-not-the-checkout (wave: Read)

- **Plan (canonical):** `docs/plans/2026-08-27-the-board-reads-the-ref-not-the-checkout.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/the-board-reads-the-ref-not-the-checkout` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

Single wave; nothing waits on it and it waits on nothing. Interrogated twice —
the plan's `Done when` has **15 items**, and several exist specifically because a
correct-looking implementation would pass without them.

### What to build

`board.ts` reads plan and sprint files with `fs.readFileSync` from its own
checkout. Nothing pulls that checkout. The fleet scan beside it reads
`origin/<main>` and fetches every pulse — so one row renders wave facts from a
fetched ref and plan facts from a working tree of unknown age.

Two operator reports on 2026-08-27, twenty minutes apart, from this one cause:

- a `2 rounds` badge beside phase **Development** (the badge renders only for a
  `Discovery` card — the board had been handed `phase: 'Discovery'` for a plan
  whose file on the ref said `Approved`);
- a **Deliver button refusing a finished plan**, both waves merged (#457, #463),
  because the checkout had never seen the commit annotating the second wave.

A `git merge --ff-only` and nothing else fixed both. The checkout was 8 commits
behind then, and **16 commits behind about an hour later** — this is the steady
state, not an unlucky moment.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**Read in ONE process, not one per file.** Measured against this repo's estate:
280 per-file `git show` calls cost **~1.5 s**; one `git cat-file --batch` over
all of them costs **0.011 s**. 136× apart, on a path the client polls every few
seconds. The constraint is written next to the code you are changing — each
`git` spawn costs ~55 ms *regardless of how little work it does*, which is why
`collectBranchPlans` caches on tip SHAs. A per-file loop pays that 280 times and
leaves the board slower than the bug. `Done when` item 5 asserts SPAWN COUNT,
not duration, because a timing assertion is flaky and the spawn count is the
fact that produces the timing.

**Do not add a cache.** Considered and rejected: it makes the common path fast
and every push expensive, and would sit beside the branch-plan cache as a second
cache solving one problem. At 11 ms there is nothing left to cache.

**The parser is ALREADY spawned once — keep it that way.** `readPlanMeta`
(`board.ts:599`) takes an array and its docstring says *"Run the plan-format
helper once over all plan files"*; `board.ts:880` passes working-tree and staged
files together. Staging 151 blobs and then spawning the parser per file would be
~8 s and would undo the batch read entirely. `Done when` item 12 pins it.

**Staging is a proven path, not a new one.** `board.ts:847-859` already writes
branch-plan content to a temp dir under numbered subdirectories (so the BASENAME
survives — two branches can carry same-named plans), maps each temp path back to
its canonical path, and removes the dir in a `finally`. Reuse that shape.
`board.ts:893` restores the canonical path before anything is derived from it;
skip that and a card renders `/var/folders/…/probe.md`.

**The merge is ONE-DIRECTIONAL, and both directions are asserted.**

| the ref says | the working tree says | the board shows |
|---|---|---|
| a plan | anything | **the ref's**, unmarked |
| nothing | a plan | the tree's, marked `not pushed` |
| unreadable | anything | **nothing, and why** |

Row 2 is why unpushed plans are shown rather than hidden (five plans written in
one session, each invisible for minutes; an *edited* unpushed plan would render
stale ref content silently). Row 1 is the safety property — an uncommitted edit
must never become what the board reports, which is the original defect with extra
steps. Row 3 is a repo with no remote: say so, never quietly promote the
checkout.

**The `not pushed` marker will look UNUSED, and that is expected.** The board's
own checkout (`plot-board`) holds **zero** plans absent from the ref, because
nobody authors there. The marker serves an AUTHORING checkout, where `pnpm board`
is also legitimately run. Item 13 asserts it stays absent in a clean dedicated
checkout — both halves are pinned so a later change cannot start marking every
card.

**A new `CardSchema` field is required for the marker.** This client CASTS the
fleet payload rather than parsing it, so a field the schema does not declare is
`undefined` in the renderer no matter what the server sent. Two defects today
came from exactly this. Assert through a rendered card, not the payload
(item 9).

**The symlink walk goes away, and that is a simplification.** Measured on the
ref: **151 plan blobs, 129 symlinks**. `planPathsInTree` already filters on mode
(`100644`/`100755`), so symlinks drop out and each plan is listed once by its
real path — the `seen`-set de-duplication in `collectPlanFiles` exists only
because one plan appears twice on disk. Item 11 guards the regression that
removing it invites.

**Sprints are in this wave, through the same bulk read.** Only 4 sprint files, so
the cost is nil; the reason is correctness — a stale sprint is a wrong release
gate. Splitting them out would put two branches in `board.ts` days apart, which
is how this repo's artifact conflicts get made.

**Render `readRef` and `readRefAge`.** Both are already in the fleet pulse and
displayed nowhere, which is why the two reports above were mysteries rather than
diagnoses. This is a display of existing fields, not a new derivation (item 14).

### Done when

The plan's `## Done when` list is the specification — all 15 items. The ones that
exist *because a naive implementation would pass without them*:

- **5 and 12** — spawn counts for the read and the parse. Both are satisfiable
  by code that is otherwise entirely correct and slower than the defect.
- **1, 2, 3** — asserted against a checkout deliberately left BEHIND. A fix
  verified only on an up-to-date checkout passes without doing anything.
- **8** — the ref wins where both have the plan. The override direction is the
  original bug.
- **9** — the marker survives the client cast.
- **13** — the marker is absent where every plan is on the ref.

Plus the repo's gates: `pnpm run validate`, `pnpm run test:board`,
`pnpm run test:reconcile` green; **artifact rebuilt and committed**
(`pnpm build:board` from the repo root — from `packages/board` it is
`pnpm build`); a changeset with `'@plot-pm/board': patch` frontmatter (a board
change uses package frontmatter, NOT a skills `bumps:` block); Node 24
(`nvm use`); `trash` rather than `rm`.

Board browser tests load the BUILT artifact — build before running them or you
will test a stale bundle and get reassuring green.

### Bookkeeping

When the PR is created, append the annotation to this branch's line in the
plan's `## Waves` heading on main. This plan uses the **Waves** dialect, so the
form is `(Branch: x, PR: #N)` INSIDE the heading — a trailing `→ #N` parses as
`prs=[]` and was found doing exactly that on two plans today. Check
`git branch --show-current` is main before that edit, or use a detached scratch
worktree.

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/board.ts`, the `CardSchema` entry in
`packages/board/src/contract/schema.ts`, whatever renders the marker and the ref
line, and their tests.

Nothing else is in flight in `board.ts` right now — #468 (menus.tsx) and #455
(AgentList/rows/stuck) both merged this morning. Rebase onto current main before
you start.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
