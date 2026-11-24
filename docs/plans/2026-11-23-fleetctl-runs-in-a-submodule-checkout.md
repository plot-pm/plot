# Fleetctl runs in a submodule checkout

> In a repository checked out as a git submodule, the main checkout is the path the common git dir's `core.worktree` names, so `plot-fleetctl.sh --status`, `--once` and `--start` agree on one estate and desks go under that checkout.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** plot-describes-itself
- **Issue:** #3043
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Started:** 2026-11-24, Jan Wloka, `bug/the-repo-root-reads-core-worktree`

## Changelog

- Plot runs in a repository that is checked out as a git submodule. `plot-fleetctl.sh --status` no longer refuses the submodule's own working tree, desks go under that working tree, and the fleet's state files are found there.

<!-- Board impact: none for the plan format. The helper `plot-desk-root.sh` and the domain's state-home rule change; the board reads the state home through the same rule. -->

## Motivation

Issue #3043 reports that `plot-fleetctl.sh --status`, run in a submodule's working tree `<workspace>/app/web`, exits 3 with "not part of the estate at `<workspace>/.git/modules/app`". The defect is still on main at `e15c9d319`. `plot_repo_root` (`skills/plot/scripts/plot-desk-root.sh:68`) takes `dirname` of `git rev-parse --git-common-dir`. In a submodule the common dir is `<workspace>/.git/modules/app/web`, so the estate becomes `<workspace>/.git/modules/app`, and the check at `skills/plot/scripts/plot-fleetctl.sh:718` refuses the real checkout. `git --git-dir=<common> config core.worktree` answers the right path, relative to the common dir.

The TypeScript side has the same root. `stateHomeOf` (`packages/domain/src/rules/state-home.ts:14`) answers a home only where the common dir's last segment is `.git`, so in a submodule every reader of `.plot/state` answers `unread`. `main-checkout.ts:24` and `state-home-git.ts` feed it. The issue names only fleetctl; the state home is the second consumer of the same wrong answer.

A home-automation repository is often a submodule of a workspace repository. A second operator who follows Plot's documents to an unattended run, for the sprint goal "Plot can take over the software development part of the operator's home automation: a second operator follows Plot's own documents to an unattended run, and that run has a spend cap and a delivery measure", must not meet an exit 3 at the first fleet command.

## Design

### Approach

- **One rule, in the domain.** A new rule `mainCheckoutOf(commonDir, coreWorktree)` returns the main checkout: `coreWorktree` resolved against `commonDir` where it is set, else the parent of a `commonDir` whose last segment is `.git`, else `unread`. `stateHomeOf` asks it, so its signature gains the `core.worktree` reading. The adapters `main-checkout.ts` and `state-home/state-home-git.ts` read `git config --get core.worktree` against the common dir only where its last segment is not `.git`, so a normal checkout spawns nothing more.
- **The shell duplicates the rule, and declares it.** `plot_repo_root` is sourced by `plot-worker-state.sh` in every per-desk probe, which is the per-agent-per-pass case of *A Shell Script Asks The Domain*. It reads `core.worktree` under the same condition and resolves it with `cd -- "$common/$wt" && pwd -P`. A corpus test at `packages/domain/corpus/main-checkout.corpus.test.ts` holds the pair. `scripts/check-shell-lines.sh` counts the added lines; the slice removes an equal number from `plot-desk-root.sh`'s comments or elsewhere.
- **`plot_given_common_dir` needs no change.** A submodule's `.git` file names `../../.git/modules/app/web`, which is not under `worktrees/`, so the exported answer is refused and git is asked, as today.
- `plot-deliverable-search.sh "submodule"` found only tree-mode and blob-kind code (`rules/git-tree.ts`, `adapters/refs/objects-batch.ts`); nothing resolves a submodule's checkout. `ports/refs.ts:415` already names the submodule case for `linkedWorktree`.

### Open Questions

- [ ] `[question-other-readers]` `git grep` counts 9 shell scripts that read `--git-common-dir`. Recommendation: the first slice lists each one's use; a reader that derives a checkout path moves to `plot_repo_root`, and a reader that only locates a file under the common dir stays.
- [ ] `[question-host-env]` The issue says `plot-host.sh` looks for its fallback `.env` in the wrong place. Recommendation: the first slice covers it where `plot-host.sh` derives the path from the common dir; otherwise it is a separate issue.
- [ ] `[question-test-fixture]` A real submodule fixture needs `git -c protocol.file.allow=always submodule add`. Recommendation: build it in `test/reconcile/desk-root.test.mjs` with that flag, in a `mkdtempSync` root.

## Slices

### Shell root

- `bug/the-repo-root-reads-core-worktree` — `plot_repo_root` answers the path `core.worktree` names when the common dir is not a `.git` directory, and `plot-fleetctl.sh --status` in a submodule's working tree no longer exits 3 <!-- builds: the core.worktree arm of plot_repo_root --> <!-- tests: desk-root.test.mjs — in a submodule fixture plot_repo_root prints the submodule's working tree and plot_desk_root a path under it; fleetctl.test.mjs — --status in the fixture does not print "not part of the estate"; a normal checkout and a linked desk answer as before -->

### Domain state home

- `bug/the-state-home-reads-core-worktree` — `mainCheckoutOf` decides the main checkout from the common dir and its `core.worktree`, `stateHomeOf` asks it, the two adapters read `core.worktree`, and a corpus test holds the shell pair <!-- builds: mainCheckoutOf, the main-checkout rule --> <!-- tests: state-home.test.ts — a common dir `.git/modules/app/web` with core.worktree `../../../../app/web` answers home `<workspace>/app/web`, no core.worktree and a non-.git dir answers unread; main-checkout.corpus.test.ts — rule and plot_repo_root agree on a normal checkout, a desk and a submodule -->

## Notes

Created on 2026-11-23 from issue #3043, for the sprint plot-describes-itself.
