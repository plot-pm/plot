# The shell-lines gate missing from the Local checks list

> `scripts/check-shell-lines.sh` runs in CI but not in the `**` entry of `Local checks`, so an agent that runs what `plot-local-checks.mjs` prints meets its refusal one CI round trip later.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3120
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-local-checks.mjs` prints `./scripts/check-shell-lines.sh pr` among the gates for every change, so a local run refuses the same shell growth CI refuses.

<!-- Board impact: none. The change edits one `Local checks` entry in the repo `CLAUDE.md` and its `AGENTS.md` mirror; it does not touch the plan format, the template, skills/plot/scripts/ or the docs/plans layout. -->

## Motivation

CI runs `./scripts/check-shell-lines.sh pr` on a pull request (`.github/workflows/ci.yml`, step "The shell does not grow") and refuses any growth of the command count in shipped shell under `skills/`. The `**` entry of `Local checks` in `CLAUDE.md` lists 15 `scripts/check-*.sh` gates and omits this one (measured on `origin/main` at `e54e53815`).

`node skills/plot/scripts/board/plot-local-checks.mjs` reads that key, and the pre-push instruction in `CLAUDE.md` tells an agent to run what it prints. An agent that does so passes locally, pushes, and learns of the refusal from CI. The layering juror of the panel on `plot-fleetctl-stop-ignores-dry-run` found the omission (#3099).

## Design

### Approach

Append `./scripts/check-shell-lines.sh pr` to the `&&` chain of the `**` entry of `Local checks` in `CLAUDE.md`, then run `./scripts/check-agents-md.sh --write` so the `AGENTS.md` mirror matches.

The gate reads `origin/<default>` through `git merge-base`, so a local run needs that ref fetched. `plot-local-checks.mjs` prints the command and runs nothing; the agent running it fetches first, as CI does in its "Fetch the default branch" step.

### Open Questions

- [ ] `scripts/check-plan-routes.sh` and `scripts/check-sprint-members.sh` are also absent from `CLAUDE.md`. Does either run in CI? If so, does it join this entry, or does a separate plan cover it?
- [ ] Should a test assert that every gate CI runs from `scripts/check-*.sh` appears in `Local checks`, so the list cannot drift again? A grep cannot tell a CI-only gate by intent from an omission, so this may stay a rule.

## Slices

### Local checks entry

- `feature/the-shell-lines-gate-missing-from` — add the shell-lines gate to the `**` entry of `Local checks` and regenerate `AGENTS.md`

## Notes

- Raised by issue #3120; refs #3099.
