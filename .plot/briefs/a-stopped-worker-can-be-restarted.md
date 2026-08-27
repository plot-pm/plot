## Implementation brief — a-stopped-worker-can-be-restarted (wave: Restarted)

- **Plan (canonical):** `docs/plans/2026-08-27-a-stopped-worker-can-be-restarted.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `feature/a-stopped-worker-can-be-restarted` (base: `main`)
- **Ends as:** one PR to `main`

Single wave; depends on nothing.

### What to build

`plot-dispatch.sh --stop <branch>` kills a worker. Nothing starts one on a branch
that already holds a claim. That asymmetry is the whole feature.

Measured 2026-08-26: a worker stopped, its worktree held work, its branch held a
claim, no process was running — and `plot-dispatch.sh <slug>` answered
`dispatched=0`. Not a refusal with a reason: an EMPTY SET. The dispatcher never
considered the branch, because it asks `--next`, and `--next` fills `claimable[]`
only where `st = open` — meaning **no ref exists at all**
(`plot-fleet-scan.sh`). A branch that has ever been claimed is `claimed` or
`wip`, and neither is ever offered.

The operator's recourse was to bypass Plot and run the worker prompt by hand.
That worked, and produced a second defect: no manifest, so the board showed a
branch name in the agent-name slot.

### The decisions the plan settles — do not re-derive them

**THE PR IS CHECKED FIRST, BEFORE THE STATE WORD.** This is the round-one
correction and the most important line in this brief. Measured across the estate:

| worktree | state | PR |
|---|---|---|
| the-scan-sees-a-stale-sprint-tally | `failed` | #464 open |
| the-board-asks-for-a-brief | `failed` | #466 **merged** |
| the-sprint-file-names-its-members | `failed` | #381 open |
| the-components-leave-the-shell | `failed` | #369 open |
| the-estate-speaks-waves | `failed` | #363 open |

**Five of five `failed` worktrees hold a PR.** `plot-worker-state.sh` refines
`finished` by the tree but explicitly does NOT refine `failed` — *"a recorded
non-zero exit is already a specific answer about the process."* True about the
process, silent about the work. A gate written on the state word alone would
restart all five and destroy exactly what the `finished` refusal protects.

So: an open or merged PR refuses, whatever the exit code says (item 3). A
`failed` worker with NO PR does restart (item 5b) — a gate that simply refuses
`failed` outright passes item 3 and makes the feature useless.

**Explicit branch, never a slug, and never selected automatically.** Deciding
that a stopped worker should be replaced rather than reviewed, reaped or
abandoned is a person's call. `plot-dispatch.sh <slug>` must keep meaning *start
what nobody has started* (item 7).

**Preserve the tree; do not clean it.** A `stalled` worktree holds uncommitted
work — that is what `stalled` means. Measured in this repo: a stalled worker left
**324 finished lines uncommitted**. A restart that resets is worse than the
missing affordance, because it looks like a supported operation (item 6).

**Write a manifest through the ordinary dispatch path.** The bypass produced an
unregistered agent; a restart that spawned one without a manifest reproduces the
exact defect it exists to prevent. One writer, so the two cannot drift.

**No `--force`.** A flag overriding a liveness refusal is the flag typed
reflexively, and what it overrides is another agent's work.

**Do NOT teach `--next` to offer claimed branches.** Three callers consume it
(`plot-dispatch.sh`, `/plot-implement`, the board's auto-dispatch), none of which
asked for a stopped branch — auto-dispatch would begin restarting stalled work on
a five-second timer with nobody deciding anything. The scan's answer is right;
what was missing is a second question (item 8).

### Done when

All items in the plan, including 5b. Item 1 asserts through the FLEET SCAN, not a
pid: an unregistered worker is the defect this closes, so a restart the fleet
cannot see has not succeeded.

Plus: `pnpm run validate`, `pnpm run test:reconcile`, `pnpm run test:board`
green; a changeset with a `bumps:` block naming `plot`; Node 24; `trash` not
`rm`.

### Bookkeeping

Annotate the plan's `## Waves` heading on main as `(Branch: x, PR: #N)`. Push
your first real commit as soon as it exists.

### Scope guard

Owns `skills/plot/scripts/plot-dispatch.sh` and its tests. `plot-reap.sh` belongs
to a sibling branch in flight — do not touch it. Rebase onto current main first.
