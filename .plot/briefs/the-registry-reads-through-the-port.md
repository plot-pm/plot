## Implementation brief — the-read-path-stops-spawning (wave 3: Registering)

- **Plan (canonical):** `docs/plans/2026-08-31-the-read-path-stops-spawning.md` on `main`
- **Branch:** `feature/the-registry-reads-through-the-port` (base: `main`)
- **Ends as:** one PR to `main`

**Third of four. Needs wave 2 landed, and needs an answer to the plan's first Open Question before it moves a line.**

### The question this slice must answer FIRST

> Does `registry.ts` belong in the read path or its own slice? It carries 5
> spawns and is read by the Agents tab, but it **also writes manifests**. Decide
> by reading its call sites, not by its name.

**That is the first deliverable, and it may shrink this slice.** A file that writes is not this plan's subject: the plan's own split is *"the READ path blocks every poll and every viewer; write routes block only the operator who clicked"*. If `registry.ts`'s spawns turn out to be mostly on the write side, migrating them here smuggles a write-route change into a read-path plan.

So: read the call sites, state which spawns serve a read and which serve a write, and **migrate only the read ones**. If that leaves a file half-migrated, say so in the PR — a documented half is honest; a silent whole is not.

### The surface, measured 2026-09-01

| file | lines | `execFileSync` |
|---|---|---|
| `registry.ts` | 836 | **5** |
| `agent-panel.ts` | 189 | **3** |

`agent-panel.ts` is small and read-only by name — confirm that rather than assume it, then it is the uncomplicated half of this slice.

### What waves 1 and 2 settled — do not re-derive

**The port is async and covered.** `packages/domain/src/ports/refs.ts` with `refs-git.ts` / `refs-fixture.ts` behind it (93% / 100% after wave 1). Extend, never fork.

**`PortResult` does not swallow errors.** The old `execFileSync` sites do — either by `catch { return '' }` or by throwing. Decide per site what an empty answer means.

**The async ripple lands in the tests.** Wave 1: one production change, 23 test failures across 5 files, all Promises read as values. Expect it.

**`tiny-garden.browser.test.ts` renders the shipped artifact** — rebuild with `pnpm build:board` before reading a failure there as a regression.

### The batching question is live here, not deferred

The plan's second Open Question bears on this slice specifically:

> Is one `Refs` call per question the right granularity, or does the board need a
> batched read? `cat-file --batch` exists precisely because per-object calls were
> too slow; a port that re-serialises it per plan would trade one blocking spawn
> for many awaited ones. **Measure before choosing.**

If this slice's migration produces a per-item loop over the port, measure the request before and after. Trading one blocking spawn for fifty awaited round trips is a regression the plan's own reasoning predicts.

### Done when

- Every `registry.ts` / `agent-panel.ts` spawn on a READ path is gone, and the ones left are named with the reason they stay.
- The Open Question is answered in the plan, not just in the PR — the next reader needs it.
- `/` answers in single-digit ms while an Agents-tab request is in flight.
- Repo gates: `pnpm run test:board`, `pnpm run typecheck`, `pnpm build:board`, `pnpm test`, changeset. Node 24 (`nvm use`), `corepack pnpm`.
- **Do not run `pnpm run test:e2e` locally** — it is CI's gate.

### Scope guard

Read paths only. A manifest write stays where it is, however tempting it looks beside a call you are already changing.
