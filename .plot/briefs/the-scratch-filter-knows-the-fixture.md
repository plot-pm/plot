## Implementation brief — working-lists-the-workers-that-are-working (wave Scratch)

- **Plan (canonical):** `docs/plans/2026-08-25-working-lists-the-workers-that-are-working.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/the-scratch-filter-knows-the-fixture` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

The plan's **last** wave. `Live` (#411), `Stalled` (#412) and `Dropped` (#416)
are merged; nothing waits on this one.

### What to build

`PLOT_TOOL_SCRATCH` names the tiny-garden pulse fixture, so a worker that did
nothing but run the test suite reconciles like any other.

One line, `skills/plot/scripts/plot-worker-state.sh:120`:

```sh
PLOT_TOOL_SCRATCH='(^|/)\.(playwright-mcp|plot/agents|omc/state)(/|$)'
```

The path to excuse is
`packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`. Note it
is `.plot/state`, not `.plot/agents` — the existing alternation does **not**
cover it.

### The decisions the plan settles — do not re-derive them

**Why this file and no other.** It is the one TRACKED path the test suite itself
mutates: every board suite rewrites it. Measured while writing the plan: **8 of
15 dirty worktrees were held by that path alone**, so the reconciliation could
never drop them and `.plot/agents/` accumulated dead entries. Reported on #407.

**Excusing it does not weaken the gate**, and that is the argument for doing it
here rather than more broadly: any *other* dirty path still keeps the entry. The
filter is an allowlist of paths the tools are known to churn, not a general
"ignore dirt" switch.

**This is a SECOND fix, not the main one.** The plan says so explicitly:
draining the registry faster does not make WORKING true, because a section whose
correctness depends on a cleanup job having run recently will be wrong again.
Wave `Live` already fixed the section by filtering to `LIVE_STATES`. Do not
re-litigate that; this wave is only about the fixture.

**Rules carried over:** absent is not false; read the exit code, not the
emptiness. And do not commit the fixture itself — see the scope guard.

### Done when

The plan's `## Done when` item 5 is the specification:

> A worktree dirty *only* with the tiny-garden pulse fixture reconciles as
> clean; a worktree dirty with anything else does not.

**Both halves, and the second is the one a naive implementation skips.** A
pattern broad enough to excuse the fixture can easily excuse every `.plot/`
path; the test that catches it is a worktree dirty with something else that must
still be held. Assert both directions.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`) — pnpm crashes
on 26. Add a changeset: a `skills/` change here still uses
`'@plot-pm/board': patch` frontmatter, which is this repo's established shape
(see `.changeset/20260822-the-parser-reads-a-wave-heading.md`).

`plot-worker-state.sh` is **sourced, not run**, by both `plot-dispatch.sh` and
`plot-fleet-scan.sh`. A syntax error there breaks the fleet scan and dispatch
together, so run the shell suites before pushing.

### Bookkeeping

When the PR exists, annotate the wave heading on main — this is a `## Waves`
plan, so the PR goes **inside** the heading:

```
### Scratch (Branch: bug/the-scratch-filter-knows-the-fixture, PR: #N)
```

A trailing `→ #N` parses as `prs=[]` on a Waves plan. Check
`git branch --show-current` is main before that edit. Push your first real
commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-worker-state.sh` and its tests.

**Do NOT commit
`packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.** Every
board suite rewrites it; committing it is the noise this wave exists to stop
being counted. `git checkout --` it before every commit.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge right now — it is generated and marked `-merge`. Never read
its diff: take either side, run `pnpm build:board`, stage the REBUILD (not the
merge's copy), and commit.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
