## Implementation brief — fleet-knows-what-collides (wave 1: Merge)

- **Plan (canonical):** `docs/plans/2026-08-16-fleet-knows-what-collides.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #142 merged (two interrogation rounds)
- **Branch:** `infra/board-artifact-merge` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

Wave 2 (`feature/dispatch-reports-work-in-flight`, `feature/fleet-row-says-blocked`)
waits for this one — a collision report is more useful once the artifact stops
producing a collision on every single pair.

### What to build

`skills/plot/scripts/board/board-server.mjs` is **796 KB across 177 lines** —
roughly 4,500 characters per line. Git merges line by line, so every change to
the board, whatever source file it came from, lands in the same handful of
enormous lines. Two branches touching entirely disjoint sources still conflict
there, and the conflict cannot be resolved by reading it.

Not theoretical: PR #141 opened `CONFLICTING` and `merge-tree` named exactly one
file — this one. Zero source conflicts. It has been the binding constraint on
parallel board work repeatedly.

**A conflict in a reproducible file is not information.** Any version is as good
as any other, because `pnpm build:board` reproduces the correct one from sources
that merged cleanly. So the merge stops trying to reconcile it, and a rebuild
settles it.

### Three decisions the plan settles — do not re-derive them

**`-merge` in `.gitattributes`, NOT a custom merge driver.** The elegant idea is
a `merge=rebuild` driver that invokes `pnpm build:board`; it is also the
dangerous one. `.gitattributes` is versioned and travels with the repo, but the
**driver definition lives in each clone's `git config`**. On CI, on a fresh
clone, on a new colleague's machine, the attribute would name a driver that does
not exist — and git falls back to a normal merge, silently. A rule that only
works where someone remembered to install it is exactly what this repo's
guidance warns against. The repo has no `.gitattributes` today and no driver
configured, so both were checked rather than assumed.

**Which side git keeps must not matter.** Under `git merge`, "ours" is the
branch being merged into; under `git rebase` the roles invert — and agents here
rebase routinely. Since the kept content is overwritten by `pnpm build:board`
in the next step, the resolution is side-neutral: **take either version, then
rebuild**. Any wording or configuration that names a side is a bug waiting for
a rebase.

**The file stays in git, and the CI gate stays exactly as it is.** It is checked
in for reasons that still hold: `pnpm board` starts it with no build step, and
the plugin ships it. CI does not need it as an input — the workflow runs
`pnpm run build:board` itself and then diffs, so the committed file is an
*expectation*, not a dependency. The gate is what keeps this honest: if a branch
resolves a conflict by keeping a stale artifact and forgets to rebuild, the
no-diff check fails. The strategy removes the *conflict*; the gate still
enforces *correctness*.

### Done when

The plan's `## Done when` list is the specification. Three assertions exist
because the naive version passes without them:

- **Two board branches that touch disjoint sources merge without an artifact
  conflict.** Assert against real branches, not a fixture — the 177-line shape
  is what causes this, and a small synthetic file would not reproduce it.
- **A merged branch still fails CI if the artifact is stale.** The gate must
  survive the strategy; without this the change trades a conflict for a silent
  regression.
- **The strategy works in a clone that configured nothing.** Assert against a
  fresh clone with no `git config` of its own — a custom driver passes on the
  author's machine and silently does nothing everywhere else.
- **The resolution never names a side.** Assert that a rebase and a merge
  produce the same committed artifact.

Plus: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`,
`pnpm run validate` all pass; a changeset is present; macOS bash 3.2, so no
`declare -A`.

Document the resolution procedure where someone hitting the conflict will find
it — the repo's own contributing guidance, not only a commit message.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Push your first real commit as soon as
it exists** — several agents today finished work that stayed invisible because
it was never pushed.

### Scope guard

`.gitattributes` and, if the procedure needs documenting, `CLAUDE.md` or the
contributing docs. Do **not** change `package.json`'s build scripts or the CI
workflow — the gate is deliberately untouched.

Three branches are in flight (`bug/board-binds-port-zero` on the server
bootstrap, `feature/agent-view-phase-ui` on `AgentList.tsx`,
`bug/fleet-sees-unpushed-commits` on the scan). None overlaps your files. You
are, however, changing how the artifact they all rebuild behaves on merge — so
land this cleanly and quickly rather than sitting on it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
