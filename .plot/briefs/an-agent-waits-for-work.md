## Implementation brief — an-agent-waits-for-work (wave Outliving the slice)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `feature/an-agent-waits-for-work` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 5 of six. It is the precondition the last wave already assumed.

### The measurement

**2026-09-03: 0 live workers, 0 manifests, 4 desks standing, and eligible work on the board.** Every agent had exited. None had failed.

`plot-worker-loop.sh:952`:

```sh
next_branch=$("$script_dir/plot-fleet-scan.sh" --offline --next "$PLOT_SLUG" 2>/dev/null) || break
```

**No work in this plan, so the agent kills itself.** Two departures from the model in one line:

- **An agent has no idle state.** `an-agent-says-when-it-is-free` merged as `fd3e92c8` and made `free` derivable — but nothing survives long enough to be free, because the loop terminates on the same condition that would report it.
- **An agent is scoped to one plan.** `--next "$PLOT_SLUG"` bounds the ask, so an agent finishing the desk plan dies beside an eligible slice of another.

**All three exits are the worker's own** — `:952` no work, `:891` bound expired (`exit 124`), `:786` monitor said idle. Nothing outside the process can end it, and nothing outside can keep it.

### What this branch owns

**Replace `|| break` with waiting.** An agent that finds no work reports itself free and waits to be handed some. `free` is already derivable — `isAgentFree` in `packages/domain/src/rules/free.ts`, `manifest names no branch OR its slice merged`, and the loop already clears `branch` when a slice finishes.

**The registry owns termination.** Ending an agent becomes something done TO it, not something it decides. Keep `:891`'s bound and `:786`'s idle exit as they are — a bound that expires and a monitor that finds nothing running are both measurements about THIS agent, not judgements about whether work exists.

**Decide what an agent waits ON, and say why in the code.** A poll of `--next` is the obvious shape and the honest one while no registry daemon exists; `feature/the-registry-supervises-its-agents` is startable but unbuilt, and this branch must not build a stand-in for it. **A waiting agent that nothing can reach is a stalled agent** — whatever the wait is, it must be interruptible and it must be bounded by something a person can see.

### What it does NOT own

**The queue and the hand-over.** `feature/the-registry-queues-a-brief` owns those and waits on the daemon.

**The daemon.** `feature/the-registry-supervises-its-agents` on the other plan.

**Desk create-or-reset.** Merged as `a2a3c2d3`.

**`free` itself.** Merged as `fd3e92c8`. Use it; do not re-derive it.

### Done when

- An agent whose plan has no claimable slice **stays alive and reports itself free**, and a test proves it rather than a comment asserting it.
- The slug scope is gone, or the branch states in the code why it must remain until the registry hands across plans.
- A waiting agent can still be stopped — `plot-dispatch.sh --stop` keeps working.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus` — **the root typecheck covers the BOARD only.**
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate. Two agents running it here produced 53 concurrent test processes and a board that could not answer in 25 seconds.

**A caution from this plan's own history.** Wave 4 was invented from a wrong measurement, and the agent sent to it correctly refused. If you find this work already done, say so with line numbers and stop — that is the right outcome, not a failure.
