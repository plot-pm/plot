---
"plot": patch
---

A board server started by the test harness exits when the run that started it is gone.

Measured on 2026-08-17 at 02:00: four `board-server.mjs` processes, two of them
on random high ports — which only `packages/board/test/helpers.mjs` asks for,
via `PORT=0` — with **PID 1 as their parent**. The test runs that spawned them
were long gone, eighteen seconds apart, and both were still answering
`/api/fleet` with 200 and still polling. That accumulation is why the Agents tab
reported `0 branches across 0 plans` during a five-agent run: the fleet view
exists to make parallel work visible, and the more parallel work ran, the less
reliable the view of it became.

**This was not a discipline problem.** 26 `startServer(` calls against 24
`.kill()` calls in `after()` hooks — the tests clean up correctly. But
`startServer` *returns* a `kill` function for the caller to invoke, which makes
cleanup a **rule** in this repo's vocabulary: you can answer "did I clean up?"
without having done it, because `after()` never runs when the runner is killed
rather than finishing. Ctrl-C, a dying agent, a `SIGKILL`: no hook fires, and
POSIX hands the child to PID 1.

**The server now measures its launcher rather than trusting one.**
`process.ppid` becomes `1` the moment a parent dies, **however it dies** —
measured with a probe: parent killed by `SIGKILL` (exit 137, so no handler of
its own could run), child observed `ppid changed 20996 -> 1` within 200 ms. A
1 s interval polls it. That is a gate rather than a rule, it needs no
cooperation from the caller, and it survives the exact case that produces
orphans: the one where no cleanup code runs at all. It also fails safe — a check
that never runs leaves behaviour exactly as it was.

**It is gated on a new variable, `PLOT_EXIT_WITH_PARENT`, and the distinction
cannot be the ppid change itself.** The operator's board runs under
`node --watch`, whose supervisor *replaces its child on every restart* — so "my
parent changed, therefore exit" is true for both, and the operator's board would
be the one that dies. A board in a terminal the operator then closes is likewise
meant to keep running. `helpers.mjs` already passes `PLOT_REPO_ROOT` and
`PORT=0` to every server it starts and the operator's board has neither, so
either could serve as a tell; neither should. `PLOT_REPO_ROOT` answers *where
the repo is* and `PORT=0` answers *pick a port for me* — inferring from either
would work by accident today and surprise whoever sets them for their actual
meaning tomorrow. One variable, one question.

One variable covers the agent case with no second mechanism: agents run
`pnpm test`, which goes through this same `helpers.mjs`, so their servers
inherit it exactly as a human's do — the case producing the most orphans is the
same case.

**Two neighbouring answers were checked and rejected.** A global teardown runs
only when the suite ends **in order**, which is precisely what the per-suite
`after()` hooks already cover; the orphans measured at 01:54 came from a run
that did not end in order, and a teardown would have missed both. And
`helpers.mjs` spawns *without* `detached: true`, so these were ordinary children
that got orphaned — adding it would have made the problem deliberate.

Tests assert against `SIGKILL`, never `SIGTERM`: a handler-based cleanup passes
the polite case and leaves exactly the orphans this exists to remove.
