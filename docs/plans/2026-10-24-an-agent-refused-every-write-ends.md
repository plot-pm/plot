# An agent refused every write ends as «nothing-done» and leaves a stuck claim

> A dispatched agent that the harness refuses every Edit, Write and Bash call ends with the same record as an agent that had nothing to do, and the claim it leaves needs three manual steps to free.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2428
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2509 merged
- **Started:** 2026-10-24, Jan Wloka, `bug/refused-writes-end-as-permission-denied`
- **Started:** 2026-10-24, Jan Wloka, `bug/loop-writes-blocker-for-refused-agent`
- **Started:** 2026-10-26, Jan Wloka, `bug/fleet-start-probes-worker-writes`
- **Started:** 2026-10-27, Jan Wloka, `bug/claim-only-branch-returns-to-queue`

## Changelog

- A fleet agent whose every write the harness refused now ends as `permission-denied`, and the board names the cause.

<!-- Board impact: the ending reason is read by the board (`ended-desks.ts`, `schema.ts`), so a new reason needs a board rendering and a rebuilt artifact. No change to the plan format or template. -->

## Motivation

Observed 2026-10-23 in ewz-kus-portal (Plot 2.28.0, launchd fleet, a `claude -p` worker command with no `--permission-mode` and no settings file allowing Edit/Write/Bash). Three slices were handed over. Every Edit, Write and Bash call of each agent was refused: 13 for 3893, 5 for 3894, 4 for 3895. The agents did not route around the refusal. They could not write `PLOT-BLOCKED.md` either.

- `.plot-worker.ending.json` read `{"reason":"nothing-done","actor":"agent",...}` with exit `0`, and WorkerMonitor read `finding: clear`. The board showed "worker finished — review it". The only evidence of the cause was the session transcript under `~/.claude/projects/`.
- The blocker channel is a file write, so an agent without write permission cannot report its own block.
- Recovery needed three manual steps: delete the remote refs, `git fetch --prune`, remove the dead desks and their local branches. `plot-dispatch.sh --release` refused while the host answered 429, and the supervisor kept counting `orphaned-claims=3` from stale `refs/remotes/origin/*`.

Related: #2407, #2387.

## Design

### Approach

`packages/domain/src/workflows/agent-loop.ts:850` ends a turn with no landed work as `nothing-done`. `rules/ending-action.ts:339` then maps `nothing-done` to `release-claim`. Four changes, one per slice:

1. **Classify.** When the harness result or transcript shows permission denials and no tool call changed the worktree, end with `permission-denied`. The reason is a new ending reading in the domain, and the board renders "agent was refused every write — check the worker command's permissions".
2. **Write the blocker for the agent.** When an agent ends with no commit beyond the claim and no `PLOT-BLOCKED.md`, the loop writes one from the agent's final message. The loop holds the permission the agent lacks.
3. **Probe at start.** `plot-fleet --start` (and `--once`) runs one `-p` command that touches a file in a scratch desk, and refuses to push a claim when the write fails.
4. **Self-heal the claim.** A claim whose branch holds only the claim commit, whose agent ended `nothing-done`, and that has no PR returns to the queue: prune the tracking ref and reap the desk. Where the host cannot be asked, the claim-only commit is local evidence that no PR carries work. A `permission-denied` claim stays held for a person: a fresh session meets the same refused permissions, and the slice 2 blocker is the person's question.

Slices 1 and 2 stay inside the layering rule (controller → domain → port ← adapter). Slice 4 touches a destructive path, so it reads `mergedAt` per *One Answer To "Did This Land"* and never decides from ancestry.

### Open Questions

- [ ] Is the permission-denial signal read from the harness's JSON result or from the session transcript? The transcript path is a machine-local detail the domain should not import.
- [ ] Does slice 4 differ from the existing `release-claim` action only in the host-unreachable case, or does it also change the stale-ref and desk cleanup?
- [ ] Should the probe in slice 3 run per fleet start or per registered worker command, given a project can declare several?

## Slices

### Classify

- `bug/refused-writes-end-as-permission-denied` — end as `permission-denied` and render it on the board <!-- builds: permission-denied ending reason --> → #2545

### Blocker

- `bug/loop-writes-blocker-for-refused-agent` — the loop writes `PLOT-BLOCKED.md` from the agent's final message <!-- waits: bug/refused-writes-end-as-permission-denied --> → #2599

### Probe

- `bug/fleet-start-probes-worker-writes` — one scratch-desk write probe at `--start` and `--once` <!-- builds: worker write probe --> → #2737

### Self-heal

- `bug/claim-only-branch-returns-to-queue` — return a claim-only, PR-less branch to the queue and prune its ref and desk <!-- waits: bug/refused-writes-end-as-permission-denied --> → #2782

## Notes

- Source: tracker issue #2428. The plan is a Draft; whether it is worth doing is the reader's decision.
