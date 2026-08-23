## Implementation brief — approval-hands-the-work-to-agents (wave: Served)

- **Plan (canonical):** `docs/plans/2026-08-22-approval-hands-the-work-to-agents.md` on `main`
- **Branch:** `feature/an-eligible-wave-starts-itself` (base: `main`)
- **Ends as:** one PR to `main`

Waves 1 and 2 merged: **#327** (the registry answers liveness) and **#329**
(the fleet controls — the switch and the stepper). You are wave 3, and the
reason the other two exist.

### What to build

**The switch is on and nothing happens.** Reported by the operator 2026-08-23
and confirmed: `/api/fleet` returns `fleetControls: {autoDispatch: true,
parallelAgents: 12}`, and **no code anywhere reads that flag to start work**.
Every consumer in the repo — `FleetControls.tsx`, `fleet-controls.ts`,
`AgentList.tsx:7354` — only stores or renders it.

While the switch is on, **eligible waves of approved plans dispatch with no
click**, honouring `plot-dispatch.sh`'s existing caps.

### The decisions the plan settles — do not re-derive them

**Wrap `plot-dispatch.sh`; do not reimplement dispatch.** It already owns the
claim-by-ref-push, the abandoned-desk refusal, the in-flight file report and the
worktree fan-out. Every one of those refusals must still apply when nobody is
watching — that is what makes automatic dispatch safe rather than merely fast.

**THE CAP IS A STANDING PROPERTY, NOT A PER-FAN-OUT ARGUMENT.** The plan is
explicit and this is the hard part:

> the number of live registry entries never exceeds the stepper's value, **across
> repeated pulses and not merely within one fan-out**, which is what `--max`
> alone cannot promise.

`--max N` bounds one invocation. Two pulses each dispatching N gives 2N live
workers. Count the **live registry entries** before each pulse and dispatch only
the difference. `#327` made that count answerable — it is why wave 1 came first.

**Lowering the number mid-flight stops the NEXT dispatch and leaves every running
worker alive.** Turning the switch off does the same. **Never kill a worker**: the
control governs starting, not stopping. A half-done branch killed mid-run leaves
uncommitted work nobody can see.

**Only `approved` plans, only `eligible` waves.** A blocked wave does not
dispatch; a draft plan's wave does not dispatch; a branch already claimed is not
dispatched twice. The claim ref is what makes the last one safe — do not add a
second mechanism beside it.

### Done when

The plan's test list for this branch is the specification and is unusually
precise. The assertions that exist because a naive implementation passes without
them:

- **Live entries never exceed the stepper ACROSS PULSES.** Assert over repeated
  pulses, not one fan-out. An implementation passing `--max N` per pulse passes
  every other test here and reaches 2N, 3N, …
- **Lowering the number mid-flight leaves running workers alive** — assert that
  the count of live workers is unchanged and only the next dispatch is withheld.
- A **blocked** wave and a **draft** plan's wave each do not dispatch.
- A wave that becomes eligible when its predecessor merges dispatches on the
  following pulse — the feature is worthless if it only fires once.

Plus: `nvm use` (Node 24 — pnpm crashes on 26), `pnpm test`,
`pnpm run test:board`, `pnpm build:board` with the artifact committed, and a
changeset with its `bumps:` block. **A new write route joins
`write-gate.test.mjs`'s `WRITE_ROUTES`** — a known trap here.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own the auto-dispatch trigger in `packages/board/src/server/`, its
registration, and its tests.

**Do not change the switch or the stepper** — they shipped in #329 and work.
**Do not change `plot-dispatch.sh`**; you call it. If its caps or refusals seem
wrong for this use, **stop and report** rather than editing the one script in the
fleet that writes.

`infra/the-derivations-leave-the-component` (#357) is moving 3000 lines out of
`AgentList.tsx`. Stay out of that file entirely — you need no client change.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
