## Implementation brief — a-worker-asks-for-the-next-wave (wave 1: Anchored)

- **Plan (canonical):** `docs/plans/2026-08-24-a-worker-asks-for-the-next-wave.md` on main
- **Branch:** `infra/the-registry-holds-the-worker-pid` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 of 4, and the prerequisite for the rest: without it a worker cannot move
between worktrees, and the loop the plan is named for degrades to a hand-off
that reuses nothing.

### What to build

The worker pid moves from `$wt/.plot-worker.pid` to the session's manifest.
`plot-worker-state.sh` resolves worktree→session and reads it there.

**No behaviour changes.** The same six process states, from a different anchor —
which is what makes this wave separately verifiable.

### Settled — do not re-derive

**`plot-worker-state.sh` is the single choke point.** One function, one file read
(`plot-worker-state.sh:322`), sourced by BOTH `plot-dispatch.sh` and
`plot-fleet-scan.sh`. The anchor moves in one place for every caller — that is
why the duplication was collapsed into one function on 2026-08-18.

**Four readers must move together:** `plot-worker-state.sh` (reads),
`plot-dispatch.sh` (writes, `:942`), `plot-fleet-scan.sh` (asks), and the board's
`/api/continue`. The artifact rebuild carries the last.

**Trust the pid only where the process started at or after the manifest's
`startedAt`.** A manifest can sit for weeks, and a reused OS pid would otherwise
read `running` forever. All five manifests here name dead pids today — each one
`fork()` away from a false positive. Every manifest already carries `startedAt`.

**The exit marker STAYS per worktree.** `.plot-worker.exit` records what happened
to a run in a PLACE; a worker that moved on leaves a true record of what it
finished there. Only the pid — the claim about what is alive NOW — belongs to the
session.

**A manifest outlives its worktree, and that is new.** `$wt/.plot-worker.pid`
dies with its worktree; a manifest in `$repo_root/.plot/agents` does not. Two of
five here already name worktrees deleted hours earlier. Worktree gone + pid DEAD
is an orphan; worktree gone + pid ALIVE is a worker that moved — told apart by
`kill -0`, never by the worktree existing.

### Done when

Plan items 1, 2c, 2d. Item 1 is the one a naive implementation passes without:
**the same six states, asserted against the existing tests**.

Plus repo gates as above, and `pnpm run test:reconcile` — this touches shell
scripts that suite covers, and CI runs it separately from `test:board`.

### Bookkeeping

As above: `### Anchored (Branch: …, PR: #N)`, inside the parenthetical.

### Scope guard

`skills/plot/scripts/plot-worker-state.sh`, `plot-dispatch.sh`,
`plot-fleet-scan.sh`, and the board's continuation endpoint. Do NOT start the
worker loop — that is the `Asked` wave and depends on this one.
