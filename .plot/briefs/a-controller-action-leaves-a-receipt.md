## Implementation brief — a-lifecycle-action-needs-a-controller-receipt (Refusing slice)

- **Plan (canonical):** `docs/plans/2026-09-09-a-lifecycle-action-needs-a-controller-receipt.md` on `main`
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #863 merged
- **Branch:** `feature/a-controller-action-leaves-a-receipt` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

`plot-controller-gate.sh` — a `PreToolUse` hook that refuses a lifecycle script invoked without a controller receipt — plus the receipt the three endpoints write before spawning.

**The measurement this exists for:** five dispatches in one session went to `plot-dispatch.sh` directly, by the agent that had read the rule, with the board answering on `:7777`. It surfaced only because a person asked. `CLAUDE.md`'s own test: *"Can you answer 'Did I complete this?' without actually doing the work? If yes, it's a rule."*

### The decisions the plan settles — do not re-derive them

**Copy `plot-state-gate.sh` and `plot-state-receipt.sh`.** They shipped for the layer below and this is the same instrument one layer earlier. Read the hook JSON from stdin, take `.tool_input.command`, exit 2 to block. Receipts live machine-local under `.plot/state/` — one travelling in a commit would clear the gate on every checkout that pulled it.

**THE DESK IS THE EXEMPTION.** A dispatched worker is a `claude -p` process **inheriting the same plugin hooks**, so its calls reach this gate exactly as the master agent's do. A call whose working directory is inside a dispatch worktree is a worker's; from the repository root it is the master agent's.

**Not an environment variable.** `PLOT_WORKER=1` is simpler and refused: an env var is something an agent sets, and this gate exists because an agent's own assertions cannot be trusted. A working directory is a measurement.

**The receipt is spent on the action COMPLETING, not on the gate clearing.** `plot-approve.sh` and `plot-deliver.sh` document re-running as the repair for an interruption — *"re-running is the repair for any interruption after it"* — so spending at the gate would refuse the documented fix in the case it is most needed. Gate clears → receipt stays. Script exits 0 → receipt spent.

**Gate exactly three scripts:** `plot-dispatch.sh`, `plot-approve.sh`, `plot-deliver.sh`. Each has a live endpoint, so every refusal can name a real route.

**Do NOT gate `gh` or `git`**, though both were used to bypass a controller in the same session. **A refusal must name a route**, and neither has an endpoint to name — a gate whose only possible response is the escape hatch is one people turn off.

**Fails OPEN on its own machinery, CLOSED on the case it exists for.** No `.plot/state/`, no git, no readable diff → allow, and say the routing went unverified. A gated script with no receipt → refuse. The two directions are not symmetric, and `plot-phase-gate.sh` sets the precedent: it allows the commit and *says the phase went unverified*.

**Fix the printed advice in the same slice.** `plot-worker-loop.sh:1497` prints *"stop it with `plot-dispatch.sh --stop <branch>`"* — after this change that names a route the gate blocks. The message must name the controller. **A tool that advertises a path and refuses it is worse than either alone.**

**The escape is named, requires a REASON, and is counted** to `.plot/state/unowned-action-writes.tsv` — the shape `plot-state-receipt.sh --unowned` already uses. A gate with no exit is one people route around; an uncounted exit is an off switch.

### Done when

The plan's assertions are the specification. Each exists because a naive implementation passes without it:

- A direct `plot-dispatch.sh` call is **refused and names the endpoint**.
- The same call **through `/api/dispatch` succeeds** — a gate that broke the legitimate path is worse than none.
- **A call from inside a dispatch worktree is allowed** — without this every worker breaks.
- **The exemption reads the working directory, never an env var.**
- **A retry after a FAILED run is allowed on the same receipt**; a second run after a **successful** one is refused.
- `plot-worker-loop.sh` no longer prints the script as advice.
- **A read-only script is never gated** — `plot-fleet-scan.sh` runs with no receipt and no board.
- It **fails open** with no `.plot/state/` and says so.
- The escape records its reason.

Plus the repo gates: `nvm use` (Node 24 — `pnpm` crashes on 26), `corepack pnpm install`, `corepack pnpm test`, `corepack pnpm run test:reconcile`. Add a changeset (`'plot': minor`, description FIRST, `bumps:` block LAST, with a `plan:` line). **Do not run `pnpm run test:e2e`** — CI's gate.

**Test the gate by firing it**, the way `plot-fleetctl.sh --once` proves the daemon ticks before a unit is loaded. A hook that is registered but never fires is the failure mode; a written file is not the evidence, the block is.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section on `main` — check `git branch --show-current` is `main` first. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-controller-gate.sh` (new), the action-receipt kind in `plot-state-receipt.sh`, `hooks/hooks.json`, the receipt write in the three board endpoints, and `plot-worker-loop.sh`'s printed message.

**Do not touch:** `plot-state-gate.sh` or `plot-phase-gate.sh` (working gates — copy their shape, do not edit them), and do not widen the gated set beyond the three scripts.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
