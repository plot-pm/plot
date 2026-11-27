# A desk reads quiet from its live signals

> A running agent's quiet time is the age of the newest of its desk's live signals, so an agent that passes, commits or is watched reads as active, and `plot-fleetctl.sh --status` and the board agree on it.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** fleet-runs-safely-alone
- **Review:** pr
- **Impl:** own branches
- **Issue:** #3745
- **Approved:** 2026-11-27, jwloka, plan-PR #3747 merged
- **Started:** 2026-11-27, Jan Wloka, `bug/a-desk-reads-quiet-from-its-live-signals`

## Changelog

- `/plot-fleet --status` and the board's desk walk read a running agent's quiet time from the newest of its desk's live signals: `.plot-worker.pass`, `.plot-worker.monitor.agent.jsonl`, the desk's HEAD commit and `.plot-worker.log`. A working agent no longer reads quiet for hours.

<!-- Board impact: the desk walk's quiet seconds change source; no new field. -->

## Motivation

On 2026-11-27 at 09:43 UTC `plot-fleetctl.sh --status` printed `quiet 7178s` to `quiet 7180s` for three working agents (#3745). One had opened PR #3741 a minute earlier; two had an agent run under 15 min old. Each desk's `.plot-worker.log` was 166 bytes, written once at 07:34 UTC when the loop started, while `.plot-worker.pass` and the monitor file were minutes old.

Two readers take quiet from the log alone:

- `plot-fleetctl.sh:928-935` reads the log's mtime for the status line.
- `logQuietSeconds` in `packages/domain/src/adapters/trees/trees-git.ts:460` does the same for `plan-walk-desks.ts:98`.

The loop's idle watch (`worker-loop.ts:1367`, "the desk file the loop's own output goes to") reads the log first and falls back to the prompt's CPU time, so it does not mistake a working prompt for an idle one. The two readers above have no such fallback. On the three desks the log held only the loop's start line while two prompts ran, so the log's age was the loop's age. Which change stopped the prompt's output from reaching the log is not traced here; `[question-log-output]` asks whether it should reach it again.

## Design

### Approach

- **A domain rule takes the readings as values.** `deskQuietSeconds(readings, now)` takes the mtimes of the four signals (each one may be absent) and returns the age of the newest, or `null` where none can be read. It awaits nothing.
- **The adapter reads the four mtimes.** `logQuietSeconds` in `trees-git.ts` reads them and asks the rule. The port keeps its name and contract (seconds, or `null`).
- **The status asks the domain.** `plot-fleetctl.sh --status` runs once per operator command, so it may call a bundle (`docs/shell-and-domain.md`). It reads quiet for all running desks in one call and drops its own `stat` lines, so `check-shell-lines.sh` sees fewer shell lines.
- **The usage-limit wait keeps priority.** A desk with a `.plot-worker.limited` reset ahead of now still prints `waiting on a usage limit until …`.

### Open Questions

- [ ] `[question-log-output]` Should the loop write the prompt's output to `.plot-worker.log` again? Recommended: no, in this plan. The four signals answer the quiet question without it, and the log's size matters to the idle watch's `logActivity` reading.
- [ ] `[question-session-file]` Should the prompt's session transcript count as a fifth signal? Recommended: no. Its path depends on the harness, and the monitor file already follows the session.

## Slices

### Quiet Reading

- `bug/a-desk-reads-quiet-from-its-live-signals` — `deskQuietSeconds` over the four mtimes, and `logQuietSeconds` in `trees-git.ts` reads through it <!-- builds: deskQuietSeconds --> <!-- tests: deskQuietSeconds — the newest signal wins, an old log with a new pass file reads from the pass file, no readable signal answers null; the adapter reads all four files -->

### Status Line

- `bug/fleetctl-status-asks-the-desk-quiet-reading` — `plot-fleetctl.sh --status` prints quiet from one bundle call over the running desks and removes its own `stat` reading <!-- waits: bug/a-desk-reads-quiet-from-its-live-signals --> <!-- builds: the status bundle call --> <!-- tests: a contract test where a desk's log is 2 h old and its pass file 1 min old prints quiet near 60 s; a desk with a future usage-limit reset still prints the wait -->

## Notes

Created on 2026-11-27 from issue #3745, for the sprint fleet-runs-safely-alone.
