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

## Board impact is a planning item

The board reads plans through `plot-plan-meta.sh`, so changes to the **plan
format, the plan template, the helper scripts, or the `docs/plans` layout** can
change what the board shows. Any plan that touches those must state its board
impact — a one-line **Board impact: none** is a perfectly good answer. The plan
template carries a `Board impact:` prompt for this.

This half is a convention, not a gate: a linter can check that a line exists,
not that impact was actually considered. It lives here so it is part of how we
plan, and so reviewers look for it.
