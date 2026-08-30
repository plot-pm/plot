## Implementation brief — two-monitors-watch-the-agent (slice 1: Attaching)

- **Plan (canonical):** `docs/plans/2026-08-30-two-monitors-watch-the-agent.md` on `main`
- **Branch:** `feature/every-worker-is-born-monitored` (base: `main`)
- **Ends as:** one PR to `main`

**First of six, and the others depend on it** — no monitor runs until dispatch
starts one.

### What to build

`start_worker()` in `plot-dispatch.sh` starts two monitor processes inside the
wrapper, before the agent. **They are no-ops in this slice**: each publishes
"nothing measured yet" and does nothing else.

### The decisions the plan settles — do not re-derive them

**The monitors go INSIDE the wrapper, not beside it.** `plot-dispatch.sh` does
not spawn the agent directly — it spawns an `sh -c` wrapper that backgrounds the
agent, records its pid, `wait`s for it, and writes `.plot-worker.exit`. The
comment at line 469 states the property: *"`--stop` kills the agent, the wrapper
survives to record the code."* **So the wrapper already outlives its agent by
construction**, and a monitor that is its child inherits that.

**A sibling process was considered and rejected.** Two processes started side by
side are independently mortal: the monitor can be killed or crash and nothing
notices — which is the failure being fixed, one level up.

**`start_worker()` is the only path to a worker**, which is what makes "every
worker is born monitored" enforceable rather than hoped-for. CLAUDE.md already
names it as the single writer.

**The no-op must announce itself.** A monitor that is attached but silent looks
exactly like one that is watching and has nothing to report. Publishing
"nothing measured yet" is what stops an operator trusting it — and that string
disappears in the slice that gives the monitor its first real measurement.

### Done when

The plan's `## Slices` → Attaching `Done when`. In particular:

- a dispatched agent gets both monitors without the operator asking
- **each no-op publishes that it measures nothing yet**
- **there is no code path that creates a worker without them** — asserted by a
  mutation test, not by review: removing the monitor start must turn a test red
- killing the agent (`--stop`) leaves both monitors alive and the wrapper still
  writes `.plot-worker.exit`
- a hand-made worktree gets neither — it has no wrapper to be a child of
- `--dry-run` names which monitors it would attach to which worktree

**`plot-dispatch.sh` is 2028 lines and a mistake in `start_worker()` starts no
workers at all.** So: `test/e2e/` passes **unedited**, and `--dry-run` output is
**byte-identical** before and after on the same estate. That is the protection
`production-calls-the-domain-one-rule-at-a-time` uses for reap and dispatch.

**Mind the startup window.** `plot-dispatch.sh:478` records a sub-millisecond
gap where the wrapper has started and `.plot-worker.pid` is not yet written; a
scan landing there reads `none`, honestly. The monitors start in the same
wrapper and must inherit that window rather than widen it.

Repo gates: `pnpm test`, `pnpm run test:e2e` (with `env -u PLOT_UNATTENDED`),
changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns `start_worker()` and the two no-op monitor entry points. **No sampling
logic, no host call, no channel semantics** — those are slices 2 to 4, and
building them here would put the largest change in the riskiest file.
