# The reaper keeps leftovers that no controller removes

> The reaper and the release controller keep three kinds of leftover that no controller removes; one plan changes what `rules/reapable.ts` and `reap.ts` read as reapable for all three.

## Status

- **State:** Draft
- **Type:** feature
- **Sprint:**
- **Issue:** #2757
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- The reaper no longer reads a reused pid as a live worker, and a controller removes each leftover desk or claim ref that the reaper reports.

<!-- Board impact: none. The plan format, the template, the helper scripts' contracts and the docs/plans layout stay unchanged. -->

## Motivation

Issue #2757 groups three tickets. Each ticket holds its own observation, cause and expected behaviour; this plan holds only what the three share. All three change what `packages/domain/src/rules/reapable.ts` and the reap entry (`packages/board/src/server/entry/reap.ts`) read as reapable.

- #2697: the liveness test asks only whether the recorded pid exists. macOS reuses pids, so the reaper reads an unrelated process as a live worker and keeps the desk.
- #2705: the reaper reports a local-only empty claim branch as an orphaned claim. `plot-dispatch.sh --release` answers that it holds no claim, and no controller removes the branch.
- #2714: the reaper keeps a desk whose slice the plan defers, whose PR closed unmerged and whose head is on the remote. Only a hand removal clears it.

Per *The Master Agent Uses The Controllers* in `CLAUDE.md`, a leftover that only a hand removal clears has no controller, and that gap is the finding.

## Design

### Approach

Each case needs a rule change in `rules/reapable.ts` (or the reading it consumes) and a controller path that removes what the rule now calls reapable.

1. **Pid liveness (#2697).** The liveness reading compares more than pid existence, for example the process start time or command line against the worker's launch record. The ticket holds the observation; the slice chooses the comparison and states it as a reading in the domain, not a check in the adapter.
2. **Local-only empty claim branch (#2705).** The rule names this leftover as its own kind. `plot-dispatch.sh --release` or the reap entry removes it, so the report and the controller agree on what a claim is.
3. **Deferred slice, closed PR, remote head (#2714).** The rule reads the host's closed-unmerged PR state (never ancestry, per *One Answer To "Did This Land"*) and the plan's `deferred:` annotation as one reapable case. The reap entry removes the desk and its refs.

Each slice adds one test that holds its case. The corpus tier at `packages/domain/corpus/` covers any rule that `plot-reap.sh` or `plot-release-refs.sh` duplicates.

### Open Questions

- [ ] #2697: which signal identifies the worker's process (start time, command line, or the launch sentinel the worker writes)?
- [ ] #2705: does the removal belong to `plot-dispatch.sh --release` or to the reap entry?
- [ ] #2714: must the remote head be deleted with the desk, or only the local desk?
- [ ] Does the report text change for any of the three, and do tests assert it?

## Slices

### Pid reuse

- `bug/the-reaper-reads-a-reused-pid-as-a-live-worker` — liveness reading that survives pid reuse (#2697)

### Claim branch

- `bug/a-local-only-empty-claim-branch-has-a-controller` — a controller removes the local-only empty claim branch (#2705)

### Deferred desk

- `bug/a-deferred-desk-with-a-closed-pr-is-reapable` — the reaper removes a deferred slice's desk when its PR closed unmerged (#2714)

## Notes

- Created from issue #2757 by `/plot-idea`, unattended. The Design question had no explicit answer, so the plan starts in Draft.
- Related plans: `2026-10-17-desk-markers-and-the-reaper.md` (Released) and `2026-09-25-the-reaper-sees-the-desks-the-fleet-leaves.md` (Rejected). Neither addresses these three cases.
- `PLOT-UNASKED: Does this plan carry significant design decisions? — default — proceeded; State: Draft`
- `PLOT-UNASKED: Is this intentionally separate from the two reaper plans above? — default — proceeded; overlap named`
- `PLOT-UNASKED: Is reapable a duplicate of the candidates the deliverable search listed? — default — proceeded; the plan changes those rules and builds nothing new`
