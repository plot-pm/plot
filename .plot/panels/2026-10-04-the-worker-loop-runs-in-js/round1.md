# Round 1 — Moderation

**Subject:** `docs/plans/2026-10-04-the-worker-loop-runs-in-js.md` at `fb24e3668`
**Lenses:** estate, contradiction, deliverable, cost
**Gate:** each verdict checked with `plot-panel.mjs check Position "proceed,amend,reject" <lens>`; all four exit 0
**Reconcile:** `unanimous	amend	estate,contradiction,deliverable,cost`

## What each juror looked at

| Lens | Evidence |
|---|---|
| estate | Read 27 domain and board files, 3 earlier plans and 6 issues. Ran `wc`, `grep`, `git grep`, `git log` and `gh issue view`. Ran no test. |
| contradiction | Read the domain rules, transitions, workflows and ports that the loop touches, `continue.ts`, `plot-dispatch/SKILL.md`, the Manifesto principles 3, 5 and 13 and two related plans. Ran the plan's own counts. |
| deliverable | Ran `plot-plan-meta.sh` (exit 0) and per-file counts over the 30 test files. Read the prompt-exit and checks-verdict entries. Ran no test. |
| cost | Measured RSS of live loops, monitors, registryd and the board, `process.execve` on Node 24.4.1, CI step timings, fleet throughput, and four loop test files run alone. |

All four re-measured the Motivation numbers on `main` and found them true: 891 code lines, 3,137 lines, 52 functions, the four helpers, the seven bundles and 30 test files.

## Where the four agree

The direction holds. A long-running JS process removes the per-pass `node` start, so the cost rule's reason for the loop's declared duplicates no longer applies once the loop is JS. Keeping `plot-worker-loop.sh` as the name in `Worker command` is right, because `plot-dispatch --start` refuses any other.

## Findings by subject

**1. The plan names none of the domain that already exists (estate 1, 2, 4; contradiction 1, 4, 5, 8).**
- `transitions/agent.ts` holds the eight agent states. `rules/desk-lifecycle.ts` holds `holding-work` under the same name with a different precondition: no live worker.
- `workflows/decision.ts` fixes the shape `readings -> Decision | Refusal` with typed `Write` values. The supervisor carries no state between ticks.
- `BuildPort.runForSha` already reads checks by SHA. The host port cannot answer it, because `Pr` carries no head SHA. A released plan moved CI out of the host port.

**2. The `blocked` and `holding-work` rows cannot work as written (contradiction 3, 5).**
- `/api/continue` starts a second process on the desk. It does not step a live loop out of `blocked`.
- A live loop in its own `holding-work` makes `deskState` read `working`, so the board never names the person.
- Both problems go away if the loop ends on these states, with the reason recorded, and leaves the desk to `deskLifecycle`.

**3. Slice 1 ships no behaviour (deliverable 1, estate 9, deliverable 7).** Nothing calls `agentLoop` until slice 2, and adopting repositories get the fixes only after the default flips. The shell loop already asks `promptExit` through `plot-prompt-exit.mjs`, so the fix for #1246 can ship there first.

**4. Slice 2 is several slices and fails its own gates (deliverable 2, 3; cost 1, 6; estate 3, 6, 8).**
- It grows the shell with no named offset.
- 7 assertions in 4 files read the shell's source text.
- 8 files feed BuildMonitor findings, which the plan removes on purpose.
- No port exists for any of the loop's writes.

**5. The self-restart is wrong in two ways (cost 2, 3; estate 5; contradiction 10).**
- In this repository it hashes the desk's bundle, which follows the slice branch, so it can restart into older code.
- In an adopting repository it never fires, because a plugin upgrade installs a new directory.
- It needs `process.execve`, an experimental API, to keep the pid.

**6. Slice 3 cannot be decided, and slice 4 removes what the board reads (deliverable 4, 5, 6; cost 5, 7, 8; estate 7).**
- Nothing records which loop ran a slice, and "loop-caused" has no definition. Ten slices take one to two days and do not separate the two loops.
- `findings.ts:42` reads the BuildMonitor file. `buildMonitorPid` is in the board schema.
- `plot-worker-state.sh` has 15 other callers.

**7. Rules that the plan duplicates or skips (contradiction 2, 7, 9, 10).**
- Two correction budgets.
- The CI wait buys a fresh answer every minute with no word on the index or the rate budget.
- `Worker bound` covers only `free`.
- "`claude -p` is the agent" ignores `.plot/worker-prompt.sh`.

**Disagreements:** none on position. Two jurors (deliverable, cost) found the BuildMonitor conflict from different sides: the schema field and the findings reader. They agree on the fix.

## What the four lenses had in common

All four read the plan as a restructure of the code and checked it against code. None asked whether one process per agent is the right unit when `plot-registryd` already runs one long-lived Node process per machine, which could run every agent's loop. The operator chose one process per agent on 2026-10-04, so this is recorded and not reopened. A later round can measure it against the memory figure that cost found (+50 to 75 MB per agent).

None of the jurors reproduced the five failures. The amended plan makes each one a table case, so the slice that adds the table also reproduces them.

## Outcome

Amend. The amended plan answers every finding above. Each answer is recorded in the plan and not here.
