---
'plot': minor
---

The board gets its own door. `/plot-board --start --stop --status` owns starting the local board, and `plot-board-setup` keeps only adoption — its `--start` flag is removed, not aliased, because a flag that still works teaches the wrong command. `DESIGN-process.md` §5 is the reason there is a command at all: a resident process must answer *who starts it, and how does a person stop it*, and until now the board's answer was an adoption command's flag.

`--stop` finds the board by two facts that must agree — the pid `--start` recorded, and whoever holds the port — and the port's holder must BE that pid or DESCEND from it. `node --watch` supervises the child that binds, measured on the live board as 9518 → 27674, so an equality check would refuse every healthy board. Neither fact is sufficient alone: a pidfile outlives its process and may name a recycled pid, and the port finds whichever board answers, which on a machine running several is not this repository's. Each of the four disagreements is named and refused rather than guessed through — a `pkill -f 'board-server.mjs'` on 2026-09-04 killed an operator's board along with the stale jobs it was aimed at, and a pattern over process names is exactly that guess.

`--status` reads `server.repo` from `/api/board`, the only fact that says which checkout a board on a port is serving.

Two measurements shaped the script. The tree walk runs in one `awk` pass: this machine lists 1109 processes, and a shell loop forking `awk` per line took 10.6 s, so a `--stop` exceeded 120 s and printed nothing — a fleet host is exactly the machine with a table that size, so the slow form failed hardest where the command is needed. And liveness is read from `ps -o stat=` rather than from `kill -0` alone, which succeeds on a zombie: a stop whose tree had fully exited reported *still running after KILL* against a dead pid.

<!--
bumps:
  skills:
    plot-board: minor
    plot-board-setup: minor
    plot-fleet: patch
-->
