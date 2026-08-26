## Implementation brief — the-worktrees-live-in-one-place (wave Rooted)

- **Plan (canonical):** `docs/plans/2026-08-23-the-worktrees-live-in-one-place.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session (2 rounds)
- **Branch:** `infra/the-worktree-root-is-configurable` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Moved` (the `--migrate` mode) depends on this and is separate —
do not build it here.

### What to build

`## Plot Config` gains an optional `Worktree root:` key, read through
`plot-config.sh`. Relative paths resolve against the repo root; an absolute path
is taken as given. **The default is today's behaviour** — `repo_root/..` with the
`plot-wt-` prefix — so a repo that says nothing is untouched.

### THE DECISION THAT MATTERS MOST — do not re-derive it

**Every read of "where is this branch checked out" must ask git. Only the
CREATION path composes a name.**

`held_worktree` (`plot-dispatch.sh:1120`) already asks git, and its comment
records why, from a measured failure:

> Every hand-made worktree on this machine is named `plot-wt-<last-segments>`
> with the branch TYPE dropped … A path-guessing gate therefore missed a
> worktree with six modified files in it. And it missed it in the WORST POSSIBLE
> POPULATION: worktrees dispatch did not create are precisely the ones carrying
> no claim ref, which is the entire reason this gate exists.

**This change makes that worse if it is not respected**, because it introduces a
SECOND naming convention. Any code reconstructing a path from a branch name now
has two ways to be wrong.

There are exactly three sites, and they are not equivalent:

| site | what it does | what to do |
|---|---|---|
| `plot-dispatch.sh:470` | `wt_root=$(cd "$repo_root/.." && pwd)` | read the config key |
| `plot-dispatch.sh:1052` | composes `plot-wt-<branch>` | CREATION — keep, but prefix follows the root |
| `plot-resolve-artifact.sh:117` | composes a path to FIND an existing worktree | **convert to ask git** |

The third is the one the comment above warns about, and converting it is part of
this wave.

### The prefix is a property of the root, not a constant

A shared root prefixes; a dedicated root does not. Under `Worktree root:
.worktrees/` the directory becomes the flattened branch
(`bug-a-wave-is-one-row`), because the directory already says what these are.
The legacy default keeps `plot-wt-`, where it is still doing its job.

**Two conventions coexist permanently, and that is the intended outcome** — the
plan argues it, round 2 confirmed it, and prefixing everywhere was rejected: it
keeps a workaround alive in the case that removes the need for it.

### Nesting inside the repo was tested, and the objection withdrawn

The plan records a measurement you do not need to repeat: with `.worktrees/` in
`.gitignore`, an untracked file **and** a `PLOT-BLOCKED:` marker planted inside a
nested worktree are invisible to both `git status --porcelain` and
`git grep --untracked --exclude-standard`. `--exclude-standard` honours
`.gitignore`. A `.gitignore` line is the whole mitigation.

**Assert it in THIS repo, not only in a scratch probe** — that is a Done-when.

### Done when

The plan's `## Done when` list is the specification. The ones a naive
implementation fails:

- **A repo declaring nothing dispatches exactly where it does today, prefix
  intact.** This is what keeps 26 existing checkouts working, and an
  implementation that silently relocates them passes every other assertion.
- **`held_worktree` and every other "where is this branch" read still asks
  `git worktree list`.** Asserted with a worktree whose directory name matches
  NEITHER convention — the exact population the measured failure was in.
- **An absolute `Worktree root` is honoured as given**, not appended to the repo
  root.
- **After a booking, no `.plot-start-*` remains under the worktree root.**
  `plot-dispatch.sh:656` already removes it and is verified to work, but it ends
  `|| true`; under the new root a leftover would sit inside the repo.

Plus `pnpm test` and `pnpm run test:e2e`. Node 24 (`nvm use`).

### Open question this wave does NOT settle

Whether `.gitignore` gains `.worktrees/` from this change or from
`/plot-board-setup` is open in the plan, and the plan's own reasoning is that
*"a `.gitignore` line that appears without being asked for is a write to a file
the user owns."* If you need one to test, add it and say so in the PR — do not
decide the question.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Rooted (Branch: infra/the-worktree-root-is-configurable, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists, and run
every test in the FOREGROUND — a `-p` run receives no notification.

### Scope guard

This branch owns `plot-dispatch.sh`'s root resolution and naming,
`plot-resolve-artifact.sh`'s worktree lookup, and their tests.

**Do not build `--migrate`** — that is wave `Moved`.
**Do not move any existing worktree.** A mixed estate is an ordinary state in
this plan, not a transition to be completed, and `git worktree move` on a
checkout an agent is writing to breaks it mid-run.

Add a changeset with a `bumps:` block naming the skills you touched — CI
validates both the package name (`plot`) and that each bumped skill is a real
directory.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
