# Sprint: The fleet runs through its limits

> Three defects that stop an unattended fleet when something outside Plot pushes back: a throttled host, a harness usage limit, and an agent that outlives the command that started it.

## Status

- **State:** Active
- **Start:** 2026-10-01
- **End:** 2026-10-08
- **Release:** 2.22.3

## Sprint Goal

**An unattended fleet keeps working through a throttled host, a usage limit and a long-lived agent, and names each one for what it is.**

All three were found by operating the fleet on 2026-10-01, two of them on a Bitbucket estate. Each turns an external condition into a stopped fleet: a 429 holds every wave because a merge cannot be proven, a usage limit reads as a broken prompt, and `--start` blocks its caller for the agent's whole life.

### Must Have

- [ ] [a-merge-subject-proves-a-landing-the-host-cannot](../plans/2026-10-01-a-merge-subject-proves-a-landing-the-host-cannot.md) — [#1139](https://github.com/plot-pm/plot/issues/1139) — **A merged-and-deleted branch is proven from its merge commit.** Under a throttled host the wave gate cannot prove a merge and holds every dependent slice. A panel answered `amend` on 2026-10-01: add Bitbucket's anchored `Merged in <branch> (pull request #N)` subject to the scan's existing merge-subject detection, chosen by backend, for the wave gate only and never for a destructive decision. Measured: 122 of 200 merges found, 0 false positives.
- [ ] [a-usage-limit-is-not-a-broken-prompt](../plans/2026-10-01-a-usage-limit-is-not-a-broken-prompt.md) — [#1141](https://github.com/plot-pm/plot/issues/1141) — **A usage limit is not a broken prompt.** The worker loop retries three times at once and writes a `PLOT-BLOCKED` that prescribes fixing the prompt file. Measured on 2026-10-01: a desk-root worker hit the limit, failed, and sat free with unpushed commits.
- [ ] [a-start-returns-while-its-agent-runs](../plans/2026-10-01-a-start-returns-while-its-agent-runs.md) — [#1144](https://github.com/plot-pm/plot/issues/1144) — **`--start` returns while its agent runs.** Two dispatchers measured asleep with their wrapper as child, for 4 h and 10 min, from two installs. `/plot-fleet --start` and `--start-agents` both go through it.

- [ ] [an-open-board-follows-a-sprint-change](../plans/2026-10-01-an-open-board-follows-a-sprint-change.md) — [#1145](https://github.com/plot-pm/plot/issues/1145) — **An open board follows a sprint change.** A page loaded under the previous sprint kept filtering on it after the sprint closed, hid the new sprint's six slice rows, and showed «Sprint only» unchecked until a reload. Measured 2026-10-01.
- [ ] [waiting-on-you-counts-tickets-as-tickets](../plans/2026-10-01-waiting-on-you-counts-tickets-as-tickets.md) — [#1146](https://github.com/plot-pm/plot/issues/1146) — **WAITING ON YOU counts tickets as tickets.** `sectionTally` adds each ticket to both the plan and the slice figure, so 3 plans, 6 slices and 15 tickets read `(18 plans · 21 slices)`.

### Should Have

### Could Have

### Deferred

## Retrospective

<!-- Filled during /plot-sprint close: What went well / What could improve / Action items -->

## Notes

### Scope Changes

<!-- Format: - YYYY-MM-DD: Added/Moved/Removed [slug] reason -->

- 2026-10-01: Added #1145 and #1146 to Must — two board defects found while reading this sprint on the board; the operator asked for both in 2.22.3. Neither has a plan yet.
