# Tracker issue-status: no-target hides an unreachable status behind the idempotent case

> `plot-host.sh issue-status` prints `no-target` both when the issue already holds the wanted status and when the status cannot be reached from the issue's current state. The two cases need different reports.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2438
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2499 merged
- **Started:** 2026-10-24, jwloka, `feature/tracker-issue-status-no-target-hides`

## Changelog

- Tracker status writes on Jira report `already` where the issue holds the wanted status and `unreachable` (with the current status and the available transitions) where the status exists but no transition leads to it from the current state. The delivery summary no longer reads the same in both cases.

<!-- Board impact: the delivery and approve summaries (`trackerReportOf`, `releaseIssueSummary`) print the outcome word; a new word reaches the board only if the board renders it. To check during implementation. -->

## Motivation

Delivering three plans whose `Issue:` names a Jira key (`Tracker: jira`, `Tracker delivered status: Approving`) printed `tracker: EWZKUS-3893 no-target the tracker holds nowhere to put this status`. The issues sat in `Open` / `Ready for Design`. Their transitions were `Accept Issue`, `Close Issue`, `To Backlog`, `Business Accept`, `Needs Experimentation` and `Reject`, so `Approving` was not reachable in one step.

`plot-host.sh issue-status` looks up one transition by name (`skills/plot/scripts/plot-host.sh:5303`) and prints `no-target` when none matches. That word covers two facts:

1. The issue already holds the status. A repeated write is harmless.
2. The status exists in the workflow but no transition from the current state reaches it. The tracker is out of step with the plan.

Case 2 is the common one when the approve step's `In Progress` write also found no transition. The summary reads the same in both cases, so nobody learns that the tracker is behind.

## Design

### Approach

Separate the two facts in the Jira write, and carry the distinction through the port.

1. In `plot-host.sh issue-status`, when no transition matches, read the issue's current status (`/rest/api/2/issue/<key>?fields=status`) and compare it with the wanted status, case-insensitively, as the transition lookup does. Print `already` on a match. Otherwise print `unreachable`, naming the current status and the names of the available transitions.
2. Extend `StatusOutcome` in `packages/domain/src/ports/tracker.ts` and the Jira connector (`tracker-jira.ts:247`) so the connector maps the new words instead of folding everything that is not `written` into `no-target`.
3. Extend `TrackerWriteOutcome` and `ReleaseSkipReason` in `packages/domain/src/rules/issue-status.ts`, and the summary text, so the report names the case. `unreachable` ranks as a worse outcome than `already` in the worst-last ordering.
4. Keep `no-target` for the cases it already means elsewhere: no issue key, and the GitHub connector's no-board answer.

Out of scope: walking a multi-step workflow to reach the status. That is a separate, larger question; this plan reports the gap honestly.

Naming the current status and transitions in the output makes the message actionable. The `plot-host.sh` header comment for `issue-status` and the DESIGN text that call `no-target` "also what a repeated write reports" change with it.

### Open Questions

- [x] Does `unreachable` fail the delivery summary's exit code, or stay a reported outcome like `no-target`? **Stays a reported outcome.** `plot-issue-status.mjs` returns `EXIT.ok` regardless of per-issue outcome today (`no-target`, `unaskable` and `failed` all do), and `unreachable` joins that set rather than becoming the first outcome to flip the exit code.
- [x] Should the one extra `GET` run only on the no-match path (proposed), so a successful write costs no additional call? **Yes, no-match only** — implemented in `plot-host.sh issue-status`.
- [x] Do the board and approve/deliver endpoints need a rendering for the new words? **No new rendering beyond the two entry scripts.** `packages/board/src/server/entry/issue-status.ts`'s `FALLBACK` table gained `already` and `unreachable` sentences (the live detail comes through `tracker.lastRefusal()`); nothing else in `packages/board` switches on `StatusOutcome` or `TrackerWriteOutcome` words — `plan-state.ts` handles `planStateWrite`'s separate, unchanged `no-target`.

## Slices

### Distinguish already from unreachable

- `feature/tracker-issue-status-no-target-hides` — read the current status on a no-match, report `already` or `unreachable`, and carry both words through the tracker port and the delivery summary <!-- builds: issue-status already/unreachable outcome --> → #2591

## Notes

Source: https://github.com/plot-pm/plot/issues/2438 (plot 2.28.0). Created unattended from the issue; Review and Impl answers are the lightest the repo's `Plan PRs: required` allows.
