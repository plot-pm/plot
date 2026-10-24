# Recording a slice PR number writes the plan into the main checkout without committing there

> The process that records a slice's PR number on its plan writes the plan file into the operator's main checkout while committing from another tree.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** bugfix-2-28-2
- **Issue:** #2395
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2396 merged
- **Started:** 2026-10-23, Claude, `bug/recording-a-slice-pr-number-writes`

## Changelog

- Recording a slice PR number on its plan writes only in the tree that commits the change; the main checkout stays clean.

<!-- Board impact: none expected. Confirm once the writer is found. -->

## Motivation

On 2026-10-23 at 11:26:28 CEST the main checkout held an uncommitted change to `docs/plans/2026-10-23-bounded-run-group-stop-test-times.md`, after #2311's fix shipped in 2.28.0. The file matched commit `e7928fe9a` (`plot: record PR #2390 for bounded-run-group-stop-test-times`) exactly: the `Started:` line and the `→ #2390` annotation. That commit is on origin. The main checkout's `HEAD` stayed at `6b0e15c75`, and its reflog shows no commit after 10:28. A later `git merge --ff-only origin/main` refused because of the dirty file.

A process wrote the plan file into the operator's checkout and committed and pushed the same content from another tree. The #2311 gate refuses a git write of an unattended run in the main checkout. This write is a plain file write, which that gate does not see. The operator restored the file from `HEAD` and fast-forwarded; nothing was lost.

## Design

### Approach

1. Measure first: identify which process writes the file. Candidates are the PR append in `plot-open-pr.sh`, the board's `record-pr` path, and fleetd. For each, record whether it writes through `$PLOT_REPO_ROOT` or the repository root instead of the worktree it commits from.
2. Reproduce the dirty main checkout in a sandbox repo with a worktree, using the identified writer.
3. Change the writer so the file write and the commit use the same tree.
4. Add a test that fails while the main checkout's tree differs from its `HEAD` after a record-PR run.

Whether the #2311 gate should also see plain file writes into the main checkout is a separate question; the Open Questions list it.

### Open Questions

- [ ] Which process writes the file: `plot-open-pr.sh`, the board's `record-pr` path, or fleetd?
- [ ] Does the writer resolve its path through `$PLOT_REPO_ROOT` or the repository root?
- [ ] Should the #2311 gate cover plain file writes into the main checkout, or is fixing the one writer enough?

## Slices

### Fix

- `bug/recording-a-slice-pr-number-writes` — find the writer and make it write only in the tree it commits from → #2468

## Notes

- Follow-up to #2311.
- Source: https://github.com/plot-pm/plot/issues/2395
