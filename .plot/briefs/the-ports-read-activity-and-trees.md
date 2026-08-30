# Implementation brief — monitoring-is-a-domain-concept (Measuring)

- **Plan (canonical):** `docs/plans/2026-08-30-monitoring-is-a-domain-concept.md` on main
- **Branch:** `feature/the-ports-read-activity-and-trees` (base: `main`)
- **Ends as:** one PR to main
- **Depends on Sampling** for the rule that will consume whatever this settles.

### What to build

**Answer one question in writing: does any port change at all?**

A first draft of the plan said two operations were missing. **Challenged
2026-08-30, both claims fell:**

| reading | status |
|---|---|
| pid alive | `Processes.isAlive` — **exists** |
| worker state | `Processes.workerState` — **exists** |
| **CPU activity** | `ProcessReading.activity: WorkerActivity` — **exists**, documented as *"whether a running worker's descendants are burning CPU"* |
| tree clean / markers | `Trees.isClean`, `Trees.markers` — **exists** |
| **tree fingerprint** | **a composition, not a reading** |

### The fingerprint is the whole question

`monitor_tree_fingerprint` is two readings and a filter:

```sh
head=$(git -C "$worktree" rev-parse HEAD)
status=$(git -C "$worktree" status --porcelain)   # then dirty-filtered
printf '%s\n%s' "$head" "$status"
```

**Both halves are already reachable** — `Refs` for the head, `Trees` for the
status. What is not reachable is the **combination**, and the dirty filter that
decides which changes count.

**The likely answer is that the RULE composes it**: a domain function given a
head and a status can produce the fingerprint itself, and then no port changes.

**That is the finding this slice exists to produce.** Say it in writing.

### Done when

**Either:**

- the rule composes the fingerprint from existing ports, **and this slice closes
  with no code** — a written answer with the reasoning is a finished slice

**Or:**

- a port gains **one** operation, **with the reason it could not be composed**,
  and the shell function becomes its implementation rather than a second copy

**If a port does change**, one property must hold: **a `PortResult`
distinguishes *cannot answer* from *no*.** `monitor_activity` already returns
`""` for unknown, and collapsing that into a definite answer is how a monitor
invents a stall.

Plus: `pnpm test`, `pnpm run typecheck`, changeset **only if code changed** —
a documented negative result needs none.

### Scope guard

The composition question. Not the rule (previous slice), not the PR monitor
(next), not `workerState`'s signature.

**One thing named so you do not stop to wonder:** `workerState(worktree, hasPr)`
takes a **host fact into a process port**. It is documented (*"refines
`finished`"*) and it works. **Not yours to change** — recorded because a slice
reading these ports closely will notice it.
