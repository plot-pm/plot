# A dead desk gets a fixer or a restart

> When a desk's fresh session has also failed, fleetd starts the fixer role on the slice instead of asking a person, and a claimed desk with no live worker and no PR is restarted through the `restart` controller with fleetd as the declared caller.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #2906
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches

## Changelog

- When the one fresh session that a spent correction budget gets has also failed, fleetd starts the fixer role on the slice. A person is no longer asked.
- fleetd restarts a claimed desk that has no live worker and no pull request through the `restart` controller. The controller lifts its unattended refusal only for fleetd's declared caller.

<!-- Board impact: none to the plan format, template or docs/plans layout. The row of a desk that waits for a fixer or a restart reads its state from a domain property, so the board shows the step without new logic in a component. -->

## Motivation

The spec's section *A dead or stuck desk* ([DESIGN-delivery-loop.md](../stories/the-fleet-delivers-a-scope-alone/DESIGN-delivery-loop.md), approved by jwloka on 2026-10-29) names two stops that still wait for a person:

- `rules/fresh-agent.ts` gives a slice that spent its correction budget one fresh session. When that session also fails, the second failure asks a person.
- `restart` refuses an unattended caller. A claimed desk with no live worker and no pull request therefore waits for a person, although `PLOT-BLOCKED` is not involved.

In the session of 2026-10-16 to 2026-10-29 the master agent started a fix agent for every red PR whose desk was dead or out of corrections (spec, *Intent*). The story's goal 1 is that only the release waits for a person. These two stops break that goal.

## Design

### Approach

Both behaviours are domain rules that read recorded state. fleetd's tick selects the step; an agent only does the work (spec goal 4).

**Fixer start.** A rule reads the desk's fresh-agent record (`ports/fresh-agent-record.ts`) and the attempt count from #2903. Where the fresh session has failed and fewer than two fixer attempts ran, the rule answers *start the fixer*. The start goes through the existing `agent-run` port with the role name `fixer` (#2898). The spec fixes two fixer attempts per PR, matching the correction budget. After both fail, the PR merges with the HIGH finding ticketed, which belongs to a later plan of the story, and the stall rule notifies the person.

**Restart.** A rule answers *restart* for a claimed desk whose worker is `failed`, `ended` or `none`, which has no pull request and no `PLOT-BLOCKED` marker. fleetd calls the `restart` controller (`packages/board/src/server/restart.ts`, `dispatch-verbs.ts`) with a declared caller identity. The controller reads `PLOT_UNATTENDED` today and refuses (`dispatch.ts:42`). It lifts that refusal only for fleetd's identity from #2898, and keeps it for every other unattended caller. Its other refusals stay: open or merged PR, unanswerable PR check, live loop, `PLOT-BLOCKED` marker.

**Layering.** The rules live in `packages/domain/src/rules/`. The tick in `packages/fleet` reads the records and calls the controllers. No new shell: the line ratchet in `scripts/check-shell-lines.sh` applies.

**Vocabulary.** The code says Agent for the actor and Slice for a branch. It adds nothing to the `Wave` defect.

### Open Questions

- [ ] Does a restart count as a fixer attempt? Recommendation: no. A restart replaces a dead worker on the same session history; a fixer attempt is a second kind of work on a failing build.
- [ ] Which record holds the fixer attempt count? #2903 decides the file shape; this plan reads it and adds no second store.
- [ ] How long must a claimed desk have no live worker before fleetd restarts it? A short bound can race a worker that is still starting. Recommendation: reuse the `Claim stale after` reading the reaper uses, and measure it before approval.
- [ ] Does the fixer start on a desk whose worktree is gone (`elsewhere`)? Recommendation: no. The state means another machine owns the worker.

## Slices

This plan needs #2898 (role definitions, the role-aware runner, fleetd's caller identity) and #2903 (the fixer runner and the attempt count). No slice below starts before both merge.

### Fixer on a failed fresh session

- `feature/a-failed-fresh-session-starts-the-fixer` — a rule answers *start the fixer* for a desk whose fresh session failed and whose fixer attempts are under two, and fleetd's tick starts it through `agent-run` instead of writing a question <!-- builds: freshSessionFailedFixer, a domain rule that selects the fixer for a failed fresh session -->

### Restart of a dead desk

- `feature/fleetd-restarts-a-claimed-desk-with-no-worker` — a rule answers *restart* for a claimed desk with no live worker and no pull request, and fleetd calls the `restart` controller as its declared caller <!-- builds: deadDeskRestart, a domain rule that selects a restart for a claimed desk with no live worker -->

## Notes

- Raised from issue #2906. The issue is the problem statement; the spec binds the design.
- The two slices touch different rules and can run in parallel once #2898 and #2903 merge.
