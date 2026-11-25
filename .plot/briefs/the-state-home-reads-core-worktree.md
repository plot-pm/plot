## Implementation brief — fleetctl-runs-in-a-submodule-checkout (wave 2: Domain state home)

- **Plan (canonical):** docs/plans/2026-11-23-fleetctl-runs-in-a-submodule-checkout.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-state-home-reads-core-worktree` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

Wave 1 (`bug/the-repo-root-reads-core-worktree`, #3720) has merged. It put `plot_checkout_of_common` in `skills/plot/scripts/plot-desk-root.sh:60`. This branch is the domain half of the same rule and needs nothing else to land first.

### What to build

In a repository checked out as a git submodule, the common git dir is `<workspace>/.git/modules/app/web`. `stateHomeOf` (`packages/domain/src/rules/state-home.ts`) answers a home only where the common dir's last segment is `.git`, so every reader of `.plot/state` answers `{ unread: true }` there. Wave 1 fixed the shell. The TypeScript side still answers `unread` for a submodule (issue #3043).

Build, in this order:

1. A new rule `mainCheckoutOf(commonDir, coreWorktree)` in `packages/domain/src/rules/main-checkout.ts`. It returns the main checkout: `coreWorktree` resolved against `commonDir` where it is set (relative to the common dir, or absolute), else the parent of a `commonDir` whose last segment is `.git`, else `unread`. It is pure: no `fs`, no `realpath`.
2. `stateHomeOf` takes the `core.worktree` reading as a second argument and asks `mainCheckoutOf`. Update every caller (`git grep -n stateHomeOf packages`): the two adapters below and any test that calls it.
3. The adapters `packages/domain/src/adapters/main-checkout.ts` (`stateHomeAtSync`) and `packages/domain/src/adapters/state-home/state-home-git.ts` (`stateHomeAt`) read `git config --get core.worktree` against the common dir, and only where its last segment is not `.git`. A normal checkout and a linked desk spawn nothing more than today. The adapter realpaths the home the rule returns, as it realpaths the common dir today; a path that does not resolve answers `unread`.
4. A corpus test `packages/domain/corpus/main-checkout.corpus.test.ts` that holds the pair: `mainCheckoutOf` against `plot_checkout_of_common` / `plot_repo_root`, over a normal checkout, a linked desk and a submodule fixture. Follow `sprint-score.corpus.test.ts` and `corpus/README.md` for the shape and the disagreement message (`<subject> :: <field> :: rule="…" shell="…"`).

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **The rule lives in the domain; the shell duplicates it on purpose.** `plot_repo_root` runs once per desk probe in `plot-worker-state.sh`, which is the per-agent-per-pass case in `docs/shell-and-domain.md`. Calling a bundle from it was rejected on cost: `node -e ''` starts in 34 ms. A declared duplicate is allowed; an undeclared one is not, so the corpus test is part of this slice, not a follow-up.
- **`core.worktree` is read only where the common dir is not `.git`.** The shell says why (`plot-desk-root.sh:58`): a `.git` dir that sets the key for another reason must not move its checkout. Reading it everywhere would add one spawn per root to every board and fleet process. Rejected: reading the key unconditionally.
- **An unread home is never replaced by the input path.** Slice 1 of `fleet-state-is-read-whole-and-from-one-home` settled that a fallback to `repoRoot` is the defect that made merges read an empty directory. A submodule common dir with no `core.worktree` stays `unread` in the domain.
- **A known difference, to declare and not to hide.** The shell's `plot_checkout_of_common` answers `dirname` for a non-`.git` common dir that has no `core.worktree` (a bare repository `/r/.bare` answers `/r`). The plan's rule answers `unread` there, and the plan's own test says so. Keep the corpus over the three shapes the plan names. If you add the bare case it disagrees by design; do not adjust either side to make it pass. Report the difference in the PR body and let a person decide, as `docs/shell-and-domain.md` requires.
- **`plot_given_common_dir` needs no change** (plan, Approach). A submodule's `.git` file names `../../.git/modules/app/web`, not a path under `worktrees/`, so the exported answer is refused and git is asked, as today.
- **Out of scope:** `plot-fleetctl.sh` and every shell file (wave 1); the open questions `[question-other-readers]` and `[question-host-env]` (wave 1's list of the nine `--git-common-dir` readers); any change to a reader of the state home beyond passing the new argument.
- **Carried rules:** absent is not false; a failed read is not an absent reading; read the exit code, not the emptiness. A failed `git config` (exit 1 for an unset key) means "no key", while any other exit or a spawn error means `unread`.
- **Style:** arrow functions for every function you write. TSDoc states what an export does, its parameters, its return and how it fails, with no history. Reasoning goes in the commit message.

### Done when

The plan's `## Slices` entry for this branch is the specification. The assertions that exist because a naive implementation would pass without them:

- `packages/domain/test/state-home.test.ts`: a common dir `/w/.git/modules/app/web` with `core.worktree` `../../../../app/web` answers `{ home: '/w/app/web' }`. This catches a rule that resolves against the wrong base (the common dir, not its parent). The existing cell *answers unread for a submodule common directory* stays true for a `null` key; a non-`.git` dir with no key answers `unread`; an absolute `coreWorktree` is taken as is.
- `packages/domain/test/state-home-adapter.test.ts`: a real submodule fixture (`git -c protocol.file.allow=always submodule add`, in a `mkdtempSync` root, removed by the exact name returned) answers `{ home: <submodule working tree> }` through both `stateHomeAt` and `stateHomeAtSync`. A normal checkout and a linked desk answer as before. This catches an adapter that reads the key but never passes it, which the rule's unit test cannot see.
- A cell proving a normal checkout spawns no `git config` (count the calls on the held-answers seam, or the spawn stub). This catches the unconditional read.
- The corpus test names both answers and the subject on a disagreement, and runs with no host token (`packages/domain/corpus/no-host-token.ts` does this).

Plus: add a changeset (description first, `bumps:` block last; package `@plot-pm/board`, since the board reads the state home through this rule; add `plot` only if a skill changes). Run `./scripts/check-changeset-packages.sh`. Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh`). Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints. The suites in the `CI suites` config key run in CI; a failure there comes back as a correction. Do not run `test:e2e` locally. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` needs no payment; if you find you must edit one, the growth is paid for in the same change.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.

### Scope guard

This branch owns `packages/domain/src/rules/state-home.ts`, the new `rules/main-checkout.ts`, `packages/domain/src/adapters/main-checkout.ts`, `packages/domain/src/adapters/state-home/state-home-git.ts`, the corpus test, and the tests above. Callers of `stateHomeOf` elsewhere (`packages/board/src/server/state-home.ts`, `packages/fleet`) change only if the signature forces it. The plan `fleet-state-is-read-whole-and-from-one-home` changes `state-home.ts` consumers (`main-checkout.ts` in `packages/fleet/src/shared/`, `fleet-state-file.ts`, `approve.ts`, `design.ts`, `verify.ts`, `review.ts`); its overlap was not re-checked beyond `git grep`. If `git diff origin/main` shows a collision on these files at push time, report it.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
