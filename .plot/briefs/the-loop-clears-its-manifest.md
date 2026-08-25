## Implementation brief — a-hung-child-does-not-hold-the-loop (wave Reaped)

- **Plan (canonical):** `docs/plans/2026-08-25-a-hung-child-does-not-hold-the-loop.md` on main
- **Approved:** 2026-08-25, Jan Wloka, in-session
- **Branch:** `bug/the-loop-clears-its-manifest` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 3. `Bounded` merged as #426 — the loop now bounds how long it waits
for its agent. `Counted` (the cap) is independent of this one.

### What to build

`plot-worker-loop.sh` removes its manifest on **every** exit path via a `trap`,
so a worker that ends stops appearing in the registry.

The loop has **no trap at all** today. It ends three ways:

1. falling out of `while true` when `--next` exits 1 — the ordinary end
2. `break` on a failed `cd` or a lost claim race
3. **timeout**, added by #426

None of them removes `$PLOT_MANIFEST_FILE`.

### Why this is the second half of the same failure

Measured 2026-08-25: **13 live workers, 11 with an already-merged PR**, all
hung on the same unhandled rejection from the agent CLI. #426 stops them hanging.
This wave stops the *rows* outliving them.

The entry survives until the automatic reconciliation clears it, and that
requires the worktree to be **verifiably clean** — which a hung worker's rarely
is. So the board kept showing eleven workers that no longer existed, and
auto-dispatch counted them.

### The decisions the plan settles — do not re-derive them

**This changes who owns registry cleanup, deliberately.** Today the
reconciliation is the only remover, and it is a *sweep*: it answers *which
entries no longer correspond to anything?* A worker deleting its own manifest as
it exits answers a different, cheaper question: *I am leaving.*

**The sweep STAYS.** A trap cannot run on `SIGKILL`, so reconciliation is what
catches a worker killed outright. Done-when 8 asserts exactly that — removing the
sweep because the trap exists would trade one gap for another.

**All three exit paths, asserted separately.** They are separate `exit`s in the
script, so a trap wired to only one of them passes a single-case test and leaves
the defect. The plan's Done-when 7 names this.

### Done when

The plan's `## Done when` items 7, 8 and 12 are this wave's specification (1–6
belong to `Bounded`, already merged; 9–11 to `Counted`).

- **Item 7** — the manifest is gone after normal end, `break`, **and** timeout.
- **Item 8** — a worker killed with `SIGKILL` still leaves its manifest, and the
  reconciliation still clears it. **This is the assertion a naive implementation
  fails**: deleting the sweep once the trap exists passes item 7 and loses the
  SIGKILL case entirely.

Plus the repo's gates: `pnpm test`, `pnpm run test:reconcile`,
`pnpm run test:board`, `pnpm run typecheck`. Node 24 (`nvm use`). Add a
changeset with `'@plot-pm/board': patch` frontmatter.

**`plot-worker-loop.sh` launches every dispatched worker.** A syntax error there
breaks the whole fleet — run the shell suites before pushing.

### A trap that this repo already learned about

Two test failures in this plan's own waves came from platform assumptions:

- `PLOT_ACTIVITY_INTERVAL=0.3` was too tight for a shared CI runner (#424)
- `PATH='/usr/bin:/bin'` hides `timeout` on macOS and **nothing** on Linux (#426)

If your test needs to hide or time something, make it platform-independent and
generous. CI is slower and laid out differently than this machine.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Reaped (Branch: bug/the-loop-clears-its-manifest, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit.

**Push your first real commit as soon as it exists, and open the PR yourself.**
A worker on this plan's own `Bounded` wave finished 451 lines, pushed them, and
then stopped without opening a PR — its log ends *"I'm waiting on the background
board suite"*, a notification a `-p` run never receives. Run every test in the
FOREGROUND.

### Scope guard

This branch owns `skills/plot/scripts/plot-worker-loop.sh` and its tests.

**Do not touch** `liveAgentCount` — that is wave `Counted`, and
`bug/auto-dispatch-skips-an-occupied-branch` is live in `auto-dispatch.ts` right
now. Two branches editing that file would collide.

The board artifact `skills/plot/scripts/board/board-server.mjs` conflicts on
almost every merge: generated, marked `-merge`. Never read its diff — take
either side, run `pnpm build:board`, stage the **rebuild**, then commit.

Do not commit `packages/board/test/fixtures/tiny-garden/.plot/state/last-pulse.json`.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
