## Implementation brief — a-wip-branch-nobody-is-on-is-not-startable (wave Spent)

- **Plan (canonical):** `docs/plans/2026-08-25-a-wip-branch-nobody-is-on-is-not-startable.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/auto-dispatch-skips-an-occupied-branch` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's only wave. Nothing waits on it and it waits on nothing.

### What to build

`planAutoDispatch` counts a `wip` branch as startable **only when a dispatch
could act on it**, and names the ones it skipped.

The reported failure, 2026-08-25: *auto-dispatch is checked, the wave is
eligible, and nothing starts.* Every precondition was true — `autoDispatch: true`,
`parallelAgents: 3`, `working: 2` so one free slot, plan `approved`, wave
`eligible`, branch unclaimed. It still never started.

Replaying the planner against the live pulse:

```
budget: 1
  WÜRDE DISPATCHEN: 2026-07-25-opus5-longhorizon-hardening.md max=1
  budget erschöpft bei 2026-08-20-a-dispatch-hands-over-a-brief.md
```

The whole budget goes to a July plan whose branch has been occupied for four
weeks, and `plot-dispatch.sh` answers `dispatched=0` because the ref exists.
Nothing changes state, so the cycle repeats on every pulse.

### The decisions the plan settles — do not re-derive them

**The pulse is NOT blind, and an earlier draft of this plan said it was.** That
was wrong, and re-deriving it would cost you the same detour:

- `plot-fleet-scan.sh:2528` already distinguishes **`claimed`** (only empty claim
  markers beyond main) from **`wip`** (real unlanded commits).
- The branch eating the budget reports `wip` — **honestly**, it carries three
  real commits.
- The registry already names which branches hold a live worker.

So nothing new needs collecting. `isStartable` accepting `wip` is the defect,
and that acceptance is deliberate and right for its original case: a wave
somebody began and abandoned should be resumable. It simply cannot tell that
case from *begun four weeks ago, consolidated into a PR, and left there on
purpose*.

**Measured on the estate:** of the four branches counted startable, **three were
`wip`** and one was `open` — and the `open` one is the only one a dispatch could
have acted on. It is also the one that never got a turn, because iteration runs
in file order and July sorts before August.

**No new host call.** `maybeAutoDispatch` runs inside the scan's success path;
per-branch network latency there is paid on every pulse. Everything needed is
already in the pulse and the registry.

**Do not reorder plans by recency.** Considered and rejected in the plan: it
treats the symptom. An occupied branch would still consume budget, just from a
different plan each pulse.

**Do not delete the claim, and do not touch `plot-dispatch.sh`.** Its ref-push
refusal is Plot's locking mechanism and stays exactly as it is; this wave stops
*planning* spawns it would refuse.

### Done when

The plan's `## Done when` list is the specification. Two items exist because a
naive implementation passes without them:

- **Item 2** — an `open` branch is still startable, and so is a `wip` branch with
  no ref. A fix that rejects every `wip` branch stops resumable waves entirely
  and still passes item 1.
- **Item 4** — the skip is named **at most once per pulse**. A message repeated
  every 5 s is noise, not a diagnostic.

Item 5 pins that no host call joins the scan's path — the existing no-network
test is the gate.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`) — pnpm crashes
on 26. Add a changeset with `'@plot-pm/board': patch` frontmatter.

### Bookkeeping

When the PR exists, annotate the wave heading on main — this is a `## Waves`
plan, so the PR goes **inside** the heading:

```
### Spent (Branch: bug/auto-dispatch-skips-an-occupied-branch, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/auto-dispatch.ts` and its tests.

**Do not touch** `plot-dispatch.sh`, `plot-fleet-scan.sh`'s state derivation, or
`liveAgentCount` — that last one is wave `Counted` of
`a-hung-child-does-not-hold-the-loop`, a separate approved plan, and the two
must not both edit it.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: generated, marked `-merge`. Never read its diff — take
either side, run `pnpm build:board`, stage the **rebuild** (not the merge's
copy), then commit. Staging before rebuilding produces a commit that looks
repaired and fails CI's freshness gate.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`
— every board suite rewrites it, and a dirty copy makes
`plot-resolve-artifact.sh` refuse with `worktree-busy`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
