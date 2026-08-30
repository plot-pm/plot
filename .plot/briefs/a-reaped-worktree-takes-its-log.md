## Implementation brief — a-log-lives-with-its-worktree (slice 4: Reaping)

- **Plan (canonical):** `docs/plans/2026-08-30-a-log-lives-with-its-worktree.md` on `main`
- **Branch:** `bug/a-reaped-worktree-takes-its-log` (base: `main`)
- **Ends as:** one PR to `main`

Best after slice 3, so the removal is added to a script whose decision half has
already moved. Not a hard dependency.

### What to build

`plot-reap.sh` removes the dispatcher log after the manifest.

### The decisions the plan settles — do not re-derive them

**Three things, in this order:**

```
worktree  →  manifest  →  log
```

**The order of the first two is already load-bearing and the script says why**:
worktree first, because the reverse leaves a live worktree with no manifest.
**The log goes last because it is the only one that is pure cleanup** — a
missing log breaks nothing, while a missing manifest orphans an agent.

**A missing log is not a refusal.** The five refusals are about work that might
be lost; a log describes work that is already merged. `rm -f` semantics: if it
is not there, that is the desired state.

**It is not the transcript.** `.plot-worker.log` lives INSIDE the worktree and
goes with it; this is the dispatcher's own record of what it started, and
CLAUDE.md already distinguishes the two. Do not conflate them.

**Why this is worth doing at all:** measured 2026-08-30, **190 log files, 2.6 MB**
beside the repository, oldest from 2026-08-17, and **not one belonging to live
work**. `plot-reap.sh` took the worktree and the manifest every time and left
the log forever.

### Done when

The plan's Reaping `Done when`: reaping removes the log; a reap whose log is
already gone still succeeds; `--dry-run` names the log it would remove; the
e2e suite passes **unedited**.

**The five refusals must be unchanged** — assert it, because this slice touches
the script that holds them.

Repo gates: `pnpm test`, `pnpm run test:reconcile`, `pnpm run test:e2e` (with
`env -u PLOT_UNATTENDED`), changeset. Node 24, `corepack pnpm`.

### Scope guard

Owns the log removal. **Does not change a refusal**, does not touch
`.plot-worker.log` inside the worktree.
