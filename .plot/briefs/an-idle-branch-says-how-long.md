## Implementation brief — a-branch-with-work-is-visible (wave: Aged)

- **Plan (canonical):** `docs/plans/2026-08-24-a-branch-with-work-is-visible.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/an-idle-branch-says-how-long` (base: `main`)
- **Ends as:** one PR to `main`

**Wave 2 of 2.** `Seen` shipped as **#492** — a branch with commits and no PR now
gets a row, `kind: 'branch'`, `state: 'wip'`, in NOT STARTED.

### What to build

The row states **how long the branch has sat**, so *in flight* and *abandoned*
are distinguishable at a glance rather than by opening each one.

### The decisions the plan settles — do not re-derive them

**This is a display of an existing field, not a new derivation.** `ageMinutes` is
already on the row and already rendered elsewhere, so this costs nothing new.
If you find yourself computing an age, check why the existing one does not serve.

**Why it matters more than the plan first said.** The plan was written against 8
candidate rows; re-measured on main 2026-08-27 the estate holds **34 unmerged
branches, 3 with open PRs** — about 31 rows. At that scale the plan's own words
apply: a row saying only *this branch exists* "would be noise at 80". The age is
what makes the section actionable rather than a list.

The spread is real and worth reading before choosing a format: this estate holds
branches at **14 hours** and at **119 days**. A format that renders both
legibly — and makes the difference obvious at a glance — is the whole feature.

**Do not add a toggle, and do not filter by age.** The plan rejects hiding: a
feature that hides itself by default is one nobody discovers. If volume becomes a
problem the answer is grouping, never visibility.

### Done when

The plan's `## Done when` list is the specification — this wave completes item 6
of it. The assertion that matters:

- **The age is rendered on a branch row**, and the row still lands in NOT
  STARTED, never WAITING ON YOU. Wave 1's item 5 must not regress: nothing is
  asked of the reader by a branch someone may still be writing.

Plus: `pnpm test`, `pnpm run test:reconcile` green; **artifact rebuilt and
committed** (`pnpm build:board` from the repo root) if anything under
`packages/board` changes; a changeset with `'@plot-pm/board': patch` **package
frontmatter** (a board change does NOT use a skills `bumps:` block); Node 24
(`nvm use`, `corepack pnpm`).

**Do not run `pnpm run test:board`** — operator rule: a UI test must never start
the real board. Let CI run the browser tests; it has its own machine.

Note `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json` is a
**tracked fixture** that board test runs rewrite — check `git status` before
committing and never `git add -A` after a suite run.

### Bookkeeping

Annotate this branch inside its **wave heading** on main:
`(Branch: x, PR: #N)` INSIDE the heading — Waves dialect.

### Scope guard

This branch owns whatever renders the branch row's age in
`packages/board/src/app/` and its tests. The row itself was wave 1 (#492).
