# A branch carries no built bundle

> A pull request no longer commits the generated board bundles, and `main` rebuilds them after each merge through a pull request of its own. Today every PR carries its own build of 36 bundles, so each merge makes every other open PR conflict, and on 2026-10-02 seven green PRs needed a merge train to land.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1187, #1112
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A pull request no longer carries the generated board bundles under `skills/plot/scripts/board/`. CI builds them for its own run, and a PR whose diff changes one is refused with the command that drops the change.
- `main` rebuilds the bundles after each merge: a workflow opens a pull request with the fresh build and merges it when its checks pass. An open PR therefore no longer conflicts with `main` because another PR merged.
- The board no longer repairs bundle conflicts. `plot-resolve-artifact.sh` and its automatic run are removed, because no branch carries a bundle to conflict.

<!-- Board impact: the board's artifact is one of the bundles. The operator's board runs main's committed build, which now trails a merge by one bundle PR (about one CI run). The auto-repair the board starts is removed in slice 3. -->

## Motivation

**Every merge makes every open PR conflict.** `skills/plot/scripts/board/` holds 36 generated files, and `.gitattributes` marks 41 paths `-merge`. Local git keeps one side whole, but GitHub ignores the attribute when it computes mergeability. Measured 2026-10-02:

- After the merge of #1185, all 10 open PRs read DIRTY. The only conflicts in 9 of them were in bundles. The 10th, #1182, also conflicted in `test/reconcile/host.test.mjs`.
- A hand repair (merge `main`, take a side, `pnpm build:board`, push) cleared them. The watcher then merged #1185 and #1177, and the next five merges failed on new bundle conflicts.
- Repairing, re-running CI and merging one PR at a time costs about 10–15 minutes per PR. A merge train (#1188) landed seven green PRs in one merge, after one combined rebuild.
- `main` carries 4 commits titled `plot: build the board artifact` since 2026-10-01 against 37 PR merges. Each PR builds its own copy, and each copy is a conflict.

**The automatic repair fails and does damage.** `plot-resolve-artifact.sh` runs `pnpm run test:board` before it pushes. That run fails on every local machine because `streaming-scan.test.ts` reads the machine's real PR index (#1112). After the failure, the rollback runs `git reset --hard HEAD~1` (`plot-resolve-artifact.sh:411`). That removed an operator's pushed commits twice on 2026-10-02 (#1187).

**The cost falls on the fleet.** An agent whose PR is DIRTY reads as waiting on a person (#1164). It cannot finish, and its slot stays taken.

## Design

### Approach

**A built bundle is `main`'s output, never a branch's input.**

1. **`main` builds its own bundles.** A workflow on every push to `main` runs `pnpm build:board`. When the tree changes, it force-pushes the result to one fixed branch, `bot/board-artifact`, opens or updates one PR, and enables auto-merge. The PR runs the required `validate` check like any other. `main` requires a PR and 0 approvals, so the workflow can merge its own PR. Only one such PR exists at a time, and a later push to `main` replaces its content.
2. **A PR's diff carries no bundle.** In CI, the step `Board build + artifact freshness` changes for pull requests. It builds the bundles for the run's own tests, and it refuses the PR when the diff against its merge base changes a generated path. The set of paths comes from the build, as `check-bundle-attributes.sh` already reads it, never from a list. The refusal prints the repair: `git checkout origin/main -- skills/plot/scripts/board/ && git commit`. On `main` the step stays a freshness check, and the bundle PR makes it pass.
3. **A desk may hold a built bundle.** An agent that changes board source runs `pnpm build:board` to test locally. The rebuilt bundles are uncommitted changes, so `plot-desk-dirt.sh` excuses the generated paths. The reaper then does not hold a desk for its own build output. The worker prompt says to build and not to stage the bundles.
4. **The repair goes.** With no bundle on a branch, no branch has a bundle conflict. `plot-resolve-artifact.sh`, the board's automatic call to it, and its tests are removed. That closes #1112's effect on the fleet and #1187.

**Order.** Slice 1 is safe alone: while PRs still carry bundles, the workflow finds a fresh `main` and opens nothing. Slice 2 starts refusing bundle diffs only after slice 1 keeps `main` fresh. Slice 3 removes the repair once nothing needs it.

**What stays.** The bundles stay tracked on `main`, because the plugin installs from the repository (`.claude-plugin/marketplace.json` names `source: ./`) and runs `skills/plot/scripts/board/*.mjs` directly. A release tag holds a fresh build, because the release PR is cut from `main`.

**What trails.** Between a merge and its bundle PR, `main`'s bundles are one merge old, for about one CI run. A script that calls a new bundle option meets the older bundle in that window. Every bundle caller already treats a missing answer as "could not ask". A desk cut from `main` in that window can run `pnpm build:board`.

### Open Questions

- [ ] **The token.** A PR opened with the default `GITHUB_TOKEN` starts no workflow run, so its required `validate` check never runs and auto-merge never fires. The workflow needs a GitHub App token or a fine-grained PAT with `contents: write` and `pull-requests: write`, stored as a repository secret. Which one, and who creates it?
- [ ] **Two merges inside one CI run.** The bundle PR is force-pushed on each push to `main`. If `main` moves while its checks run, auto-merge either waits for the new run or merges a build one merge old. Check which one GitHub does with `strict: false` before slice 1 merges.
- [ ] **PRs open at the switch.** When slice 2 merges, every open PR that carries bundles is refused. Either the slice ships with a one-time sweep that drops the bundle changes from the open fleet PRs, or the refusal's repair line is enough.
- [ ] **The changeset-release PR.** It is cut from `main` and carries the bundles `main` holds. Confirm it needs no change.

## Slices

### Main builds its bundles

- `bug/main-builds-its-bundles` — a workflow on push to `main` builds the bundles, opens or updates one PR from `bot/board-artifact`, and enables auto-merge <!-- builds: board-artifact workflow, the bundle PR on main -->

### A PR carries no bundle

- `bug/a-pr-carries-no-bundle` — CI refuses a PR whose diff changes a generated bundle and builds the bundles for its own run; `plot-desk-dirt.sh` excuses the generated paths; the worker prompt says to build and not to stage <!-- waits: bug/main-builds-its-bundles --> <!-- builds: the no-bundle gate in ci.yml -->

### The repair is retired

- `bug/the-artifact-repair-is-retired` — removes `plot-resolve-artifact.sh`, the board's automatic call to it, and their tests <!-- waits: bug/a-pr-carries-no-bundle -->

## Notes

- 2026-10-02: drafted after the merge train #1188. GitHub settings read the same day: `main` requires the `validate` check (`strict: false`), a PR, and 0 approvals; `enforce_admins` is off.
