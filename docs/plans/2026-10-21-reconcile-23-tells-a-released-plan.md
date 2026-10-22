# Reconcile §23 tells a Released plan to release, and reads a window of open issues

> Section 23 of `plot-reconcile-scan.sh` prints one hint for every finished plan and finds open issues through a 200-issue window. The hint follows the plan's phase and the tracker config, and the section looks up the keys the plans name.

## Status

- **State:** Delivered
- **Type:** bug
- **Sprint:**
- **Issue:** #2283
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2287 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/reconcile-23-tells-a-released-plan`
- **Delivered:** 2026-10-21

## Changelog

- `/plot-reconcile` section 23 no longer tells a Released plan to release. For a Released plan whose issue is still open, it names the cause: the tracker declares no released status, or the issue waits in a tracker status Plot does not own.
- Section 23 asks the tracker about the issues the plans name, not about a window of open issues, so an open issue past the 200th row is found.

<!-- Board impact: none. The change touches one reconcile scan section and its printed text. The plan format, the template and the docs/plans layout stay as they are. -->

## Motivation

On ewz-kus-portal (main `b33d3ee22`, field test round 6), section 23 printed `decide: release the plan to close it through the tracker…` for five plans that are already Released: EWZKUS-3845, 3871, 3877, 3874 and 3876. The hint is wrong for those plans: a release has already happened, and the project declares no `Tracker released status`, so another release does not close the issue either. The reader gets an instruction that cannot work.

Section 23 also lists all open project issues to check eight keys. The list stops at 200 (`PLOT_ISSUE_LIMIT`) and prints a "raise PLOT_ISSUE_LIMIT" note. An open issue outside that window reads as closed, so the section can miss a finding it exists to report.

## Design

### Approach

Location: `skills/plot/scripts/plot-reconcile-scan.sh:3145` prints the `decide:` line for every phase; the window read is at `:3100` (`issue-list --paged --limit`).

1. **Hint by phase and config.** The `decide:` line reads the plan's phase (`oi_phase`) and `Tracker released status` (`plot-config.sh get`).
   - Delivered plan: the existing hint stays (release the plan, close the issue by hand, or record why it stays open).
   - Released plan, no `Tracker released status` declared: the line says the tracker has no released status configured, so a release does not move the issue.
   - Released plan, status declared, issue still open: the line says the issue waits in a tracker status Plot does not own, and names the declared status.
2. **Lookup by key, not by window.** Section 23 asks the tracker for the keys the finished plans name (`plot-host.sh issue-view <key>` per key, or one keyed query where the backend has one) and reads the state of each. The 200-row limit and its note go away for this section. A key the tracker cannot answer is reported as unchecked, never as closed.
3. **Backends.** GitHub, Bitbucket and Jira answer through `plot-host.sh`. Each arm reports its own failure by name, as the section does today (exit 4 = no tracker to ask).

### Open Questions

- [ ] Does `issue-view` answer for a closed issue on every backend? The header of `plot-host.sh` describes it as "ONE open issue". If it does not, the lookup needs a state-aware read, which may be a `plot-host.sh` change.
- [ ] One call per key costs N host calls for N plans. Does a plan set of this size (8 keys on ewz-kus-portal) justify a batched read, or does the per-key cost stay inside the rate-limit budget? Measure before choosing.
- [ ] Does `plot-issue-status.sh` already answer "which tracker status holds this issue?" so the scan can reuse it rather than add a second reading?

## Slices

### Hint and lookup

- `bug/reconcile-23-tells-a-released-plan` — phase-aware hint and key-based lookup in section 23, with tests in `test/reconcile/` — PR #2302 <!-- builds: section 23 phase-aware hint, key-based issue lookup --> → #2302

## Notes

- Raised by the read-only ewz field test, round 6, as issue #2283 (https://github.com/plot-pm/plot/issues/2283).
- Deliverable search found no existing artifact for a phase-aware section 23 hint or a keyed lookup.
