# A desk started by plot-dispatch --start has no manifest, so a blocked slice on it cannot be continued

> A free agent started by `plot-dispatch --start` takes a slice from fleetd, blocks, and then no controller can answer it: `plot-continue-command.mjs` and `POST /api/continue` both refuse with `no-manifest`. The slice stays claimed, so fleetd never re-dispatches it.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:**
- **Issue:** #1773
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1776 merged
- **Started:** 2026-10-15, Jan Wloka, `bug/a-free-desk-block-reproduces`
- **Delivered:** 2026-10-15
- **Released:** 2026-10-16, v2.27.1

## Changelog

- A blocked slice on a desk that `plot-dispatch --start` created can be answered through `plot-continue-command.mjs` and `POST /api/continue`.

<!-- Board impact: none expected. The board already shows these desks as "no manifest names this desk"; the row changes only if the join rule changes. -->

## Motivation

Measured 2026-10-15, issue #1773. `plot-dispatch.sh --start 2` started `free-03614ddf` and `free-1cb1a58d`; `free-7f744c29` followed. fleetd handed each a slice, and the board listed all three as "no manifest names this desk".

`free-7f744c29` failed to start its prompt three times between 15:47Z and 15:53Z on `feature/plan-and-story-cards-show-type-and-owner`: `claude -p` exited 1 during an account change. The worker wrote `PLOT-BLOCKED.md` and ended. `plot-continue-command.mjs feature/plan-and-story-cards-show-type-and-owner <answer>` then refused with `no-manifest: no manifest names …/free-7f744c29`, and `POST /api/continue` refused with the same reason.

The effect is a stall with no controller exit. The slice stays claimed, so fleetd does not re-dispatch it, and no controller resumes it. PR #1748 (`bug/a-clean-wait-end-writes-no-marker`) shows the same shape: a draft holding one test since 10:14Z, with no desk on it.

`continueTarget` (`packages/domain/src/rules/continue-target.ts`) already has a fallback for an unnamed desk: an ending record that reads `blocked` or `holding-work` for the asked branch makes the continue controller write a manifest. That fallback did not fire on `free-7f744c29`, so either the ending record was absent, unreadable or named another branch or reason, or the reading never reached the rule. Which one is not yet measured.

Related: #1743 (an ended desk reads as blocked), #1716 (a brief is not retried).

## Design

### Approach

Establish first why the fallback did not fire, then choose between the two repairs the issue names:

1. **Record the join at hand-off.** When fleetd hands a slice to a free agent, the agent's manifest gains the branch, as it does for a dispatched agent. Then `continueTarget` takes its `named` arm and no fallback is needed.
2. **Resolve by checked-out branch.** The continue controller finds a desk with no manifest entry by the branch the desk has checked out.

Repair 1 keeps the one join the 2026-10-01 plan [a-desk-and-its-manifest-name-each-other](2026-10-01-a-desk-and-its-manifest-name-each-other.md) settled: the manifest's `worktree` field. Repair 2 adds a second way to join, which that plan removed. The default is repair 1 unless the measurement shows the ending record is the real gap, in which case the fix is in whatever writes or reads it.

The rule stays in the domain (`continueTarget`); a fix to the reading goes in the adapter that builds it. The change follows the layering rule in `CLAUDE.md`.

### Open Questions

- [ ] What did `free-7f744c29` hold when the continue was refused: a manifest with `branch` empty, no manifest, or a manifest naming another worktree?
- [ ] What did its ending record read, and for which branch and reason? A start failure that exits 1 may write a reason other than `blocked` or `holding-work`.
- [ ] Does fleetd's hand-off to a free agent write the branch into the manifest, and if so where does it get lost?
- [ ] Does #1743 (an ended desk reads as blocked) change which ending reasons the fallback accepts?

## Slices

### Reproduce

- `bug/a-free-desk-block-reproduces` — a failing test: a free desk handed a slice that blocks refuses a continue with `no-manifest`. It names which of the open questions above is the cause. → #1779 <!-- spike -->

### Repair

- `bug/a-free-agent-desk-is-continuable` — the repair the measurement selects, with the test from the first slice passing. → #1787 <!-- waits: bug/a-free-desk-block-reproduces -->

## Notes

- Created 2026-10-15 from tracker issue #1773. Nothing is written to the tracker.
