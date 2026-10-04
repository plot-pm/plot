# A brief the fleet writes shows as asked

> A slice whose brief the dispatch controller is writing says so on the board again, and a brief writer that failed says that, instead of both reading "approved — nobody has taken it".

## Status

- **State:** Draft
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches

## Changelog

- A slice whose brief is being written by a dispatch says "a brief was asked for `<age>` ago" again, whichever route asked for it. A brief writer that exited with an error says so and names its log.

<!-- Board impact: no schema change. The fleet payload's existing `briefAskedAt` field reads one more asker's log, and one new field carries a failed brief writer. No change to the plan format, the template, the helper scripts or the docs/plans layout. -->

## Motivation

`a-slice-shows-that-its-brief-was-asked-for` (released in 2.17.0, PR #905) made a slice whose brief is being written say "a brief was asked for `<age>` ago" instead of "approved — nobody has taken it". The board reads the ask from the mtime of the asker's log: `briefAskedAt` in `packages/board/src/server/brief-ask-log.ts`, over the paths `briefAskLogPaths` names. It names two askers: `plot-dispatch.sh` (`.plot/brief-<branch-slug>.log`) and the board's `brief-ask.ts` (`.plot-brief-<plan-slug>.log`).

Since `aa1f36296` ("a dispatch names the act it started", 2026-09-29), the dispatch controller writes a slice's brief through the implement route with `--brief-only`. That run logs to `.worktrees/plot-implement-<plan-slug>.log`, through `implementLogPath` and `agentLogPath`. `briefAskLogPaths` does not name that path. So every brief a dispatch has asked for since then reads as "nobody has taken it".

Measured 2026-10-04: the dispatches of `the-shell-loop-holds-unlanded-work` and `the-worker-loop-runs-in-js` each wrote a brief for several minutes, and the operator saw no sign of either: *"the board still does not show when the fleet is writing briefs"*. The reader's own comment names this failure: a further spelling of where an asker's log lives "is how a reading goes blind to half the asks". No test names `briefAskLogPaths`, so nothing caught the third asker.

## Design

### Approach

**One list of askers, and each asker's path comes from it.** `brief-ask-log.ts` names every asker by the function that gives its log path, not by a copied string: `implementLogPath` for the implement route, the path `brief-ask.ts` writes, and the path `plot-dispatch.sh` writes. `briefAskedAt` reads all of them for a row and reports the earliest mtime, as today. The implement route is keyed on the plan slug, so the row's plan slug is passed beside its branch slug. The two agree on this estate by naming convention, not by construction.

**A test holds each asker to the list.** For each asker the test runs the code that names its log path and asserts that path is in the list `briefAskedAt` reads. A new asker that logs elsewhere then fails that test, not the operator's board.

**A failed brief writer says so.** The implement route records an exit code, and `implementStatus` reads it as `running`, `done` or `failed`. An exit code is a recorded fact, not a liveness guess, so it does not reopen the decision that #905 made against reading a process. The fleet payload carries `briefFailed` on a row: the log path when the implement run for its plan recorded a non-zero exit after the ask, and null otherwise. The row then says "the brief writer failed" and links the log. A run that is still going keeps saying the age of the ask, as today. A run that succeeded wrote the brief, so `brief` reads present and the row leaves the waiting note.

**The decision stays in the fleet payload and the row reads it.** `briefAskedAt` and `briefFailed` are computed in `fleet.ts` from files, and `row-identity.ts` decides the words from the two fields, so a unit test asserts each sentence without a browser. One browser test proves the note renders for a row whose only ask is an implement-route log.

**Per machine, as before.** A brief asked for on another machine leaves no log here, and the row says what this machine can see.

**Tests.**
- `briefAskedAt` returns the implement log's mtime when it is the only ask.
- Several asks report the earliest.
- `briefFailed` holds the log path for a non-zero recorded exit, and is null for a running run, for exit 0, and for no run.
- The asker-list test covers every asker.
- `row-identity.ts` gives the failed sentence.
- One browser test shows the note for an implement-route ask.

### Open Questions

- [ ] Should a failed brief writer be re-asked? This plan only makes the failure visible. Re-asking is `auto-dispatch-asks-for-the-brief`'s question.

## Slices

### A brief the fleet writes shows as asked

- `bug/a-brief-the-fleet-writes-shows-as-asked` — `briefAskedAt` reads the implement route's log beside the two askers it reads today, from one list that each asker's path comes from; a failed brief writer shows as failed <!-- builds: the asker list in brief-ask-log.ts, and briefFailed -->

## Notes

- 2026-10-04, report from jwloka: "the board still does not show when the fleet is writing briefs". Type `bug`: it is a regression of the behaviour `a-slice-shows-that-its-brief-was-asked-for` shipped. Reviewed in-session, own branches, so the fleet can deliver it.
- Root cause found 2026-10-04 by reading `brief-ask-log.ts`, `implement.ts` and `agent-log.ts`, and by listing the logs: `.worktrees/plot-implement-the-shell-loop-holds-unlanded-work.log` and `.worktrees/plot-implement-the-worker-loop-runs-in-js.log` exist, and no `.plot/brief-*.log` or `.plot-brief-*.log` newer than 2026-09-30 does.
