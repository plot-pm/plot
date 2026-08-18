---
"plot": patch
---

Board verification is a trap-guarded script, so the server is reaped on the path that fails.

`plot-board-verify.sh` starts the board on an OS-assigned port, fetches
`/api/board`, prints the payload, and stops the server — on every exit path.

**The teardown is the whole reason this is a file.** The sequence is four
commands; writing it into a SKILL.md as prose was the obvious alternative and
the wrong one, for the reason `CLAUDE.md`'s *Gates Over Rules* gives. "Always
stop the server" is a **rule**: an agent can answer *did I complete this?*
without having done it. `trap cleanup EXIT INT TERM` is a **gate** — the shell
reaps the process whether the script returns, throws, or is interrupted,
including the assertion-failure path prose forgets. A verification step that
leaks a node process when its assertion fails is worse than no verification,
because the leak is invisible until the machine runs out of ports.

So the failure path is the one the tests prove: an artifact that answers 404 on
`/api/board` must make the script exit non-zero **and** leave nothing behind.
Measured against the real artifact on 2026-08-18 by exact PID set difference —
success path and `SIGINT` path both leave zero processes that did not exist
before the run.

Two smaller decisions, both about not asserting what the script cannot know:

`PORT=0` asks the OS for a free port rather than naming one. A verification run
therefore cannot collide with a board the user already has open — and the bound
port is not knowable in advance, which is why the script polls the server's own
printed `localhost:<port>` line instead of sleeping a guessed interval. A fixed
sleep is either flaky or slow. The poll also checks the process is still alive,
so an artifact that dies on startup fails immediately with its own output
attached instead of hanging out the full timeout.

`set -uo pipefail` deliberately omits `-e`: under `-e`, the `[ -n "$pid" ] &&
kill` guard inside `cleanup` would abort the trap whenever `pid` was empty and
skip the tempfile removal — the handler that exists to prevent a leak would
become one.

<!--
bumps:
  skills:
    plot: patch
-->
