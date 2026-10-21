## Implementation brief — fleet-work-leaves-the-main-checkout (wave 1: Measurement)

- **Plan (canonical):** `docs/plans/2026-10-21-fleet-work-leaves-the-main-checkout.md` on `main`
- **Approved:** 2026-10-22, Jan Wloka, plan-PR #2312 merged
- **Branch:** `bug/main-checkout-writers-measured` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave blocks wave 2, `bug/main-checkout-stays-clean`: the fix slice waits on `bug/main-checkout-writers-measured` merging, because it fixes the writers this slice names. Do not fix any writer here.

### What to build

A measurement, not a change to shipped behaviour. On 2026-10-21 (issue #2311) the operator's main checkout held 22 modified tracked files and 10 untracked files nobody wrote by hand, and its reflog showed bookkeeping commits followed by `reset: moving to HEAD~1`. Two writers are unnamed: the process that wrote seven scratch copies of `plot-reconcile-scan.sh` (plus `plot-reconcile-scan.sh.orig` at the repository root), and the command that moved `HEAD` of the main checkout without updating its tree. This slice names both, with evidence in the PR body, so wave 2 fixes a known line instead of a guess.

Deliverable: a sandbox reproduction (a script or test under `test/reconcile/` that wave 2 can promote into its gate) and a PR body that answers the plan's two measurement Open Questions with the command, the file and line, and the observed `git status --porcelain` and reflog output. Answer them in the plan's `### Open Questions` as well.

The plan is canonical; this is orientation.

### Candidates the plan names — verify, do not assume

**Scratch writer.** A desk whose CWD or `PLOT_REPO_ROOT` names the main checkout writes there. A script that resolves the root through `git rev-parse --git-common-dir` rather than `--show-toplevel` lands in the main checkout from inside any worktree, because the common dir sits under the main checkout. Start with `grep -n 'git-common-dir' skills/plot/scripts/*.sh`, then ask which of those hits writes a file rather than reads one. Reproduce the desk for #2283 and record its `PLOT_REPO_ROOT` and CWD at launch.

**`HEAD` mover.** Three places are named: `plot-push-main.sh`, the PR-number append in `plot-open-pr.sh`, and the bookkeeping branch in `plot-dispatch.sh` (around `:3369`). `packages/board/src/server/entry/ladder.ts:176` is the fourth: its retry path calls `ctx.trees.resetBranch(tmpwt, bookbr, ...)` at `:201`, in a temporary worktree (`tmpwt`) — which is the safe shape, so confirm it never resets the checked-out branch of the main checkout. A `git reset`, `update-ref` or `branch -f` on the branch the main checkout has checked out moves `HEAD` and leaves the tree behind. Run each candidate in a sandbox with the main checkout on `main`, and read `git reflog` and `git status --porcelain` after each.

**Rules carried over from this repo's measurements.** Read the exit code, not the emptiness of the output. A candidate that shows no change in one run is not cleared; name the condition (a retry, a race with a merge) under which it was tried. Do not run `plot-dispatch.sh` by hand to test it — the controller gate refuses it; reproduce through `plot-dispatch-command.mjs` in the sandbox, or read the code and say which you did.

### Done when

The plan's slice line is the specification: *name the process that writes scratch files and the command that moves `HEAD` without the tree, with the evidence in the PR.* Lift these assertions, each of which a naive pass would skip:

- Each named writer has a **reproduction that fails on `main` today** — a claim read from the source alone does not count, because the plan's own candidate list was written before anyone ran it.
- The PR names **which candidates were cleared** and by what run, so wave 2 does not re-measure them.
- The reproduction asserts both halves — `git status --porcelain` is empty AND `HEAD`'s tree equals the working tree (`git diff HEAD --quiet`) — because the two defects have different symptoms and one assertion passes the other's failure.

Plus the repo's gates: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. If the slice touches a `.sh` file, `scripts/check-shell-lines.sh` refuses a net increase in shipped shell under `skills/` — put the reproduction in `test/reconcile/` and write no new shell under `skills/`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `test/reconcile/` additions and the plan's `### Open Questions` answers. It changes no file under `skills/plot/scripts/` and none under `packages/`: the fixes belong to `bug/main-checkout-stays-clean`, which waits on this one. The other in-flight work near these files is `docs/plans/2026-10-21-*` plans — check `git log origin/main -5 -- skills/plot/scripts/plot-push-main.sh skills/plot/scripts/plot-open-pr.sh` before you start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
