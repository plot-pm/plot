# Continue and stop: manifest, retry and race findings

> Nine review-finding issues on the continue and stop paths close as one plan with five slices, each slice owning one failure family.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #1841
- **Story:**
- **Review:** pr
- **Impl:** own branches

## Changelog

- Fixed: continuing a desk starts one loop, leaves no stray manifest after a failed start, and restores the manifest when a stop times out.
- Fixed: a continuation answer obeys the slice run and spend limits, survives a failed start, and is never resumed into another slice's conversation.
- Fixed: a second implement start shows as running, and a brief run takes the same lock as an implement.

<!-- Board impact: none. The plan format, the template, the helper scripts' contracts and the docs/plans layout do not change. -->

## Motivation

Issue #1841 tracks nine issues closed in its favour on 2026-10-16 (triage at `c40ac9e96`): #1357, #1373, #1377, #1379, #1381, #1382, #1383, #1528 and #1788. Each holds review findings that did not block a merge, and the triage found them still open on main. Their file and line references date from the reviewed commits and are not re-measured here; each slice starts by re-checking its own findings against main, and drops one that no longer holds.

The findings fall into five families that share code and tests:

- **Start race.** `continue.ts` has no lock between the live-loop check and the pid-file write, so a click and a supervisor tick can start two loops (#1357). A failed spawn leaves the request open, and an unwritable pid file makes `readDeskPid` return the previous, dead pid.
- **Stop and manifest ordering.** The route signals the loop before it knows the manifest saved (#1379). A stop that times out leaves the manifest removed while the answer says `loop-alive`. The wrapper in `plot-dispatch.sh` can write `143` to `.plot-worker.exit` after the route removed that file (#1377, #1379). A manifest written before the prompt and log steps stays when one of them fails (#1373).
- **Continuation semantics.** A continuation skips `runLimitEnding` and `spendLimitEnding` (#1381, #1383). A retry after `unstarted` runs without the answer and re-appends it to `PLOT-CORRECTION.md` (#1382, #1383). A continuation file left for another branch is never removed. `readContinuation` reads every error as "no continuation".
- **Wrong conversation.** An `unstarted` ending resumes the newest transcript in the worktree, which belongs to the previous slice (#1788, MEDIUM).
- **Implement lock.** The detached start has no real-path test, a timeout leaves a live child, a brief takes no lock, the lock is per checkout, and the button shows a 409 as failed (#1528).

## Design

### Approach

Each slice re-verifies its findings on main first, then fixes the ones that hold, with a test that fails on main. A finding that no longer holds is recorded in the slice's PR and dropped.

**Start race.** Take a per-desk lock around the live-loop check, the spawn and the pid-file read, in the same shape `#1528` settles for the implement lock, so the two do not diverge. The spawn gets an `'error'` path that releases the lock and answers `failed`. `readDeskPid` answers no pid when the file is missing or older than the spawn.

**Stop ordering.** Save the manifest first. A `null` save refuses `no-manifest` before the loop is signalled. After the signal, the route waits for the loop pid and the manifest's `wrapperPid`. A timeout restores the saved manifest before it answers `loop-alive`. A stop also removes `.plot-worker.freewait`, and the filename is defined in one place. The `started` result carries a `warning` field when a stamp fails after the start.

**Manifest cleanup.** Write the manifest last, just before the spawn, so no `failed` return leaves one behind. Where order cannot change, remove it on each `failed` return after a `write` verdict.

**Continuation.** A continuation checks the run and spend limits before it returns. The one open decision is whether a person's answer overrides a limit (see Open Questions). A retry after `unstarted` reads the continuation again, and the `PLOT-CORRECTION.md` append is keyed so a second attempt writes nothing. The continuation entry gets its own heading. `readContinuation` separates a missing file from an unreadable or empty one. `CONTINUATION_NAME` moves to a leaf module, so the loop bundle stops importing the route module (measured in #1383: 1,399,113 B on main against 1,456,545 B on the head).

**Resume id.** An `unstarted` continuation does not take its `resumeId` from `resumeIdFromTranscript`. The route test sets `PLOT_TRANSCRIPT_HOME` and asserts the written manifest's `resumeId`, which also covers the untested recovery in #1373.

**Implement lock.** One test spawns the built entry against a sandbox with `sh -c 'sleep 2'` to prove `--foreground` stops the chain. The timeout names the child's pid. A brief run takes the lock. The lock directory resolves from the main checkout. `/api/implement` answers 409 and `ImplementButton.tsx` renders it as running.

**Style findings.** Helpers a slice writes or rewrites are arrows, as `CLAUDE.md` asks. A neighbouring `function` declaration stays untouched. Comments state interface and not history.

### Open Questions

- [ ] Does a person's answer override `Slice max runs` and `Slice max spend`, or does the limit win? The code and the plan `2026-10-08-a-blocked-agent-s-question-has` do not settle it. Recommendation: the limit wins and the refusal names the limit, because a person can raise the limit and a silent overrun cannot be undone.
- [ ] Does a retry after `unstarted` carry the continuation? Recommendation: yes, the answer was never delivered.
- [ ] Does take-up remove a continuation file written for another branch, or keep it for its slice? Recommendation: keep it, and record the branch it was written for, so a later take-up of that branch reads it and any other branch ignores it.
- [ ] Does a `blocked` desk's registry entry survive `leave()`? #1373 reopened the question from #1372: `main()` also calls `leave()` on a normal return, and `deregister` and `reap` remove entries. Measure it from the desk log and the registryd log around a restart before any code changes.
- [ ] Does #1788's `unstarted` case need a second change beyond the `resumeId` source, for example a domain unit test only? Settle it when the slice re-reads `continue-target.ts`.

## Slices

### Implement lock

- `bug/the-implement-lock-covers-its-start` — the six gaps in #1528, ending with a real detached-start test and the 409 mapped to running <!-- builds: a real-path test for the detached implement start -->

### Start and stop

- `bug/a-continue-starts-one-loop` — #1357 and #1377: the start lock, the spawn `'error'` path, the stale pid, the wrapper wait, the freewait leak and one definition of the freewait filename <!-- waits: bug/the-implement-lock-covers-its-start -->
- `bug/a-failed-continue-leaves-its-desk-whole` — #1373 and #1379: manifest written last, `no-manifest` refused before the stop, the manifest restored on a stop timeout, the `warning` field and the corpus parity for `writeDeskManifest` <!-- waits: bug/a-continue-starts-one-loop -->

### Continuation

- `bug/a-continuation-obeys-the-limits` — #1381 and #1383: run and spend limits, the retry that carries the answer, the idempotent append, the read-error split and the leaf module for `CONTINUATION_NAME`
- `bug/an-unstarted-continue-resumes-no-stranger` — #1788 and the resume-id test from #1373 <!-- waits: bug/a-continuation-obeys-the-limits -->

## Notes

- Source: issue #1841 and its nine members; their threads hold the full evidence.
- The two start-and-stop slices wait on each other because both edit `continue.ts` and `continue-route.test.ts`; the implement-lock slice leads because it settles the lock shape the continue start reuses.
- A finding that main no longer reproduces closes in the PR that discovers it, with the command that showed it.
