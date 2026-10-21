# Fleet work leaves the main checkout dirty and behind its HEAD

> A desk writes only inside its own worktree, and nothing that moves `main` leaves the board's checkout showing older content than its `HEAD`.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2311
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- Fleet commands no longer write scratch files into, or move `HEAD` of, the operator's main checkout.

<!-- Board impact: the board reads the main checkout, so a dirty or lagging tree shows delivered plans as in progress. The fix changes helper scripts under skills/plot/scripts/ and may change what the board reads; no plan-format change. -->

## Motivation

On 2026-10-21 at 23:44 CEST the main checkout held uncommitted changes in 22 tracked files and 10 untracked files that nobody made by hand (issue #2311):

- Seven scratch copies of `skills/plot/scripts/plot-reconcile-scan.sh` (`.tmp`, `.tmp2`, `.tmp3`, `.new`, `.final`, `.after`, and `plot-reconcile-scan.sh.orig` at the repository root), written 22:29–22:35, plus an edited `plot-reconcile-scan.sh`. The edit was an early draft of the §23 per-key lookup that PR #2302 (#2283) later merged from its own worktree.
- Tracked files at older content than `HEAD`: `packages/domain/src/rules/sprint-release.ts` matched `ce26b5303` (before PR #2300), three delivered plans read `State: Approved`, and three `.changeset/` files and three `docs/plans/delivered/` links were missing. The board showed delivered plans as "in progress".
- The reflog of the main checkout shows bookkeeping commits made in it between 23:34 and 23:39 (`plot: append PR #2302 …`, `plot: append PR #2310 …`, then `reset: moving to HEAD~1`, then the same commit again).

The operator saved the changes to a patch outside the repository, ran `git checkout HEAD -- .` and fast-forwarded. No merged work was lost.

Two defects share one symptom:

1. A desk process wrote into the main checkout instead of its own worktree.
2. Some command moved `HEAD` of the main checkout without updating its working tree.

## Design

### Approach

Measure first. Neither writer is identified yet.

1. **Find the scratch writer.** Reproduce the desk for #2283 and record its `PLOT_REPO_ROOT` and CWD. A desk whose CWD or `PLOT_REPO_ROOT` names the main checkout, or a script that resolves the repository root through `git rev-parse --git-common-dir` rather than `--show-toplevel`, would write there.
2. **Find the `HEAD` mover.** Read the ref updates in `plot-push-main.sh` and in the PR-number append of `plot-open-pr.sh` and `plot-dispatch.sh` (the bookkeeping branch at `plot-dispatch.sh:3369`). A `git reset`, `update-ref` or `branch -f` on the checked-out branch changes `HEAD` and leaves the tree behind.
3. **Fix at the writer.** Each writer resolves its target worktree explicitly and refuses to write to a checkout it was not launched in. Where a command must advance `main`, it either updates the tree with the ref (`git merge --ff-only`) or does not touch a checked-out branch.
4. **Add a gate.** A contract test runs the fleet commands against a sandbox repository and asserts that the main checkout's `git status --porcelain` is empty and `HEAD` matches its tree afterwards. This is a gate, not a rule: the check fails without the agent's cooperation.

Manifesto check and layering: any new decision about which checkout a command may write goes through the domain and its port, not a new shell rule (see *The Layering Rule* and *The Master Agent Uses The Controllers* in `CLAUDE.md`).

### Open Questions

- [ ] Which process wrote the seven scratch copies: the #2283 desk, or a sibling tool run from the main checkout?
- [ ] Which command moved `HEAD` without the tree: `plot-push-main.sh`, the PR-number append in `plot-open-pr.sh`, or a reset in the board's `ladder.ts` bookkeeping path (`ladder.ts:176`)?
- [ ] Should a command that finds the main checkout dirty refuse, or work in a disposable worktree (the way `plot-dispatch.sh` already does for its bookkeeping branch)?
- [ ] Should the board warn when its checkout is dirty or behind `origin/main`?

## Slices

### Measurement

- `bug/main-checkout-writers-measured` — reproduce the #2283 desk and the bookkeeping appends in a sandbox; name the process that writes scratch files and the command that moves `HEAD` without the tree, with the evidence in the PR.

### Fix

- `bug/main-checkout-stays-clean` — fix each named writer and add the sandbox contract test that asserts a clean, consistent main checkout after the fleet commands. <!-- builds: a sandbox contract test asserting the main checkout is clean and consistent --> <!-- waits: bug/main-checkout-writers-measured -->

## Notes

- Source: issue #2311, observed 2026-10-21. The plan links to the issue one way; nothing is written to the tracker.
- Definition of Done: docs/definition-of-done.md
