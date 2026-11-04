# A missing .plot/worker-prompt.sh is named, not an unnamed exit 1

> A repository with a `Worker command` and no `.plot/worker-prompt.sh` fails every worker with an unnamed exit 1 and strands the claim. The start path checks for the file, and the worker's failure line names it.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2529
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-fleet --start` and `plot-dispatch.sh --start` refuse when `Worker command` is set and `.plot/worker-prompt.sh` is absent, and name `plot-install-prompt.sh`. The worker loop's start-failure line names the prompt file it could not run.

Board impact: none. No change to the plan format, the template or the `docs/plans` layout.

## Motivation

Measured on issue #2529 (Plot 2.28.0, quatico-solutions/agent-skills, 2026-10-23): a repository with `Worker command` set and no `.plot/worker-prompt.sh` failed both approved slices with `the command exited 1 without the agent doing any work`, three attempts each. Neither line names the missing file. The slice stays claimed with no agent, the supervisor reports `claim with no agent`, and `plot-dispatch.sh --release` refuses once anything else lands on the branch, so recovery took `--restart` per branch.

`/plot-fleet --start` and `--once` both passed beforehand. `plot-install-prompt.sh --check` reports `absent`, and nothing in the start path asks it.

## Design

### Approach

Two changes, one per failure the issue names.

1. **Refuse at start.** The start path asks `plot-install-prompt.sh --check` when `Worker command` runs `plot-worker-loop.sh`. On `absent` it refuses with a line that names the file and `plot-install-prompt.sh`, and starts no worker. A `Worker command` that does not run the loop, and `Worker command: none`, are not asked.
2. **Name the file in the failure.** The worker loop's two lines (`packages/fleet/src/server/entry/worker-loop.ts:1810` and its sibling for the final attempt) name the prompt file when it is absent, so a worker that starts anyway reports the cause.

The decision (refuse, warn, or proceed) belongs in `@plot-pm/domain` as a rule over a reading of the file, and the start path calls it (layering rule). A shell launcher decides nothing.

### Open Questions

- [ ] Refuse or warn at start? The issue allows both. A refusal stops a repository whose `Worker command` supplies its own prompt another way.
- [ ] The SDK runner falls back to Plot's shipped `templates/worker-prompt.md` (`worker-loop.ts:2181`). Does the same fallback make the file optional for the command runner, so no refusal is needed?
- [ ] Which start paths count: `plot-fleet --start`, `--once`, `plot-dispatch.sh --start`, and fleetd's own dispatch?

## Slices

### Refuse at start

- `feature/a-missing-plot-worker-prompt-sh-start` — the start path refuses when the prompt file is absent <!-- builds: a worker-prompt presence rule in the domain -->

### Name the file

- `feature/a-missing-plot-worker-prompt-sh-line` — the worker loop's failure lines name the prompt file it could not run

## Notes

- Source: https://github.com/plot-pm/plot/issues/2529. Nothing is written to the tracker.
