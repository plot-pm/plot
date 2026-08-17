## Implementation brief — dispatch-hands-over-work, wave 1 (Visibility)

- **Plan (canonical):** `docs/plans/2026-08-17-dispatch-hands-over-work.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #152 merged (two interrogation rounds)
- **Branch:** `feature/fleet-sees-unstarted-claims` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

The fleet pulse learns whether a claimed branch actually has a worker, and the
board says so. On 2026-08-17 three rows sat in WORKING with a pulsing green dot
while nobody was working on any of them — the claim was real, the worker was
never started.

### The central finding: the states already exist and nothing reads them

`worker_state()` at `skills/plot/scripts/plot-dispatch.sh:95` has distinguished
**five** outcomes since it was written:

```
running <pid> | finished <pid> | failed <pid> (exit N)
              | ended <pid> (status unknown) | no worker
```

Measured: `grep -rn "plot-worker.pid" packages/board/src` returns **nothing**.
The information is richer than the board assumes and reaches no screen. **Do not
write a new liveness check** — read what `worker_state()` already produces.

### Five decisions the plan settles — do not re-derive them

**All five outcomes travel to the row.** Collapsing them re-creates the very
defect this plan exists to fix: `failed (exit 1)` and `finished` are **opposite
actions** — a crashed worker needs restarting, a finished one needs reviewing —
and one label over both sends the reader to a log to find out which. That is the
same one-label-two-states shape as `no commits yet` covering both an idle branch
and a finished-but-unpushed one.

**A failed worker is NOT a `working` row.** It goes where its action is:
`waiting-on-you`, because a person has to decide whether to restart it. A
crashed worker with a pulsing dot is exactly the misreport being removed.

**A missing pid means *unknown*, not *nobody*.** A worker started by hand leaves
no pid, and hand-starting is the normal case for as long as `Worker command` is
unset — **five agents were started that way in one session**. Reading a missing
pid as "nobody is working" would report every one of them as dead. The row says
*claimed, no known worker*. Absent is not false: the rule this repo applies to
every other missing signal.

**A branch with no worktree here is a THIRD state, not the second one.** The pid
lives in the worktree (`$wt/.plot-worker.pid`), so a branch claimed and started
on another machine has no path to look at. This machine cannot answer the
question at all, which differs from looking and finding nothing:

| claim | worktree | pid | row says |
|---|---|---|---|
| ✓ | ✓ | ✓ | `worker running (pid N)` — or the finished/failed variant |
| ✓ | ✓ | — | `claimed, no known worker` |
| ✓ | — | n/a | `claimed elsewhere` |

The actions differ, which is what earns the third string: *look in this checkout*
versus *ask the machine that took it*. Same split as `local_dirty` vs
`local_ahead` — two questions answered from the sources that hold the answers,
rather than one signal stretched across both.

**A pid of `0` never reads as running.** `kill -0 0` signals the whole process
**group** and succeeds, so a naive check reports it alive forever.
`worker_state()` already rejects it explicitly (`case "$pid" in 0|*[!0-9]*)`).
Make sure that value survives the trip to the board rather than being
re-derived there.

### Where the read belongs

`worktree_rows()` at `skills/plot/scripts/plot-fleet-scan.sh:253` **already
visits every worktree** and already knows which branch each holds. The pid read
costs one file check at a stop the scan makes anyway — no new traversal, and the
no-worktree case falls out of the existing structure rather than needing a
guard.

Obey the five rules that file documents for local signals — in particular:
**absent is not false**, **one-directional** (a signal may lift a branch out of
quiet, never downgrade a group), and **read the exit code, not the emptiness**.

### Done when

The plan's `## Done when` list is the specification. The assertions that exist
because a weaker implementation passes without them:

- **All five `worker_state()` outcomes survive to the row.** Assert `failed`
  renders differently from `finished`.
- **A failed worker lands in `waiting-on-you`**, not in `working`.
- **A pid of `0` never reads as running.** Assert the value survives the trip
  rather than being re-derived.
- **A claimed branch with NO worktree here says `claimed elsewhere`**, not
  `no known worker`. Assert the two strings differ.
- **A missing pid reads as unknown, not as nobody** — assert a hand-started
  worker is not reported dead.
- **A claimed branch WITH a running worker still reads as working.** The
  regression that matters: a check that reads every claim as unstarted is
  indistinguishable from a broken fleet.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`, `pnpm run typecheck`,
`pnpm run validate` all pass; `pnpm build:board` run **in your own worktree**
and the artifact committed (CI gates on no-diff); a changeset is present.
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's
`## Branches` section on `main`. **Push your first real commit as soon as it
exists** — this repo lost sight of finished work three times on one branch in a
single day because it was never pushed.

### Scope guard

`skills/plot/scripts/plot-fleet-scan.sh`, `packages/board/src/server/fleet.ts`,
the contract field that carries the worker state, and their tests.

**Branches in flight that overlap you:**
- `feature/dispatch-writes-brief` (your own wave) — holds
  `skills/plot-dispatch/SKILL.md` and `skills/plot-implement/SKILL.md`. Disjoint
  from you by design; that is why you run together.
- `feature/board-approve-affordance` — holds `PlanCard.tsx`, `schema.ts`,
  `board.ts`, `index.ts`. **`schema.ts` is contested** — keep your contract
  addition narrow and rebase rather than race.
- `feature/board-dims-when-lost` — holds `App.tsx`, `schema.ts`, `board.ts` and
  more. Same caution.

**Do not edit `plot-dispatch.sh`.** You read `worker_state()`'s output shape;
changing it belongs to wave 2 (`feature/dispatch-reports-no-worker`), which
rebases onto you.

`.gitattributes` marks `skills/plot/scripts/board/board-server.mjs` as `-merge`:
on a conflict there, take **either** side, run `pnpm build:board`, `git add` it,
continue. **Do not read that diff** — and expect it, because every board merge
invalidates every open board branch's artifact. Which side you take genuinely
cannot matter: the rebuild overwrites it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
