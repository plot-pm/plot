# Definition of Done

What "done" means for a change to Plot. The mechanical items are gated in CI
(`.github/workflows/ci.yml`); the judgment items are conventions the author and
reviewer uphold.

## Every change

- [ ] Skills parse and frontmatter validates (`pnpm test`, `pnpm run validate`).
- [ ] Contract tests pass (`pnpm run test:reconcile`) — the plan-format contract
      (`plot-plan-meta.sh`) is specified by fixtures; a format change updates a
      fixture in the same commit.
- [ ] A changeset is present when skills changed (`pnpm changeset`), and the
      plugin version is bumped per `CLAUDE.md` › Versioning.

## The board must keep working

The Kanban board (`@plot-pm/board`, shipped as
`skills/plot/scripts/board/board-server.mjs`) is a first-class part of Plot, not
an experiment. A change is not done if it breaks the board.

- [ ] Board typechecks (`pnpm run typecheck`).
- [ ] Board tests pass (`pnpm run test:board`).
- [ ] The shipped artifact is fresh: `pnpm run build:board` produces no git diff.
      CI rebuilds and byte-diffs it, so a stale check-in fails the build.

### Resolving a board artifact conflict

`skills/plot/scripts/board/board-server.mjs` is generated output — 177 lines of
roughly 4,500 characters. Git merges line by line, so **every** board change
lands in the same handful of enormous lines: two branches touching entirely
disjoint sources still collide there, and the diff cannot be read.

`.gitattributes` marks the file `-merge`, so git keeps one version whole and
reports the conflict **without writing conflict markers into it**. The file
stays valid JavaScript through the conflict, and the resolution is to rebuild:

```bash
git checkout --ours skills/plot/scripts/board/board-server.mjs   # either side
pnpm build:board
git add skills/plot/scripts/board/board-server.mjs
```

**Do not read the diff, and do not think about which side to take.** Whichever
version git kept is overwritten by the rebuild, so the choice cannot affect the
result — which is why the first command may equally be `--theirs`.

**Never phrase this resolution as "take ours".** Under `git merge`, *ours* is
the branch being merged into; under `git rebase`, the roles invert and *ours*
is the upstream. Agents in this repo rebase routinely, so a side-named
instruction is correct in one flow and wrong in the other. The instruction is
side-neutral on purpose: **take either version, then rebuild.**

The freshness gate above is what keeps this honest. Resolve by keeping a stale
artifact and forget to rebuild, and CI's no-diff check fails — the strategy
removes the *conflict*, the gate still enforces *correctness*.

Verified by `test/reconcile/artifact.test.mjs`, which asserts among other things
that a merge and a rebase commit byte-identical artifacts, and that the strategy
works in a clone that configured nothing.

## Board impact is a planning item

The board reads plans through `plot-plan-meta.sh`, so changes to the **plan
format, the plan template, the helper scripts, or the `docs/plans` layout** can
change what the board shows. Any plan that touches those must state its board
impact — a one-line **Board impact: none** is a perfectly good answer. The plan
template carries a `Board impact:` prompt for this.

This half is a convention, not a gate: a linter can check that a line exists,
not that impact was actually considered. It lives here so it is part of how we
plan, and so reviewers look for it.
