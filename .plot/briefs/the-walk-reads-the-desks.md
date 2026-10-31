## Implementation brief — the-plan-walk-moves-into-the (wave: Desks)

- **Plan (canonical):** `docs/plans/2026-10-31-the-plan-walk-moves-into-the.md` on `main`
- **Approved:** 2026-10-31, Jan Wloka, plan-PR #2981 merged
- **Branch:** `feature/the-walk-reads-the-desks` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan PR required; no special review channel named)

This branch is the third of eight waves. It waits on `feature/the-walk-reads-the-branches`,
which is **merged** (PR #2988) — `workflows/plan-walk-branches.ts` and `workflows/plan-walk-estate.ts`
are both on `main` now and this wave is eligible to start. Five waves wait on this one in
turn (assembly → in-process → cache → CLI modes → pulse log → removal).

### What to build

The estate stage answers *which plans exist*; the branch-readings stage answers *what state
is each branch in*. This stage answers *who, if anyone, is working each branch* — worktrees,
worker/process state, `PLOT-BLOCKED*` markers, unpushed commits and quiet time, the third of
`plot-fleet-scan.sh`'s three reading groups (27.7–30 s CPU measured 2026-10-31, most of it
per-branch git calls and per-plan process starts this walk removes).

Write a `readDeskReadings` (name follows the existing pattern: `readEstate`,
`readBranchReadings`) async function in a new
`packages/domain/src/workflows/plan-walk-desks.ts`, following `readBranchReadings`'s exact
shape: take the branch stage's output (`BranchStageReadings`) plus the ports as input, batch
every read it can, return a `PortResult` that fails the whole beat on an unreadable snapshot
— never an empty or partial answer standing in for "no desk."

Per branch with a worktree, gather:

- **Worktree presence and path** — `git worktree list` has no `Refs` method today (checked:
  `grep -n worktree packages/domain/src/ports/refs.ts` finds only comments about
  worktree-*awareness* of existing methods, e.g. `linkedWorktree`, never a listing op). This
  is new port surface, the same shape as the branch-readings slice's `containsMany` — add a
  worktree-listing method to `Refs` (or a narrower, desk-scoped port if `Refs` is the wrong
  home; check with the plan author if unsure, but `Refs` already owns `linkedWorktree` so it
  is the natural home) and implement it on `refs-git.ts` and the fixture adapter.
- **Markers, pid, exit** — `Agents.desk(worktree)` already exists
  (`packages/domain/src/ports/agents.ts`) and returns exactly this in one call:
  ```ts
  interface AgentDesk {
    question: string;           // first line of first PLOT-BLOCKED* file, '' if none
    markers: readonly string[]; // PLOT-BLOCKED* filenames at desk root
    pid: string;                // '' if no usable pid
    exit: string | null;        // null = no record, '' = unreadable record
  }
  ```
  Call this per worktree. Do not re-read marker files directly or re-derive pid/exit —
  `Agents.desk` is the one port op that already bundles them.
- **Process/worker state** — `Processes.workerState(worktree, hasPr)` already exists
  (`packages/domain/src/ports/processes.ts`) and returns a `ProcessReading` (`state`, `pid`,
  `exitCode`, `activity`) built from the six/eight process-table states this repo's
  CLAUDE.md names under "The Domain Package" (`running`, `finished`, `failed`, `ended`,
  `none`, `elsewhere`). Call this per worktree; do not re-derive the state machine.
- **Lock** — `Refs` has `worktreeLocked`-shaped need per `plot-fleet-scan.sh:1858`'s
  `worktree_locked()` (checks `.git/index.lock`, resolved for linked worktrees). Check
  whether an equivalent already exists on `Refs` before adding one; if not, it is new port
  surface alongside the worktree listing.
- **Unpushed commits** — `rules/desk-lifecycle.ts`'s `DeskReadings.unpushed` already names
  the field this stage must produce: `readonly string[] | 'unknown'`, matching
  `TreeReadings.unpushed` in `rules/reapable.ts:73`. Gather via whatever `Refs` method
  `reapable.ts`'s own callers already use for the reap sweep — check
  `packages/domain/src/workflows/` or `adapters/refs/refs-git.ts` for the existing caller
  before adding a second way to compute it.
- **Quiet time** — **resolve this ambiguity before writing code, it is the one open question
  in this brief.** The plan's Design section names "quiet time" in this slice's one-line
  description, but neither `rules/agent-state.ts` nor `rules/desk-lifecycle.ts` has a field
  by that name. `rules/quiet.ts`'s `QuietKind` ('merged' | 'closed-pr' | 'orphaned-claim' |
  'abandoned' | 'quiet') is a **false lead** — it classifies *why nobody is on a branch*
  (closed PR vs. abandoned work vs. true idle), not *how long since anything moved*; do not
  build toward it. The actual quiet-time concept is the shell's `changed_ago_of()`
  (`plot-fleet-scan.sh:2572`) and `plot_worker_tree_quiet_seconds()`
  (`plot-worker-state.sh:641`): newest of (a) committer date of `refs/heads/<branch>`, (b)
  worktree dirty-tree mtime, (c) worker log mtime — surfaced in scan JSON as
  `changed_ago_seconds` (`plot-fleet-scan.sh:4877`). **This field is intrinsically
  non-deterministic across two runs taken seconds apart**, which is exactly why the plan's
  own `## Done when` preamble normalises it out before any corpus-style byte comparison
  (`jq -S 'walk(... del(.changed_ago_seconds) ...)'`) and tolerates it separately. Gather the
  raw seconds-since reading as a value (do not decide anything from it — no verdict
  arithmetic in this stage, per the pattern the estate and branch stages both hold to), and
  do not expect it to corpus-compare byte-for-byte; a wall-clock tolerance test is the right
  shape, matching the plan's own Done-when tolerance note.

### The decisions the plan settles — do not re-derive them

**This stage gathers, it does not decide.** `agentState` (`rules/agent-state.ts:136`) and
`deskState` (`rules/desk-lifecycle.ts:157`) are pure functions over `AgentStateReadings` and
`DeskReadings` respectively, and both already exist, tested, and correct. This stage's job
is producing those two readings interfaces as values — it must not duplicate the state
machines inside either rule. If a reading this stage gathers doesn't map cleanly onto an
existing field of `AgentStateReadings` or `DeskReadings`, that is a signal the plan's Inputs
table or this brief is missing something — report it rather than inventing a third
classification.

**No corpus test is required for this slice, unlike Estate and Branches.** The plan's
`## Done when` bullet for Desks reads only "`PLOT_SCAN_WALK=domain node --test` over the
named desk files in `test/reconcile/` passes, with sandbox fixtures for a live desk, a dead
worker, a lock and each marker" — it never names a `corpus/*.corpus.test.ts` file, unlike the
Estate and Branch-readings bullets which explicitly do. No `plan-walk-desks.corpus.test.ts`
exists today and none is implied. Do not build one; a `plan-walk-desks.test.ts` under
`packages/domain/test/` with sandbox-backed fixtures (see below) is the full scope.

**No desk-reading bundle exists to compare against, which is why there is no corpus test.**
`plot-merge-subject.mjs` and `plot-branch-state.mjs` were the branch stage's byte-equal
oracle; there is no `plot-desk-state.mjs` equivalent (confirmed absent —
`skills/plot/scripts/board/` has `plot-desk-root.mjs` and `plot-desk-loop.mjs`, neither of
which is a stdin-bundle receiving per-desk readings the way the branch stage's two oracles
do). This is consistent with the Done-when wording above, not an oversight to fix in this
slice.

**The named desk files in `test/reconcile/` are not enumerated by the plan text.** The most
direct matches by filename and content are `desk-lifecycle.test.mjs` (already contract-tests
`rules/desk-lifecycle.ts`'s `deskState` via reconcile section 21 — the rule this stage feeds),
`workerstate.test.mjs` (1154 lines, contract-tests `plot_worker_state`'s six states),
`workerstate-idle.test.mjs` and `workeridle.test.mjs` (quiet/idle readings), `desk-root.test.mjs`,
`desk-marker-gate.test.mjs`, and `desk-finding.test.mjs`. Confirm the exact subset with the plan
author if the Done-when gate is ambiguous when you reach it — do not guess silently and call
a narrower set "done."

**`Agents.desk()` and `Processes.workerState()` already do most of the gathering work.**
Unlike the branch-readings slice, which had to add real new port surface
(`Refs.containsMany`) for its central reading, this slice's two richest readings — markers
and process state — are one call each against ports that already exist and are already
tested. The genuinely new port surface here is narrower: worktree listing, and possibly a
lock check if `Refs` doesn't already have one. Do not add a desk-scoped wrapper port that
just re-exposes `Agents`/`Processes` methods unchanged.

### Done when

The plan's `## Done when` "Desks" bullet is the specification:
`PLOT_SCAN_WALK=domain node --test` over the named desk files in `test/reconcile/` passes,
with sandbox fixtures for a live desk, a dead worker, a lock and each marker. Specifically:

- `readDeskReadings` exists in `packages/domain/src/workflows/plan-walk-desks.ts`, following
  `readBranchReadings`'s shape (ports + prior stage's output in, `PortResult` out, fails the
  whole beat on an unreadable snapshot).
- A `packages/domain/test/plan-walk-desks.test.ts` covers: a live desk (worktree present,
  worker running, no marker), a dead worker (worktree present, process state `ended`/`none`),
  a lock held, and each `PLOT-BLOCKED*` marker variant — matching
  `plan-walk-branches.test.ts`'s shape (hand-built in-memory fixtures, a `world()`/`read()`
  helper, an "unreadable snapshot fails the beat" arm).
- Whatever new `Refs` port surface this slice adds (worktree listing, and a lock check if
  needed) has its own unit test, not only coverage through the stage-level test — the same
  requirement the branch-readings brief held `containsMany` to.
- The quiet-time reading is gathered as a raw value with no verdict computed from it in this
  stage, per the ambiguity note above.

Plus: the repo's gates — a changeset (package `plot`, description first, `bumps:` block
last, per this repo's CLAUDE.md), and `node skills/plot/scripts/board/plot-local-checks.mjs`
run before each push, with whatever it prints. Do not run `test:e2e` or `test:contracts` in
full locally — CI's job; run only what `plot-local-checks.mjs` names for files actually
touched.

**`scripts/check-shell-lines.sh`** refuses a PR whose shell under `skills/` grows past its
merge base. This slice reads existing shell (`plot-fleet-scan.sh`, `plot-worker-state.sh`) as
reference only — it does not port or delete any of it (the Removal wave, last in the chain,
owns that) — so it should add no shell lines. If a shell change turns out unavoidable, pay
for it by removing an equal number of lines elsewhere in the same change.

### Bookkeeping

Open the PR through the controller once the first real commit exists:
`../plot/scripts/plot-open-pr.sh` (or `--draft` while work is moving). Do not run
`gh pr create` directly. When the PR exists, append `→ #<number>` to this branch's line in
the plan's `## Slices` section (`### Desks` heading), the same way the estate and
branch-readings slices' lines now read `→ #2987` and `→ #2988`.

### Scope guard

This branch owns: a new `packages/domain/src/workflows/plan-walk-desks.ts`, whatever new
`Refs` methods the worktree-listing and lock-check readings require (and their
implementations on `refs-git.ts` and the fixture adapter), and
`packages/domain/test/plan-walk-desks.test.ts`. It must not touch `rules/agent-state.ts` or
`rules/desk-lifecycle.ts` beyond calling their existing exports — those rules are already
correct and already tested; re-deriving their state machines here would duplicate logic
those rules already settled. It must not touch `plot-fleet-scan.sh`, `plot-worker-state.sh`,
or any `board/*.mjs` bundle — those are this slice's reference material, read from, never
written to. It must not touch `workflows/plan-walk-estate.ts` or `workflows/plan-walk-branches.ts`
beyond importing their exported types (`Estate`, `BranchStageReadings`) as input.

No other branch of this plan is in flight concurrently as of this brief (the three waves
after this one — Assembly, In-process, Cache — each wait on this one or later, so none has
started). A later wave composing this stage's output will need its exported type names
stable; prefer naming the stage's answer type `DeskStageReadings` (parallel to
`BranchStageReadings` and the estate stage's `Estate`) so the Assembly wave has an
unambiguous import.

If you find something the plan did not anticipate — especially the quiet-time ambiguity
above, if it turns out to need resolution beyond what this brief states — report it rather
than improvising scope beyond what this brief and the plan describe.
