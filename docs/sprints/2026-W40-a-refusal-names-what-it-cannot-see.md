# Sprint: A refusal names what it cannot see

> Eight defects that share one shape: something answers *no* when the honest answer is *I could not tell*. A throttled host reads as a missing PR, a record written inside a comment reads as an approval nobody gave, a gate installed at a path that does not exist reads as a gate, and a wave with every branch claimed reads as one you can start.

## Status

- **State:** Planning
- **Start:** 2026-09-25
- **End:** 2026-10-09
- **Release:** 2.22.0

## Sprint Goal

**Where Plot cannot establish something, it says so — and where it prescribes a repair, the repair is the one that helps.**

Four of these were reported from repositories other than this one, and none was reproducible here until it was reproduced deliberately. The estate already writes the rule down in three places — *absent is not false*, `ok`/`failed`/`unknown` rather than a boolean, a status field beside a value — and these are the callers that do not read it.

### Must Have

- [ ] [the-board-shows-me-only-my-work](../plans/2026-09-24-the-board-shows-me-only-my-work.md) — [#967](https://github.com/plot-pm/plot/issues/967). WAITING ON YOU collects plans, branches, PRs and build states across a dozen verdicts and presents them as one list, while a reader arrives with one of three questions: what should I pick up, what finished, what is broken. Measured on a Bitbucket repository with a clean estate (`drift=0 attention=0`): **18 rows, 2 actionable.**
- [ ] [two-readers-disagree-about-a-sprint-item](../plans/2026-09-24-two-readers-disagree-about-a-sprint-item.md) — [#966](https://github.com/plot-pm/plot/issues/966). Planned 2026-09-24, and the plan found more than the issue reports: `MEMBER_LINE` (`entry/sprint-transition.ts:64`) requires a second bracket, so a bare item never becomes a `SprintItem` at all, while `plot-sprint-release.sh` matches the checkbox alone and reads the same lines as two open Musts. **Two readers, one file, opposite answers** — and the naive fix keeps 2 of 3 items because bare items collide on an empty dedup key.
- [ ] [adoption-notices-a-stale-default-branch](../plans/2026-09-24-adoption-notices-a-stale-default-branch.md) — [#971](https://github.com/plot-pm/plot/issues/971). The probe reads `origin/HEAD` and never asks the host, so a clone whose default moved reads every plan from the wrong ref while adoption reports it healthy.
- [ ] [a-merged-pr-is-not-asked-for-its-checks](../plans/2026-09-25-a-merged-pr-is-not-asked-for-its-checks.md) — the fleet scan asks GitHub for `statusCheckRollup` on 957 pull requests, of which **920 are merged and 3 are open**. A merged PR's checks cannot change, so the call re-fetches settled CI results every pass. Measured 2026-09-25: **20.8 s with the rollup against 0.6 s asking only the open ones** — 38% of a 54-second scan, and the reason two boards wedged today under a 4-second fleet cadence. Git is 5% of that scan and is deliberately left alone.
- [ ] [a-plugin-install-finds-its-own-scripts](../plans/2026-09-25-a-plugin-install-finds-its-own-scripts.md) — [#980](https://github.com/plot-pm/plot/issues/980). Scripts assume Plot is vendored at `<repo>/skills/plot/`, which a plugin install does not have. One of the three sites shipped as #986; the two live ones fail differently and the first fails **silently** — `plot-install-hooks.sh:145` writes gate paths that do not exist, so every gate permits, and `--verify` reports `verified` because it tests a sibling rather than the path it wrote.
- [ ] [a-throttled-host-is-not-a-missing-pr](../plans/2026-09-25-a-throttled-host-is-not-a-missing-pr.md) — [#985](https://github.com/plot-pm/plot/issues/985). `plot-approve.sh:230` collapses every non-zero exit into `state: NONE`, so a rate-limited read reports *no PR found* about an open PR and prescribes pushing a branch already pushed. The vocabulary exists — `plot-host.sh:401` defines exit 5 as *the host refused to answer FOR NOW* — and the caller discards it.
- [ ] [a-record-is-written-where-it-can-be-read](../plans/2026-09-25-a-record-is-written-where-it-can-be-read.md) — [#981](https://github.com/plot-pm/plot/issues/981). `plot-approve` writes the `Approved:` record inside the template's HTML comment, where `plot-plan-meta.sh` cannot read it. Reproduced against the shipped template: the record lands between `<!-- Transition records` and `-->`, and the parser answers `approved_raw: ""`. It fires on a first approval in a new repository and nowhere else.
- [ ] [one-word-answers-two-questions-about-a-wave](../plans/2026-09-25-one-word-answers-two-questions-about-a-wave.md) — [#994](https://github.com/plot-pm/plot/issues/994). The scan prints a wave `eligible` while its own footer reads `eligible=0` and both offer paths answer nothing at exit 0. Reproduced here: the body means *prerequisites met*, the counter means *a branch can be claimed*, and one word carries both. `--next` reporting nothing with the exit code for success is what a caller trips on.

- [x] [a-stale-pulse-keeps-the-sections-it-had](../plans/2026-09-25-a-stale-pulse-keeps-the-sections-it-had.md) — [#995](https://github.com/plot-pm/plot/issues/995). A failed scan re-derives section membership from the pulse its own banner calls stale, so a slice dispatched since then — `ahead = 0` because it has no commits, not because they landed — renders as `delivered · merged`. Measured: five approved, unstarted plans under DONE with no PR and no code on main. The estate already argues the rule for a board that never scanned (*"the sections are SUPPRESSED rather than filled"*); this is the warm case it does not cover.

- [ ] [a-sandbox-does-not-inherit-its-host](../plans/2026-09-26-a-sandbox-does-not-inherit-its-host.md) — [#1000](https://github.com/plot-pm/plot/issues/1000). A contract test that sandboxes a repository writes its agent manifest into the HOST registry, because `PLOT_REPO_ROOT` travels in the environment from a dispatched worker into the suite it runs. Measured: **19 of 20 manifests were test fixtures** against three real desks, and the board rendered each as an agent. `2 of 93` reconcile tests scrub the variable; neither of the two that leak does. One slice: scrub the variable. A second, sweeping the orphaned manifest, was proposed and **rejected by the panel** — `plot-reap.sh:690-718` has done exactly that since #474 on 2026-08-27, and more simply than the proposal.

### Should Have

<!-- add items here -->

### Could Have

<!-- add items here -->
<!-- add items here -->

### Deferred

<!-- Items moved here during sprint when they won't make the timebox -->

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Log scope changes here: added/removed items, tier changes, with date and reason -->
<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

<!-- Session log, decisions, links -->
