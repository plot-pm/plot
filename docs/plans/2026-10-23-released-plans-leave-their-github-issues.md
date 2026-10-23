# Released plans leave their GitHub issues open and the board lists them as assigned

> Recording a plan as Released closes the GitHub issues it names, and the board stops listing a released ticket as assigned work.

## Status

- **State:** Approved
- **Sprint:** bugfix-2-28-1
- **Type:** bug
- **Issue:** #2355
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-23, Jan Wloka, plan-PR #2361 merged
- **Started:** 2026-10-23, jwloka, `bug/released-plans-close-their-github-issues`

## Changelog

- Recording a plan as Released on a GitHub tracker closes the issues it names, unless another unfinished plan names the same issue. The release summary reports how many issues it closed and how many it left open, with the reason for each.
- The board no longer lists an issue under *Assigned to you* when every plan that names it is Released.

<!-- Board impact: yes. The *Assigned to you* rows (`packages/board/src/app/lib/agent-rows/waiting-view.ts`) change their filter. The plan format does not change. -->

## Motivation

After `/plot-release 2.28.0` on 2026-10-22, 65 plans read `State: Released` and 63 of the issues they name were still open on GitHub. The board listed them under *Assigned to you* with the phase "released". Somebody closed the 63 issues by hand, each with a comment naming v2.28.0.

Every `plot-deliver.sh --release` run ended `tracker=skipped`, and `plot-issue-status.sh` ended `summary: tracker=none`. This repository declares no `Tracker released status`, and `issueStatusWrites` (`packages/domain/src/rules/issue-status.ts`) owes no write when that key is empty. On a GitHub tracker, `githubPlanStateWrite` (`packages/domain/src/adapters/tracker/tracker-plan-state.ts:78`) closes an issue for the `released` phase without reading the key, so the two paths disagree about what Released owes a GitHub issue.

## Design

### Approach

1. **Close on release.** On a GitHub tracker, the release path calls the plan-state write for `released` even when `Tracker released status` is empty. The key keeps its meaning for trackers that need a status word. The write skips an issue that another plan, not yet Released, also names.
2. **Release summary.** `plot-deliver.sh --release` prints how many issues it closed and how many it left open, and names the reason for each left open (another plan unfinished, no issue number, tracker unaskable, write failed).
3. **Board filter.** The *Assigned to you* rows drop an issue when every plan that names it is Released. The decision belongs in the domain, as a property the view reads (CLAUDE.md, *Every rendered state is a domain property*).

### Open Questions

- [ ] Why does `tracker=skipped` appear on a repository that declares no `Tracker` key? Does the git-host-issues fallback (`trackerGitHost`) reach `planStateWrite`, or does the release path return before it?
- [ ] Should the close write run when `Tracker` is declared as something other than GitHub and `Tracker released status` is empty? The expectation in #2355 names GitHub only.
- [ ] Does the issue-inbox view also need to hide the issue, or only *Assigned to you*? The issue says only the latter.

## Slices

### Close on release

- `bug/released-plans-close-their-github-issues` — the release path closes issues on a GitHub tracker without `Tracker released status`, skips an issue another unfinished plan names, and reports closed and left-open counts in the summary <!-- builds: a rule deciding which issues a release closes, and the closed/left-open summary line --> → #2373

### Board filter

- `bug/board-hides-released-issues-from-assigned` — the *Assigned to you* rows omit an issue whose plans are all Released <!-- builds: a domain property for an issue's remaining unfinished plans -->

## Notes

- Source: https://github.com/plot-pm/plot/issues/2355
- Measured 2026-10-22: 63 of 65 released plans had an open issue after `/plot-release 2.28.0`.
