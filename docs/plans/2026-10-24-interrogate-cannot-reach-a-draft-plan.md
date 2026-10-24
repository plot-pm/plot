# Interrogate cannot reach a Draft plan that lives on its plan PR branch

> `POST /api/interrogate` resolves a Draft plan from the main checkout, so under `Plan PRs: required` it refuses every plan; it must read the plan PR's head and push the panel's artifacts back to that branch.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #2424
- **Review:** pr
- **Impl:** own branches

## Changelog

- The board's Interrogate action runs on a Draft plan that exists only on its plan PR branch, and records the round on that PR.

<!-- Board impact: changes `packages/board/src/server/interrogate.ts` and its caller; the board artifact needs a rebuild only if the served payload changes. -->

## Motivation

In a repository that declares `Plan PRs: required`, a Draft plan exists only on its `idea/<slug>` branch until the plan PR merges. On 2026-10-23, `POST /api/interrogate` with `{"slug":"this-sprint-cannot-select-one-sprint"}` (plan PR #2413, open) answered `plan-unreadable`.

After the plan PR merges, the plan is Approved, and the route accepts Draft only. `needs-design` refuses an Approved plan (`only a Draft plan can move to Design`). So no plan in this repository can be interrogated through the controller: the board's Interrogate action and `/challenge-the-plan` never run here.

## Design

### Approach

`resolvePlanBySlug` in `packages/board/src/server/interrogate.ts` reads the main checkout's plan directory, the way `reslice.ts` does. It never reads the plan PR's branch. `readPhase` in `transition.ts` has the same blind spot.

The route takes the plan from the plan PR's head, the way `plot-approve.sh` does ("read it from PR #N (idea/<slug>)"):

1. Resolve the slug to its open plan PR through the host port. Fall back to the main checkout when no plan PR exists (`Plan PRs: optional`, or a plan already on the default branch in Draft).
2. Run the configured `Interrogate command` in a worktree of the PR's head branch, so `/challenge-the-plan` reads and edits the plan where it lives.
3. After the run, push the panel's artifacts to the plan PR branch: the plan's `Rounds:` increment, the Open Points section, and the `CHALLENGE-THE-PLAN-METADATA` block. The verdict files and `panel.md` stay outside the repository, as today.

The route still decides nothing about the plan. The layering rule holds: the controller calls the domain, the domain owns the port, and an adapter reaches the host and git.

### Open Questions

- [ ] Does the push go through the agent (the skill commits and pushes) or through the route after the run ends? A route-side push needs a controller receipt; an agent-side push needs the worktree's credentials.
- [ ] Should the route also serve an Approved plan that the operator takes back for interrogation, or does that stay with `needs-design`? The issue names the gap and asks only for the Draft case.
- [ ] A plan PR branch that moved during the run: refuse the push, or rebase and retry?

## Slices

### Resolve from the plan PR

- `bug/interrogate-reads-the-plan-pr` — the route resolves a Draft plan from its open plan PR's head and runs the panel in a worktree of that branch

### Push the artifacts

- `bug/interrogate-pushes-to-the-plan-pr` — the round's `Rounds:`, Open Points and metadata block reach the plan PR branch

## Notes

Source: https://github.com/plot-pm/plot/issues/2424. Created with `PLOT_UNATTENDED=1`: Type came from the prompt, `Design:` was not given and the plan starts in Draft.
