## Implementation brief — fleetctl-runs-in-a-submodule-checkout (wave 2: Domain state home)

- **Plan (canonical):** docs/plans/2026-11-23-fleetctl-runs-in-a-submodule-checkout.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-state-home-reads-core-worktree` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

Wave 1 (`bug/the-repo-root-reads-core-worktree`, #3720) is merged. It added `plot_checkout_of_common` to `skills/plot/scripts/plot-desk-root.sh`, which this branch's rule must agree with. Nothing waits on this branch.

### What to build

Issue #3043, second consumer. `stateHomeOf` (`packages/domain/src/rules/state-home.ts`) answers a home only where the common dir's last segment is `.git`. In a submodule the common dir is `<workspace>/.git/modules/app/web`, so every reader of `.plot/state` answers `unread`. Wave 1 fixed the shell half. This branch fixes the TypeScript half and adds the test that holds the two together.

Build:

1. **A new rule `mainCheckoutOf(commonDir, coreWorktree)`** in `packages/domain/src/rules/main-checkout.ts`, an arrow function with TSDoc that states behaviour and no history. It returns the main checkout: `coreWorktree` resolved against `commonDir` where `coreWorktree` is set, else the parent of a `commonDir` whose last segment is `.git`, else `unread`. Export it from `packages/domain/src/index.ts` next to `rules/state-home.js` (line 142).
2. **`stateHomeOf` asks it.** Its signature gains the `core.worktree` reading as an optional second parameter, so the nine existing call sites in `packages/domain/test/state-home.test.ts` keep compiling. Keep `StateHome` branded: only `stateHomeOf` makes one.
3. **Both adapters read `core.worktree`**: `adapters/main-checkout.ts` (`stateHomeAtSync`, synchronous `execFileSync`) and `adapters/state-home/state-home-git.ts` (`stateHomeAt`, through `FixedAnswers` in `adapters/git-dirs/git-dirs.ts`). Each runs `git --git-dir=<common> config --get core.worktree` only where the realpathed common dir's last segment is not `.git`, so a normal checkout spawns nothing more. `stateHomeAt` needs a new held answer on `FixedAnswers`, built the way `absoluteCommonDir` is, so the adapter does not call `git` outside that seam.
4. **A corpus test** at `packages/domain/corpus/main-checkout.corpus.test.ts`, built on `corpus/compare.ts` with `describingAs({ left: 'rule', right: 'shell' })` as `env-file.corpus.test.ts` does. It compares `mainCheckoutOf` over the adapter's readings against `plot_repo_root`/`plot_checkout_of_common` in `plot-desk-root.sh` for a normal checkout, a linked desk and a submodule.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **The domain rule is pure; the adapter owns the filesystem.** Rejected: letting `mainCheckoutOf` call `realpath` or `existsSync`. `CLAUDE.md` › *The Layering Rule* allows the domain `zod` and nothing else outside `adapters/`, and `ci.yml:186` gates it. The rule joins and normalises strings only.
- **`core.worktree` is relative to the common dir, not to the cwd.** Measured by wave 1 on 2026-11-24 in a fresh `git submodule add ../sub app/web` fixture: the common dir prints `<ws>/.git/modules/app/web` and `core.worktree` prints `../../../../app/web`. An implementation that resolves it against `repoRoot` passes a fixture where both coincide and fails the real layout. An absolute value passes through unchanged.
- **The adapter realpaths the resolved checkout, as the shell does with `pwd -P`.** macOS prints `/private/var/...`, and a logical path never prefixes a path `git worktree list` prints. Wave 1 recorded the same rule for the shell.
- **A `core.worktree` that names no directory is the same as an absent one.** The shell's `plot_checkout_of_common` falls back to the parent when its `cd` fails. The rule cannot test existence, so the adapter does: it passes `coreWorktree` to the rule only after `realpath` succeeds on the resolved path, else it passes `null`.
- **Read `core.worktree` only off a non-`.git` common dir.** Rejected: always reading it. A checkout that sets `core.worktree` for another reason would move its state home. The shell refuses this for the same reason (comment above `plot_checkout_of_common`).
- **The shell stays a declared duplicate.** Rejected: calling the bundle from `plot_repo_root`; `plot-worker-state.sh` runs it once per desk per pass (`CLAUDE.md` › *A Shell Script Asks The Domain*, 34 ms against none). This branch does not touch `plot-desk-root.sh`. The corpus test is the only coupling.
- **Rules carried over:** absent is not false (a missing key is not an error); read exit codes, not emptiness (`git config --get` exits 1 for an absent key, which is the normal answer and not a failure).

### One divergence to resolve before the corpus test is written

The plan says a common dir that is not `.git` with no `core.worktree` answers `unread` (`state-home.test.ts` already asserts it for `/r/.bare` and `/r/.git/modules/x`). Wave 1's shell answers `dirname "$common"` for the same input, so `plot_repo_root` gives `/r` where the rule gives `unread`. That is a real disagreement, and the corpus rule is that **on a disagreement the branch stops**: adjusting either side to make the comparison pass is the forbidden move.

Recommendation, which this brief takes as the plan's intent: the rule keeps `unread`. A state home is a place to write `.plot/state`, and guessing the parent of a bare clone is a wrong answer where `unread` is a true one. The shell's `dirname` fallback is a root-locating convenience that predates the rule. So the corpus test covers the three cases the plan names, each of which both sides define (a normal checkout, a desk, a submodule with the key set), and the PR body names the bare/no-key case as a known, declared difference with the two answers. If you disagree, write `PLOT-BLOCKED` naming both answers; do not change `plot-desk-root.sh` here.

### Done when

The plan's `Done when` for this slice is the specification: `state-home.test.ts` — a common dir `.git/modules/app/web` with `core.worktree` `../../../../app/web` answers home `<workspace>/app/web`, no `core.worktree` and a non-`.git` dir answers `unread`; `main-checkout.corpus.test.ts` — rule and `plot_repo_root` agree on a normal checkout, a desk and a submodule. Lift these assertions, because a naive implementation passes without them:

- **The adapters run against a real submodule.** Extend `packages/domain/test/state-home-adapter.test.ts` (its `describe.each` already runs `stateHomeAt` and `stateHomeAtSync` together) with a fixture built by `git -c protocol.file.allow=always submodule add`, in a `realpathSync(mkdtempSync(...))` root. A rule test with a hand-written `../../../../app/web` passes while an adapter that never reads the key stays `unread`.
- **A desk of the submodule answers the submodule's working tree**, not the desk. Cut it with `git worktree add` from the submodule checkout.
- **A normal checkout spawns one `git`, not two.** Count the calls on a counting `FixedAnswers`, as the `fixedAnswers` doc in `git-dirs.ts` says tests do. This catches an implementation that always reads the key.
- **A relative key and an absolute key both resolve.** A key naming a missing directory answers what an absent key answers.
- **The corpus fixture runs the shell function for real** (`bash -c 'source plot-desk-root.sh; plot_repo_root'` in the fixture's cwd), as `env-file.corpus.test.ts` runs `plot-host.sh`. Compare physical paths.

Plus the repo's gates: this slice touches `packages/domain/src/**`, so `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .` applies (the root `pnpm run typecheck` skips the domain package). No board artifact changes and no bundle belongs in the diff (`scripts/check-no-bundle-diff.sh`); if the domain export list reaches a bundle, do not commit the rebuild. Add a changeset for `plot` (`patch`), description first, `bumps:` block last; `./scripts/check-changeset-packages.sh` checks it. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints, including the corpus file it names. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally.

**Shell gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds no shell, so the gate needs no payment. If you find you must edit a `.sh` file, stop and report: the shell half is wave 1's.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- Commit subject: `plot: …` or `plot-fleetctl: …` per `CLAUDE.md` › Commit Conventions.

### Scope guard

This branch owns `packages/domain/src/rules/state-home.ts`, the new `rules/main-checkout.ts`, `packages/domain/src/index.ts` (one export line), `adapters/main-checkout.ts`, `adapters/state-home/state-home-git.ts`, `adapters/git-dirs/git-dirs.ts` (the new held answer only), `packages/domain/test/state-home*.test.ts`, `packages/domain/corpus/main-checkout.corpus.test.ts` and a changeset.

Out of scope: `skills/plot/scripts/plot-desk-root.sh` and the other shell readers of `--git-common-dir` (wave 1). Branch `bug/every-state-reader-asks-one-state-home` (a slice of `fleet-state-is-read-whole-and-from-one-home`, not yet pushed) also works on `adapters/main-checkout.ts`, so a collision there is resolved in whichever PR merges second.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
