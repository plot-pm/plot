# A desk that ended cleanly at the wait bound reads as a blocked, stopped agent in Waiting on you

> A worker loop that ends at the free-wait bound with no slice offered writes a `PLOT-BLOCKED.md`, and the board shows the desk as a stopped agent that owes a person a decision. It owes nothing: the loop ended by design, and the desk is clean and reapable.

## Status

- **State:** Released
- **Type:** bug
- **Issue:** #1743
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-15, Jan Wloka, plan-PR #1744 merged
- **Started:** 2026-10-15, Jan Wloka, `bug/a-clean-wait-end-writes-no-marker`
- **Started:** 2026-10-15, Jan Wloka, `bug/an-ended-desk-is-not-waiting-on-you`
- **Delivered:** 2026-10-15
- **Released:** 2026-10-16, v2.27.1

## Changelog

- A desk whose loop ended at the free-wait bound with no slice offered no longer gets a `PLOT-BLOCKED.md`, no longer appears in *Waiting on you*, and is reaped on the next pass. Its row, while it exists, reads the ending record ("ended after 8 h with no slice offered") and names the next action.

Board impact: yes. The row text and the *Waiting on you* section membership change; the plan format and the helper scripts do not.

## Motivation

Seen 2026-10-15 on desks `free-04e1f562` and `free-eb358032`. Both showed in *Waiting on you* as "2 stopped agents" with the row text "no manifest names this desk, idle, checked…". Neither was blocked:

- Both loops ended by themselves at the free-wait bound. `.plot-worker.log` reads "the wait ran out on ? — free for 28851s with no slice offered, past the 28800s wait bound; ending worker. Nothing was cut short", and `.plot-worker.ending.json` records the same.
- Both slices' PRs had merged (#1717, #1718). Each desk's HEAD was the PR's final head and both trees were clean.
- At the moment the loops ended (08:40), each desk got a generic `PLOT-BLOCKED.md`: "the agent declared itself blocked. Decide how it should proceed, or close out the slice." `plot-reap.sh` then kept both desks ("PLOT-BLOCKED marker — needs a person") until a person moved it.
- Each desk still had its merged branch checked out, so the board and the reaper treated the branch as held.

With both loops ended, fleetd ran `agents=0`, so nothing would have built the next approved plan until a person ran `plot-dispatch.sh --start`.

## Design

### Approach

Three defects, one cause: the clean end at the wait bound is not distinguished from a blocked end downstream of the ending record.

1. **Marker.** A clean end at the wait bound writes no `PLOT-BLOCKED.md`. The end is recorded in `.plot-worker.ending.json` (reason `bound`, no branch). `agentLoop` row 2 in `packages/domain/src/workflows/agent-loop.ts` already returns exit 124 with no writes, so the marker comes from a later step; the first task is to find the writer.
2. **Row text.** The desk row reads the ending record and says "ended after <h> h with no slice offered", with the next action ("none" or "reaped on the next pass"). It does not name a merged branch as held.
3. **Section.** A desk that ended cleanly with no unlanded work owes the person nothing. It is reapable and leaves *Waiting on you*. That section keeps only desks that need a decision: unlanded work, a real `PLOT-BLOCKED` question, or a dirty tree. The decision is a domain property (see *Every rendered state is a domain property* in `CLAUDE.md`), asserted in a unit test, with one browser test that the row is absent.

The side effect (fleetd at `agents=0` after every loop ends) gets one line in the fix: either the supervisor starts a fresh agent when an approved slice needs one, or the plan records that it does not and files the follow-up.

### Open Questions

- [ ] Which step writes the `PLOT-BLOCKED.md` at exit 124 with no branch? The loop log line is in `packages/fleet/src/server/entry/worker-loop.ts`; the generic marker text is not yet located.
- [ ] Does `plot-reap.sh` (and `rules/reapable.ts`) reap a clean desk whose branch is merged once the marker is gone, or does it need a rule for "ended at the bound, branch landed"?
- [ ] Does fleetd start a fresh agent when a slice becomes eligible and `agents=0`? If not, is that in this plan or its own?
- [ ] Do other clean endings (`unregistered`, `nothing-done`) share the defect? Measure before widening the scope.

## Slices

### Clean end

- `bug/a-clean-wait-end-writes-no-marker` → #1748 — a loop ended at the free-wait bound leaves no `PLOT-BLOCKED.md`; a test shows the desk reapable

### Waiting on you

- `bug/an-ended-desk-is-not-waiting-on-you` → #1791 — domain rule and row text read the ending record; a clean ended desk with no unlanded work leaves *Waiting on you*

## Notes

Source: https://github.com/plot-pm/plot/issues/1743. Nothing was written to the tracker.
