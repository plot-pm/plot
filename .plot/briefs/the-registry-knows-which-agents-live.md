## Implementation brief — approval-hands-the-work-to-agents (wave 1: Alive)

- **Plan (canonical):** `docs/plans/2026-08-22-approval-hands-the-work-to-agents.md` on `main`
- **Approved:** 2026-08-22, Jan Wloka, in-session
- **Branch:** `feature/the-registry-knows-which-agents-live` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention

**Waves 2 and 3 wait on this one, and so does a fourth branch in another plan.**
The stepper that bounds parallel agents cannot count without it, and
`feature/working-is-about-agents` (in `every-section-has-one-subject`) cannot
render WORKING from the agents list until entries can say who is alive.

### What to build

The agent registry answers *is this agent still running?* — which nothing does
today.

`plot-dispatch.sh` writes one manifest per agent into `.plot/agents/`
(`session, branch, worktree, command, startedAt`) and `registry.ts` reads them.
What the manifest records is a **launch**, never a process: no pid, no exit, no
state, and nothing updates it after the spawn.

Measured 2026-08-22, the gap shows from three directions at once:

    worktrees carrying a .plot-worker.pid     7   (all 7 processes DEAD)
    registry manifests                        7
    of those, actually alive                  2
    WORKING rows (derived from worker state)  2

Three numbers, none of them *agents alive now*.

Give each entry the agent's **pid** at spawn — `plot-dispatch.sh` already knows
it and writes it to `.plot-worker.pid` a few lines below the manifest write —
and a **state** the pulse refreshes: alive where `kill -0` answers, otherwise
finished, keeping the `waiting`/`stalled` distinctions `plot-worker-state.sh`
already computes. The state reaches the board on the existing `agents` array.

### The decisions the plan settles — do not re-derive them

**The registry owns liveness. Do not re-derive it per caller.** An earlier draft
had the cap count workers via `plot-worker-state.sh` at dispatch time; that is a
derivation every caller repeats, and it cannot see an agent whose worktree has
been removed. One fact, computed once, read by three consumers: the concurrency
cap, WORKING's rows, and the stale-manifest problem.

**`plot-worker-state.sh` is the liveness check — reuse it, do not reimplement.**
It already answers eight states from a pid via `kill -0`. What is new is that its
answer lands **on the registry entry** instead of being recomputed by whoever
asks. It is sourced, not run: see its header.

**A stale manifest must become self-correcting.** An entry whose pid is gone
reads `finished` on the next pulse rather than persisting — that is why four
entries outlived their processes today.

**An older manifest with no pid must not crash the read.** It reports an unknown
state rather than a guessed one. Absent is not a guess — the rule this contract
follows everywhere.

**This counts DISPATCHED agents only**, and the plan says so rather than
promising more. A `claude -p` a person runs by hand writes no manifest and no
pid file; counting every Claude process on the machine would sweep in the
operator's own session.

### Done when

The plan's changelog is the specification. Lift these in particular, because a
naive implementation passes without them:

- A manifest carries a pid at spawn.
- An entry whose pid is alive reads `running`; one whose pid is gone reads
  `finished` — **on the next pulse, without anyone deleting the file**.
- The four states `plot-worker-state.sh` distinguishes survive onto the entry.
- A manifest written by an older dispatch (no pid) does not crash the read and
  reports an unknown state rather than a guessed one.
- **The count of live entries is derivable in one pass** — the cap will ask for
  it every pulse, so a per-entry shell-out would put the scan's cost back.

Plus the repo's gates: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, `pnpm
build:board` committed, and a changeset with its `bumps:` block. Never edit
versions by hand. Use `trash`, not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line in the plan's `## Branches` section on
`main` as soon as the PR exists — check `git branch --show-current` is `main`
first. The arrow form is the only one the parser reads.

### Scope guard

This branch owns `skills/plot/scripts/plot-dispatch.sh` (the manifest write),
`packages/board/src/server/registry.ts`, whatever refreshes the pulse, and their
tests. It does **not** build the stepper or the switch — those are waves 2 and 3
— and it does not change WORKING's rendering.

`.plot/agents/` currently holds 7 manifests, 5 of them for dead processes. They
are real data from today's dispatches: use them as fixtures if useful, but do
not delete them to make a test pass.

No other worker is running as this is written. If one starts, it will most
likely be in `packages/board/src/app/` — you share no files with that.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
