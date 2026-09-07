---
'@plot-pm/board': minor
---

The board says whether anything supervises the fleet. It carried no supervisor field at all: measured 2026-09-07, `plot-fleetctl.sh --status` reported `supervisor=down` while six workers ran 23–25 hours against an 8-hour `Worker bound`, all six spent — PR merged, tree clean, `PLOT-BLOCKED.md` written — and the board rendered six rows indistinguishable from six healthy ones.

The reading comes from `plot-fleetctl.sh --status` and nowhere else. Its exit code is the contract — 0 loaded, 1 not — and a second implementation over a pidfile, `launchctl` or a process name would drift toward *looks fine*, which is the direction nobody notices. No new port: `Scripts.awaited` is already the one place a `plot-*.sh` is invoked, and it hands back the exit code beside both streams.

Three states, and `unknown` is neither `up` nor `down`. Anything that is not exit 0 or exit 1 — another code, no code, a call that could not be made, or a run that stopped before its own `summary:` line — is `unknown`. That last reading is load-bearing: `execFile` maps a `SIGTERM` timeout to code 1, the script's own word for *not loaded*, so a rule reading the code alone would raise an alarm from a call that never got an answer.

Prominence combines two facts, and the combination is what makes the state actionable. `down` with zero agents is a quiet statement — nothing is being neglected. `down` with agents running is a warning, because every one of them is unreapable. It renders on the WORKING section header beside `ParallelAgentsStepper`, reusing the `registry` annotation's shape: shown only when something is worth saying, amber only when the news is bad.

Every decision is a domain property in `rules/supervisor-reading.ts`, asserted with no browser; one browser test proves the badge shows it. Measured cost: 0.46 s in a checkout with no fleet worktrees, 1.42 s in one with 27 — taken on the refresh, off the request path, bounded at 5 s.

<!--
plan: docs/plans/2026-09-07-the-board-says-whether-anything-supervises.md
-->
