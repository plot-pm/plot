# Implementation brief — monitoring-is-a-domain-concept (Sampling)

- **Plan (canonical):** `docs/plans/2026-08-30-monitoring-is-a-domain-concept.md` on main
- **Branch:** `feature/a-monitor-is-a-pure-rule` (base: `main`)
- **Ends as:** one PR to main
- **Runs first.** The other two slices depend on the rule existing.

### What to build

The WorkerMonitor's two-sample rule becomes a domain function:

```ts
sample(previous: Reading | null, current: Reading): Finding | null
```

**No clock, no sleep, no I/O.** The caller supplies both readings.

### Why it must be pure, and it is not a style preference

> *All monitors need to be part of the domain. **How else can the pulse trigger
> them?*** — operator, 2026-08-30

**A thing that owns its own `sleep` cannot be driven by anything else.** Take the
clock away and what remains is a rule. That is the entire argument.

### The seam already exists in the script

`plot-worker-monitor.sh` separates four measurements from one judgement:

```
monitor_pid_alive()         → 0 alive | 1 dead | 2 unknown
monitor_activity(pid)       → working | idle | ""
monitor_tree_fingerprint()  → an opaque string; unchanged means unchanged
monitor_has_commits()       → 0 yes | 1 no | 2 unanswerable
```

**Only `monitor_pass`'s judgement moves.** The four measurements stay in shell —
they are `ps`, `git` and `kill -0`, and shell is the right tool for those.

### Where the memory lives, and why it is the caller's

The script's own help states the constraint: *"a single pass can never publish
`idle` — that needs two."*

**So `previous` is an argument, not a field.** A monitor holding its own state is
the shape that forces it to own a loop, and owning a loop is what makes it
untriggerable. **The statelessness is the point.**

### Done when

- `sample(previous, current)` is in `packages/domain/src/rules/`, at the
  package's coverage threshold, with **no sleeping in any test**
- **every finding the script publishes today is reproduced by the rule against
  the same readings** — that is the equivalence proof, and it is what makes this
  a move rather than a rewrite
- `monitor_pass`'s judgement is gone from the shell

**The regression to lock:** an agent with **no commits** is never `idle`. It is
the monitor's middle row — *"it may be thinking about the first one"* — and the
condition most easily lost when a rule changes languages. **Write that test
before the rule.**

**A second one worth locking:** `monitor_activity` returns `""` for *unknown*.
**Collapsing unknown into `idle` is how a monitor invents a stall**, and a
`Finding | null` return makes that mistake easy to write.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:e2e` (with
`env -u PLOT_UNATTENDED`), changeset.

### Scope guard

The rule. Not the ports (next slice), not the cadence, not the PR monitor.

**The script keeps its loop for now.** Removing it is what makes a monitor
tickable, and nothing can tick it until the pulse exists — a rule that is
callable is useful before a caller arrives.
