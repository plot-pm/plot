# The worktrees live in one place

> Twenty-eight fleet worktrees sit as siblings of the repo, in the directory that also holds every other project. `.worktrees/` inside the repo is the convention this team already uses elsewhere, and the objection to it — that git would scan into them — is measurably false.

## Status

- **Phase:** Draft
- **Type:** infra
- **Sprint:** <!-- optional -->
- **Issue:** <!-- optional -->
- **Story:** <!-- optional -->
- **Review:** in-session
- **Impl:** own branches

## Changelog

- Dispatched worktrees are created under `.worktrees/` inside the repo instead of beside it, and the location is a `## Plot Config` key rather than a hardcoded path.

<!-- Board impact: no contract or plan-format change. Touches
     skills/plot/scripts/plot-dispatch.sh, plot-resolve-artifact.sh, .gitignore,
     and one board fixture path. The board reads worktree paths from the pulse and
     needs no change of its own. Rebuild the artifact. -->

## Motivation

`plot-dispatch.sh` puts every worktree in the repo's **parent**:

```sh
wt_root=$(cd "$repo_root/.." && pwd)          # :135, :470
printf '%s/plot-wt-%s' "$wt_root" …           # :994
```

On this machine that is `~/Quatico/Agentic-Tools/`, which also holds unrelated
projects. Twenty-eight `plot-wt-*` directories currently sit there. The prefix
exists to make them identifiable *because* they share a directory with things
that are not Plot worktrees — a workaround for the location.

`.worktrees/` inside the repo is what this team already uses in other
repositories, and it makes the prefix redundant: the directory says what they
are.

### The objection, tested and withdrawn

The obvious worry is that nesting worktrees inside the repo would pollute the
scans Plot depends on — `git status --porcelain` for dirtiness and `git grep
--untracked` for the blocked marker. **Measured 2026-08-23** in a scratch repo
with `.worktrees/` in `.gitignore`, an untracked file *and* a `PLOT-BLOCKED:`
marker planted inside a nested worktree:

```
git status --porcelain                     → (empty)
git grep -lIE --untracked --exclude-standard 'PLOT-BLOCKED:' -- .   → (no match)
```

**Git sees nothing.** `--exclude-standard` honours `.gitignore`, so an ignored
directory is excluded from both. `plot_worker_dirty` uses that same `git status
--porcelain`, so it is covered by the same result.

This is recorded because the objection was raised in this session, from reading
the code rather than running it, and it was wrong. A `.gitignore` line is the
whole mitigation.

### What this is NOT

**Not a fix for anything broken.** The current layout works. This is
tidiness plus one real property: a worktree root that is *configurable* rather
than derived from `repo_root/..`, so a repo whose parent directory is not
writable — or is shared — can say where its worktrees go.

Stated plainly so the plan is not oversold: nothing fails today because of this.

## Design

### The config key

`## Plot Config` gains an optional key, read through `plot-config.sh` like every
other:

```
- **Worktree root:** .worktrees/
```

Relative paths resolve against the repo root; an absolute path is taken as
given. **The default is the current behaviour** (`repo_root/..` with the
`plot-wt-` prefix), so a repo that says nothing is unaffected and no existing
checkout moves under anyone.

### The prefix follows the location

Under a dedicated root the `plot-wt-` prefix is noise. The directory name
becomes the flattened branch (`bug-a-wave-is-one-row`), and the prefix is kept
only for the legacy default, where it is still doing its job.

That means the prefix cannot be a constant. It is a property of the root: a
shared root prefixes, a dedicated root does not.

### What must NOT start guessing paths

`held_worktree` asks **git** which worktree holds a branch, and its comment
records why, from a measured failure:

> Every hand-made worktree on this machine is named `plot-wt-<last-segments>`
> with the branch TYPE dropped … A path-guessing gate therefore missed a
> worktree with six modified files in it. And it missed it in the WORST POSSIBLE
> POPULATION: worktrees dispatch did not create are precisely the ones carrying
> no claim ref, which is the entire reason this gate exists.

**This change makes that worse if it is not respected**, because it introduces a
*second* naming convention. Any code that reconstructs a path from a branch name
now has two ways to be wrong. Every read of "where is this branch checked out"
must go through `git worktree list`; only the *creation* path composes a name.

`plot-resolve-artifact.sh:117` composes a path to find an existing worktree and
should be converted to ask git as part of this change — it is the one remaining
site with the shape the comment above warns about.

### Moving what exists

**Do not move a worktree with a live worker.** `git worktree move` on a checkout
an agent is writing to breaks it mid-run; measured today, 28 worktrees exist and
several hold running agents.

So the migration is opt-in and idempotent, not automatic:

- new dispatches use the configured root immediately;
- existing worktrees stay where they are and keep working — every read asks git,
  so a mixed estate is not a special case;
- a `--migrate` mode moves only worktrees with **no live worker and no unlanded
  work**, using `git worktree move`, and reports what it skipped and why.

A mixed estate must be an ordinary state, not a transition to be completed.

### Open Questions

- [ ] Should `.worktrees/` be added to `.gitignore` by this change, or by
      `/plot-board-setup`? Adding it here helps this repo; adopting projects get
      it from whichever command writes their config. Probably here **and**
      there — but a `.gitignore` line that appears without being asked for is a
      write to a file the user owns.
- [ ] `plot-dispatch.sh:613` puts a temp worktree at `$wt_root/.plot-start-…`.
      Under the new root that lands inside `.worktrees/`, which is fine — but
      confirm it is cleaned up, since a leftover there is now inside the repo
      rather than beside it.

## Done when

- A repo declaring `Worktree root: .worktrees/` gets its next dispatch there,
  with no `plot-wt-` prefix.
- A repo declaring **nothing** dispatches exactly where it does today, prefix
  intact. Asserted directly: this is what keeps every existing checkout working,
  and an implementation that silently relocates them passes every other
  assertion here.
- An **absolute** `Worktree root` is honoured as given, not appended to the repo
  root.
- `held_worktree` and every other "where is this branch" read still asks
  `git worktree list`. Asserted with a worktree whose directory name does NOT
  match either convention — the exact population the measured failure was in.
- `plot-resolve-artifact.sh` finds a worktree it did not create.
- `--migrate` moves an idle worktree and **refuses** one with a live worker or
  unlanded work, naming what it skipped.
- A worktree under `.worktrees/` does not make the main repo dirty, and its
  files do not answer the marker grep. Asserted in the repo, not only in the
  scratch probe this plan measured.
- `pnpm test`, `pnpm run test:e2e` green.

## Waves


### Rooted (Branch: infra/the-worktree-root-is-configurable)
- `Worktree root` config key, default unchanged; the prefix becomes a property of the root; `plot-resolve-artifact.sh` stops composing a path; `.gitignore` gains the directory


### Moved (Branch: infra/idle-worktrees-can-be-migrated)
- `--migrate` moves worktrees with no live worker and no unlanded work, refuses the rest, and reports both

## Notes

Raised 2026-08-23. The first answer given in-session was *don't* — on the
grounds that nested worktrees would pollute `git status` and the marker grep.
That was reasoning from the shape of the code, and testing it took two minutes
and showed it was false. Recorded in **The objection, tested and withdrawn**
rather than quietly dropped, because the same argument will occur to the next
reader.

The second wave is separate because moving twenty-eight existing checkouts is a
different risk from choosing where the next one goes, and the first is useful
without it.

<!-- CHALLENGE-THE-PLAN-METADATA
{
  "round": 1,
  "questionHistory": [
    {"q": "Would nesting worktrees inside the repo break git status / the marker grep?", "a": "No - measured: .gitignore + --exclude-standard excludes them from both. The objection was withdrawn", "category": "technical"},
    {"q": "Can existing worktrees be moved?", "a": "Not while a worker is live; migration is opt-in, idempotent, and a mixed estate is an ordinary state", "category": "implementation"}
  ],
  "deferredItems": [],
  "categoriesCovered": {
    "technical": {"stack": true, "architecture": true, "implementation": true},
    "domain": false,
    "ux": {"happyPath": false, "edgeCases": false, "errors": false, "accessibility": false},
    "nonFunctional": {"security": false, "performance": false, "scalability": false},
    "tradeOffs": true
  }
}
END-CHALLENGE-THE-PLAN-METADATA -->
