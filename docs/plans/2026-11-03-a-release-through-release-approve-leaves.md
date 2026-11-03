# A release through release-approve leaves its issues at plan:delivered

> `finishRelease` books a release's plans as Released and makes no tracker call. Release v2.30.0 booked 24 plans through it on 2026-11-03, and no issue received `plan:released` or was closed.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3066
- **Sprint:** follow-ups-2-30-1
- **Review:** pr
- **Impl:** own branches

## Changelog

- A release approved through `release-approve` records `plan:released` on the issues its plans name and closes them, as the per-plan release command already does. Running `release-approve` again on an already-released version repairs a tracker write that an earlier run missed.

Board impact: **none expected.** The change runs in the board's server entry code. The plan format, template and helper scripts keep their shape.

## Motivation

Release v2.30.0 went through `plot-ask.mjs release-approve` on 2026-11-03 at 15:01Z. `finishRelease` booked 24 plans as Released (`7c1317c9e`). No issue received `plan:released` and no issue was closed: #2898 and #3049 are OPEN with `plan:delivered`, and #2997 and #3033 are CLOSED with `plan:delivered`.

The tracker write exists only in the per-plan release command, `runRelease` (`packages/board/src/server/entry/deliver.ts:925-1012`). It does three things: it checks whether another unfinished plan names the issue, it runs `plot-issue-status.sh`, and it runs `plot-plan-state.sh --phase released --version <tag>`, which labels the issue and closes it. `finishRelease` (`packages/board/src/server/entry/release-finish.ts:104`) flips `State:`, closes the sprint and pushes, and makes no tracker call. Releases 2.29.0 and 2.29.1 were booked per plan through `runRelease`. Release 2.30.0 is the first one booked through `finishRelease`.

Nothing repairs the gap later. fleetd's `runAutoProgressPass` writes `approved` progress only. `/plot-reconcile` reports and closes nothing. A second `release-approve` stops on `already-released` (`release-finish.ts:267`) before any tracker step.

## Design

### Approach

`finishRelease` runs the tracker step of `runRelease` for each plan it books, after the push. The step reads the sibling plans from the booked tree, so an issue that another unfinished plan names stays open. The shared logic lives in one function that both callers use, so the two paths cannot drift again.

An `already-released` re-run runs the same step before it returns 0. The tracker writes are idempotent, so a repeat run on a fully written release changes nothing.

A test asserts one `released` plan-state write per booked plan. Plan #2997 and step 5b of `skills/plot-release/SKILL.md` describe the path that runs today.

The change follows the layering rule: the controller calls the domain, and the tracker writes go through the existing scripts adapter.

### Open Questions

- [ ] Does `already-released` repair every plan of the release, or only plans whose issue still lacks `plan:released`? The tracker answer decides, and the step reads it before it writes.
- [ ] Does the push failure path skip the tracker step? The recommendation is yes: the tracker never reports a release that did not reach the default branch.
- [ ] Does the board read an `issues.json` entry that the write changes? Check `refreshIssueIndex` after the first write.

## Slices

### Tracker step

- `bug/release-approve-tells-its-tracker` — extract the tracker step from `runRelease`, call it from `finishRelease` after the push and from the `already-released` path, and test one `released` write per booked plan <!-- builds: a shared release tracker step used by runRelease and finishRelease -->

## Notes

- Refs #2907, #2997.
- Measured on 2026-11-03: 4 issues named by v2.30.0 plans, 0 carry `plan:released`.
