## Implementation brief — a-branch-with-work-is-visible (wave: Seen)

- **Plan (canonical):** `docs/plans/2026-08-24-a-branch-with-work-is-visible.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/a-branch-with-work-is-seen` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

**This is wave 1 of 2.** `Aged` (`feature/an-idle-branch-says-how-long`) adds the
"how long it has sat" signal and is positionally blocked until this merges. Build
the row; not the age rendering. The two should land close together — see below.

### What to build

The board's plan-less row loop iterates **PRs**, so a branch carrying commits and
no PR is invisible. Invert the subject: the **branch** is the row, and its PR — if
any — is one fact about it. That is already how planned rows work; the plan-less
loop is the odd one out.

The union to walk is *branches with commits not in the default branch*, which git
answers directly:

```sh
git branch -r --no-merged origin/main
```

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**`--no-merged` is the bound, and it is the assertion a naive implementation
passes without.** Walking all branches satisfies every other check in `Done when`
while adding rows nobody wants. A merged branch has nothing outstanding.

**Re-measured on main 2026-08-27: 34 unmerged branches, 3 with open PRs** — about
31 candidate rows, against the 8 the plan was written with. **Do not test against
8.** The bound is the walk, not a count. The design is unchanged, but at ~31 rows
the age signal stops being a nicety, which is why `Aged` follows immediately.

**`state: 'wip'` is the honest answer** and the one the existing loop already uses
for its own rows: the branch exists and carries work. It also lets `classify`
reach its arms normally, rather than needing a new state nothing else understands.

**`kind: 'branch'`, and NOT a new `orphan` kind.** `RowKindSchema` has seven kinds
and its docstring says adding one makes two tables a compile error until both
answer for it — deliberately. A branch with no PR *is* a `branch`.

**It lands in NOT STARTED, and must NOT land in WAITING ON YOU.** Nothing is asked
of the reader by a branch someone may still be writing; WAITING ON YOU's whole
value is that its rows need an answer, and swamping it destroys that. If a worker
is running on the branch, the worker facts move it to WORKING through the same
path every other row uses — do not special-case that.

**No toggle.** A feature that hides itself by default is one nobody discovers, and
the finding is precisely that the board was quietly incomplete. If volume becomes
a problem, the answer is grouping, never visibility.

### Done when

The plan's `## Done when` list is the specification, all 6 items. The ones that
exist *because a naive implementation would pass without them*:

- **Item 3** — a merged branch still produces no row. Walking all branches passes
  items 1, 2, 4 and 5 and is wrong.
- **Item 4** — a branch already carrying a plan row or a PR row gets **no second
  row**. The existing `planned` set is the guard; one branch on the board twice is
  a defect this sprint has already fixed four times.
- **Item 5** — nothing from this path reaches WAITING ON YOU.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board` green; **artifact rebuilt and committed**
(`pnpm build:board` from the repo root — from `packages/board` it is
`pnpm build`); a changeset with `'@plot-pm/board': patch` **package frontmatter**
(a board change does NOT use a skills `bumps:` block); Node 24 (`nvm use`, and
`corepack pnpm` — homebrew pnpm runs its own node and crashes).

Board browser tests load the BUILT artifact — build before running them or you
will test a stale bundle and get reassuring green.

### Bookkeeping

When the PR is created, annotate this branch inside its **wave heading** in the
plan's `## Waves` section on main: `(Branch: x, PR: #N)` INSIDE the heading. A
trailing `→ #N` parses as `prs=[]` in the Waves dialect. Check
`git branch --show-current` is main first, or use a detached scratch worktree
(`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns the plan-less row loop in `packages/board/src/server/` and its
tests. The age rendering is wave 2's.

Note `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` is a
**tracked fixture** that board test runs rewrite — check `git status` before
committing and never `git add -A` after a suite run.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
