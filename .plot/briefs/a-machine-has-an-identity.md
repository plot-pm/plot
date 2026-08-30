# Implementation brief — a-machine-is-an-instance (Correcting)

- **Plan (canonical):** `docs/plans/2026-08-30-a-machine-is-an-instance.md` on main
- **Branch:** `docs/a-machine-has-an-identity` (base: `main`)
- **Ends as:** one PR to main
- **The plan's only slice, and a docs change.** No code moves.

### What to build

`DESIGN-machine.md` stops claiming a Machine has no identity.

### The spec named the exact condition under which it would be wrong

> *A Machine has no identity, because there is exactly one.* … *That singularity
> is load-bearing: **if there were two, headroom would be a property of a pair
> and the whole entity would need a key.***

**Measured 2026-08-30 — each verified for a `## Plot Config` section AND a
`.plot/` directory, not merely a name:**

```
Agentic-Tools/plot          Plot Config: yes    .plot/: yes
Agentic-Tools/agent-skills  Plot Config: yes    .plot/: yes
EKZ.Webportal/ekzweb        Plot Config: yes    .plot/: yes

hostname:  ani              the same string for all three
```

**The spec was not careless.** It stated its own falsifying condition, and the
condition became the working environment.

### The two entities

| | **Machine** (instance) | **Computer** (hardware) |
|---|---|---|
| identified by | `hostname` + short id | `hostname()` |
| how many | one per Plot project | one |
| owns | its pulse, fleet, estate, divisors | `spawnCostMs`, `loadAverage`, `cores` |
| answers | *whose clock is this?* | *can anything fork cheaply now?* |

**Three instances measuring one spawn cost is not duplication** — it is three
tenants reading one meter. The spec already says so without drawing the
conclusion: *"headroom is not this fleet's headroom, it is the machine's, and
the fleet is one tenant among several."* Read against three instances, *"the
machine"* there means the hardware.

### The one decision this slice makes

**What the short id derives from.** Both candidates are recorded; pick one and
say why:

| | three projects | a board in a worktree |
|---|---|---|
| `basename(repoRoot)` | readable | **`bug-the-loop-reads-the-monitor`** — renames itself with the branch, vanishes when reaped |
| hash of `repoRoot + scriptsDir` | `0a2719e3`… opaque | stable across a rename |

**The worktree case is not hypothetical**: this repo starts boards from
worktrees in its own suite.

**And whatever you choose must cover both axes.** `repoRoot` is
`PLOT_REPO_ROOT ?? process.cwd()`; `scriptsDir` is `PLOT_SCRIPTS_DIR ??` the
artifact's directory (`index.ts:64-65`). **They vary independently**, and
`fleet.ts:648` already keys on both — an id from the repo alone merges two
machines the cache keeps apart.

### Done when

The plan's list, and two deserve emphasis:

- **the fields table separates hardware readings from instance ones** — that is
  the correction, not a note beside it
- **`parallelAgents` is described as a claimed share whose default is not a
  measurement.** Measured: only `plot` has a `fleet-controls.json` at all; the
  other two run on config-seeded defaults. **An unset share is still a share** —
  a machine that never chose still takes CPU

**Record the visibility gap, do not solve it:** nothing reports the sum of three
instances' claims. A docs plan that grew a scheduler would be the wrong shape.

Plus: `pnpm test` green — a docs change should touch nothing else. **If the
correction implies a code change, that is a finding for the PR**, not an edit:
the spec is what was wrong.

### Scope guard

`DESIGN-machine.md`. **Not `packages/domain`**, not `ports/machine.ts`'s
`hostname()`, not the cache key — all three are already correct under this
reading, which is the plan's point.

**Do not rename `Machine` to `Instance`.** The word appears in `DESIGN-agent.md`,
`DESIGN-worktree.md`, `ports/machine.ts`, `entities/machine.ts`, its adapter and
its tests. A rename is a large diff that changes no meaning — and the meaning
was never wrong, only the count.
