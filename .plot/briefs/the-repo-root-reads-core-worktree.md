## Implementation brief — fleetctl-runs-in-a-submodule-checkout (wave 1: Shell root)

- **Plan (canonical):** docs/plans/2026-11-23-fleetctl-runs-in-a-submodule-checkout.md on main
- **Approved:** 2026-11-24, jwloka, plan-PR #3699 merged
- **Branch:** `bug/the-repo-root-reads-core-worktree` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`Review: pr`, auto-review on)

Wave 2 (`bug/the-state-home-reads-core-worktree`) waits on this one in heading order. It adds the domain rule `mainCheckoutOf` and a corpus test that compares the rule with the `plot_repo_root` this branch changes.

### What to build

Issue #3043: in a repository checked out as a git submodule, `plot-fleetctl.sh --status` exits 3 with "not part of the estate at `<workspace>/.git/modules/app`". `plot_repo_root` (`skills/plot/scripts/plot-desk-root.sh:68`) takes `dirname` of the common git dir. In a submodule the common dir is `<workspace>/.git/modules/app/web`, so the estate becomes `<workspace>/.git/modules/app`, and the check in `resolve_wt_root` (`plot-fleetctl.sh:~718`) refuses the real checkout.

Measured 2026-11-24 in a fresh `git submodule add ../sub app/web` fixture: `git rev-parse --path-format=absolute --git-common-dir` prints `<ws>/.git/modules/app/web`, and `git --git-dir=<that> config --get core.worktree` prints `../../../../app/web`, relative to the common dir. A linked worktree cut from the submodule prints the same common dir.

Build, in `plot_repo_root` only:

1. Keep the order: an exported answer through `plot_given_common_dir`, else `git rev-parse --path-format=absolute --git-common-dir`, resolved with `pwd -P`.
2. When the physical common dir's last segment is not `.git`, read `git --git-dir="$common" config --get core.worktree`. When it prints a value, the answer is `cd -- "$common/$wt" && pwd -P`. When it prints nothing, or the `cd` fails, the answer is today's `dirname`.
3. A normal checkout (last segment `.git`) spawns no extra process. `plot-worker-state.sh` sources this file in every per-desk probe, so a second `git` call per probe is the cost the plan refuses.
4. `plot_desk_root` needs no edit: it receives `plot_repo_root`'s answer, and a submodule's desks then go under `<workspace>/app/web/.worktrees`.

The plan is canonical; this is orientation.

### Settled decisions — do not re-derive

- **The shell duplicates the rule, and declares it.** Rejected: asking the domain bundle from `plot_repo_root`. `plot-worker-state.sh` runs it once per agent per pass, which `CLAUDE.md` › *A Shell Script Asks The Domain* assigns to a declared duplicate (`node -e ''` starts in 34 ms; a probe pays that per desk). Wave 2 adds the corpus test that holds the pair, so do not add a TypeScript rule or a corpus file in this branch.
- **`core.worktree`, not `--show-toplevel`.** `--show-toplevel` answers the desk inside a linked worktree, the 2026-09-10 failure recorded at `plot-reap.sh:440-447`. A submodule's linked desk shares the common dir, so `core.worktree` answers the main checkout from anywhere, as `dirname` does today.
- **`plot_given_common_dir` needs no change.** A submodule's `.git` file names `../../.git/modules/app/web`, which is not under `worktrees/`, so the exported answer is refused and git is asked, as today. Do not widen it.
- **Absent is not false.** A common dir that is not `.git` and carries no `core.worktree` (a bare clone, a worktree of a separate-git-dir repo) keeps today's `dirname` answer. Do not turn it into an error.
- **Physical paths.** The answer goes through `pwd -P`. On macOS the fixture's temp root is `/private/var/...`, and a logical path never prefixes a path `git worktree list` prints.

### Open questions the plan hands to this slice

- `[question-other-readers]` `git grep` counts 9 shell scripts that read `--git-common-dir` (among them `plot-agent-settings.sh:78`, `plot-host.sh:2883`, `plot-board-probe.sh:290`, `plot-install-commit-record.sh:42`, `plot-worker-state.sh:157,519`). List each one's use in the PR body. A reader that derives a checkout path (`dirname` or `/..` of the common dir) moves to `plot_repo_root`. A reader that only locates a file under the common dir stays.
- `[question-host-env]` The issue says `plot-host.sh` looks for its fallback `.env` in the wrong place. Cover it where `plot-host.sh:2883` derives the path from the common dir. Otherwise name it in the PR body as a separate issue.
- `[question-test-fixture]` Build the real submodule fixture with `git -c protocol.file.allow=always submodule add`, in a `mkdtempSync` root, in `test/reconcile/desk-root.test.mjs`.

### Done when

The plan's `Done when` for this slice is the specification: in a submodule fixture `plot_repo_root` prints the submodule's working tree and `plot_desk_root` a path under it; `plot-fleetctl.sh --status` in the fixture does not print "not part of the estate"; a normal checkout and a linked desk answer as before. Lift these assertions, because a naive implementation passes without them:

- **A desk of the submodule answers the main checkout, not the desk.** Run `plot_repo_root` from a linked worktree cut from the submodule's working tree. An implementation that reads `core.worktree` from the desk's own gitdir, or uses `--show-toplevel`, answers the desk.
- **A normal checkout and a normal desk still answer the checkout.** An implementation that always reads `core.worktree` passes the submodule case and breaks a repository that sets `core.worktree` for another reason.
- **The path is physical.** Assert against `fs.realpathSync` of the fixture root, as `makeRepo` does.
- **`fleetctl.test.mjs` asserts the exit code, not only the missing text.** `--status` in the fixture exits with the status a normal checkout gives. `doesNotMatch(/not part of the estate/)` alone also passes when the command crashes earlier.

Plus: this slice changes only shell, a test and perhaps `plot-host.sh`, so `pnpm build:board` is not needed and no bundle belongs in the diff (`scripts/check-no-bundle-diff.sh`). Add a changeset for `plot` (`patch`) with the description first and the `bumps:` block last; `./scripts/check-changeset-packages.sh` checks it. For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run the whole `test/reconcile/*.test.mjs` glob that the command prints, not only `desk-root.test.mjs`. Do not run `pnpm run test:e2e` locally.

**Shell gate.** `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice adds the `core.worktree` arm to `plot-desk-root.sh`, so it removes at least as many commands elsewhere in the same change; the plan names `plot-desk-root.sh`'s own comments or other shell. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override. Run `./scripts/check-shell-lines.sh pr` before you push.

### Bookkeeping

- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Push the first real commit as soon as it exists.
- Commit subject: `plot-fleetctl: …` or `plot: …` per `CLAUDE.md` › Commit Conventions.

### Scope guard

This branch owns `skills/plot/scripts/plot-desk-root.sh` (`plot_repo_root` and the comments it pays from), `test/reconcile/desk-root.test.mjs`, `test/reconcile/fleetctl.test.mjs`, a changeset, and any of the nine `--git-common-dir` readers the first step moves to `plot_repo_root`.

In flight: `bug/the-state-home-reads-core-worktree` (wave 2) owns `packages/domain/src/rules/state-home.ts`, the new `rules/main-checkout.ts`, `adapters/main-checkout.ts`, `adapters/state-home/state-home-git.ts` and `packages/domain/corpus/main-checkout.corpus.test.ts`. Touch none of them. Branch `bug/every-state-reader-asks-one-state-home` (the sibling plan's wave 5) works on `adapters/main-checkout.ts` too, so a collision there is wave 2's to resolve, not this branch's.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
