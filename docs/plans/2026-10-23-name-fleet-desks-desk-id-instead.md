# Name fleet desks desk-<id> instead of free-<id>

> A new fleet desk is a worktree named `desk-<id>`; existing `free-<id>` desks keep their names and stay recognised.

## Status

- **State:** Released
- **Type:** infra
- **Sprint:** bugfix-2-28-1
- **Issue:** #2375
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2376 merged
- **Started:** 2026-10-23, Jan Wloka, `infra/name-fleet-desks-desk-id-instead`
- **Delivered:** 2026-10-23
- **Released:** 2026-10-23, v2.28.1
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- Fleet desks created from now on are named `desk-<id>` in place of `free-<id>`, so a desk that holds a slice no longer reads as free.

Board impact: none expected. The board reads a desk by its `.plot-worker.pid` file, not by its directory name. The test fixtures that carry `free-<id>` session strings need a check (see Open Questions).

## Motivation

Every fleet desk is a worktree named `free-<id>`, for example `.worktrees/free-eaee9638`. The name stays after the desk takes a slice, so a desk that works on `bug/release-gate-names-an-unfinished-must` still reads as free. The code and docs call these worktrees desks (`rules/reapable.ts`, `plot-desk-dirt.sh`, reconcile section 21). The directory name disagrees with the vocabulary.

## Design

### Approach

`skills/plot/scripts/plot-dispatch.sh:2566` is the one place that names a desk: `start_wt="$wt_root/${wt_prefix}free-$(plot_session_id | cut -c1-8)"`. Change `free-` to `desk-` there.

Existing `free-<id>` desks keep their names. Renaming a live worktree breaks its worker's pid, manifest and claim. The reaper removes them over time.

The issue reports that no reader matches the prefix: the reaper, reconcile and the registry recognise a desk by its `.plot-worker.pid` file, and the other `free-` hits in the code are comments that quote measured paths. The implementation slice re-checks this with a grep before it changes the line, and a reader that does match the prefix must accept both `desk-` and `free-`.

### Open Questions

- [ ] Several board test fixtures use `session: 'free-04e1f562'` and `worktree: '/wt/free-ended'`. Does any code derive a session id from the worktree directory name? If so, the fixtures stay valid for old desks and one test needs a `desk-` case.
- [ ] Does any test assert the `desk-` or `free-` name of a dispatched worktree? The issue states none does. The slice confirms it and adds one test that a new desk is named `desk-<id>`.

## Slices

### Rename

- `infra/name-fleet-desks-desk-id-instead` — name new desks `desk-<id>` in `plot-dispatch.sh`, keep `free-<id>` desks recognised, add a test for the new name → #2388

## Notes

- Source: tracker issue #2375. The plan stops at Draft; approval is a separate decision.
- Review `pr` follows from `Plan PRs: required`. Impl `own branches` follows from the plan PR merging before the slice branch starts.
