---
'@plot-pm/board': minor
---

`plot-registryd --start-agents` starts free agents for a queue nothing can take. The tick already derived the queue and had no way to answer a shortage; `assign` now takes an optional fleet cap, emits `worker-start` writes for slices held on `no-free-agent`, and the daemon applies them through a second performer that may reach the process table. `perform-fs.ts` is untouched and still refuses `worker-start`, so a sandbox cannot start a real agent. The cap is the board's own `Parallel agents` control, read fresh every tick. Performing is opt-in: a run without the flag changes nothing on the machine.
