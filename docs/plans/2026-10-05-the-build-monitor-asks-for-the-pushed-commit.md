# The BuildMonitor asks for the pushed commit

> The BuildMonitor reports the CI run of the commit the agent pushed, and keeps asking until that run answers, instead of settling the commit on the previous commit's run.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #1275, #1255
- **Story:** the-supervisor-delivers-the-approved-scope
- **Review:** in-session
- **Impl:** own branches
- **Approved:** 2026-10-05, jwloka, in-session
- **Started:** 2026-10-05, jwloka, `bug/the-build-monitor-asks-for-the-pushed-commit`

## Changelog

- A worker's checks wait now ends when the CI run for its pushed commit finishes. Before, a push could be answered with the previous commit's run, and the wait ran to its `Checks wait` bound with no answer (#1275, #1255).

<!-- Board impact: none. The build findings file keeps its format; it only stops receiving a `head moved` line that settles the wrong commit. -->

## Motivation

Measured 2026-10-05 on this estate, with auto-dispatch on:

- PR #1279: CI went green on `2f7999714` at 09:03Z. The BuildMonitor's last finding was `head moved` at 08:41:28Z, naming the run of the previous commit `cf4785cc5`, and it wrote no finding for `2f7999714`. The loop waited until its 3600 s bound, logged "no CI answer … letting go of the slice", and the merge waited an hour.
- The same desk's findings file holds `head moved` at 08:06:39Z and 08:18:33Z on `infra/the-loop-has-a-workflow`, and at 22:05:17Z the day before on `infra/the-shell-loop-holds-unlanded-work`. Each names the previous commit's run.
- #1255 records the same shape on PR #1269: no second `build failed` after a corrected push.

## Design

### Approach

**The cause is two steps that together settle a commit on the wrong run.**

1. `plot-host.sh run-for-sha <branch> <sha>` answers with the branch's newest run when no run carries `<sha>` (`… | (select(.headSha==$sha)|.[0]) // .[0]`, the GitHub arm; the Jenkins arm has the same fallback). For several seconds after a push, no run carries the new commit, so the answer is the previous commit's run.
2. `plot-build-monitor.sh`'s `monitor_pass` adds the desk's HEAD to `settled_shas` after it publishes any finding, `head moved` included. A settled commit is never asked about again.

So a pass that runs between the push and the start of its CI run publishes `head moved` about the old run and settles the new commit. `checksVerdict` settles only on `build passed`, `build failed` and `build needs approval`, so the loop's wait never ends before its bound.

**The fix removes both steps.**

- **`run-for-sha` answers only for the asked commit.** With no run for `<sha>` it answers "no run yet", in both arms. A caller that wants the newest run asks a different question.
- **`head moved` settles nothing.** It is a fact about the old run, not an answer for the desk's HEAD. The monitor publishes it and keeps the HEAD unsettled, so the next pass asks for the new commit's run again.

**The shell ratchet.** Both changes edit existing lines or remove a fallback, so `scripts/check-shell-lines.sh pr` reports no growth. If a test helper needs a line, the PR names the line it removes. The gate is not widened.

**Why this is not left to the JS loop.** `the-worker-loop-runs-in-js` replaces this wait with `checksFromRuns` over `BuildPort.runForSha`, and slice 6 of that plan deletes the BuildMonitor. Until that plan's slice 5 makes `js` the default, every adopting repository runs the shell loop and its BuildMonitor. This bug costs up to one `Checks wait` per corrected push until then, so it is fixed where it runs today.

**Tests.** `test/reconcile/`:
- `run-for-sha` with runs for other commits only answers "no run yet", for each backend arm.
- A monitor pass whose host answers "no run yet" for the HEAD publishes nothing and leaves the HEAD unsettled; the next pass, whose host now answers a finished run for the HEAD, publishes `build passed` or `build failed`.
- A pass that sees the desk HEAD differ from the last published run's commit publishes `head moved` once and leaves the HEAD unsettled.
- The loop's checks wait, fed that sequence, ends on the new commit's answer and not on its bound.

### Open Questions

- [ ] Does any other caller rely on `run-for-sha`'s newest-run fallback? The brief names each caller found by `grep run-for-sha`, checked on the day.

## Slices

### The BuildMonitor asks for the pushed commit

- `bug/the-build-monitor-asks-for-the-pushed-commit` — `run-for-sha` answers only for the asked commit, and `head moved` no longer settles the desk's HEAD; no net shell growth <!-- builds: the run-for-sha exact-commit answer -->

## Notes

- 2026-10-05, root cause read from the code by the master session's research: `plot-host.sh` ~4535-4545 (the fallback) and `plot-build-monitor.sh` `monitor_pass` (the settling). #1275 and #1255 recorded the symptom; neither recorded the cause.
- Under the story `the-supervisor-delivers-the-approved-scope`: this removes the stop at its source. A supervisor that notices a silent wait is a separate plan.
