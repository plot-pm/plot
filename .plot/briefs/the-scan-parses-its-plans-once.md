## Implementation brief — the-scan-parses-its-plans-once

- **Plan (canonical):** `docs/plans/2026-08-27-the-scan-parses-its-plans-once.md` on main
- **Approved:** 2026-08-27, Jan Wloka, in-session
- **Branch:** `bug/the-scan-parses-its-plans-once` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (CI green + a human merges)

Single branch; nothing waits on it and it waits on nothing.

### What to build

`plot-fleet-scan.sh` spawns a process per plan, twice over: once for
`plot-plan-meta.sh`, then a fresh `python3` per plan to re-parse that helper's
own output. Batch both.

`plot-plan-meta.sh` **already takes a list**, and `board.ts:599` already calls it
that way — its docstring says *"Run the plan-format helper once over all plan
files."* The scan is the caller that does not.

The plan is canonical; this is orientation.

### The decisions the plan settles — do not re-derive them

**READ THE PLAN'S MEASUREMENT SECTION FIRST.** It was rewritten on 2026-08-27
and its headline reversed. The plan originally justified itself with *"the scan
times out at 462.9 s"* — that reading was an outlier regime, not the steady
state. Instrumented sampling records **~39 s online, 27 s offline** on a
comparable estate, with four consecutive samples varying by 1.8 s. **The scan is
not currently timing out.** Do not reintroduce the timeout framing, and do not
be surprised when the symptom you were sent to fix is absent.

**What survives is the CPU claim, and it is solid.** At `--offline` the scan runs
at **86.8 % CPU** — it is computing, not waiting. Re-measured on main
2026-08-27: **463 `python3` spawns, 319 `plot-plan-meta.sh` spawns** (the plan
was written with 454 and 324). The mechanism is unchanged and unfixed.

**The cost tracks PLAN COUNT, not estate size.** 283 plans × 2 spawns ≈ the 463
measured. Reaping worktrees does nothing: 12 worktrees → 38.91 s, 10 worktrees →
39.31 s, inside the noise band. A Released plan
(`the-timeout-report-blames-the-wrong-thing`) already refuted the estate-size
inference; do not re-derive it.

**This is NOT what the four Released scan-performance plans fixed.** They fixed
**host API** N+1 — one bulk `pr-list` instead of per-branch `pr-state`. That was
real and it worked. The local-subprocess N+1 is a different cost with the same
shape, and nobody had measured it. Do not touch the host path.

**The batch call is ~300× cheaper**: one plan 0.01 s, all plans 0.19 s in a
single invocation.

**Item 1 changed with the measurement.** The old *"completes inside 90 s"* is now
passable by a no-op, so the assertion is a **differential CPU comparison**,
`--offline` on both sides, baseline taken in the same run. Read item 1 before
writing the test.

### Done when

The plan's `## Done when` list is the specification. The items that exist
*because a naive implementation would pass without them*:

- **Item 2 asserts SPAWN COUNT, not duration** — a timing assertion is flaky on a
  loaded machine; the count is the fact that produces the timing. 319 → 1.
- **Item 3** — `python3` spawns must not scale with plan count either. Batching
  the parse while leaving ~463 interpreters running satisfies item 2 and saves
  about 3 s of 30. **Both halves or neither.**
- **Item 4 — output byte-identical.** This is a performance change; a verdict
  that moves is a regression, and `--next`, `--json`, the board and
  `plot-dispatch.sh` all read it. Diff a full run before and after.
- **Item 5 — no host call added or removed.** Asserted by the existing
  no-network test.
- **Item 6 — a malformed plan must not take the estate down.** The batch call is
  exactly where one bad file can poison every result; report what could be read.

Plus the repo's gates: `pnpm run validate`, `pnpm test`,
`pnpm run test:reconcile` green; a changeset with a `bumps:` block naming `plot`
(a `skills/plot/` change, NOT package frontmatter); Node 24 (`nvm use`, and
`corepack pnpm` — homebrew pnpm runs its own node and crashes); `trash` not `rm`.

### Bookkeeping

When the PR is created, annotate this branch's line in the plan's `## Branches`
section on main with a trailing `→ #N`. Check `git branch --show-current` is
main first, or use a detached scratch worktree
(`git worktree add --detach <path> origin/main`).

Push your first real commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-fleet-scan.sh` and its tests.

`bug/a-degraded-scan-says-why` holds `plot-reconcile-scan.sh` and
`test/reconcile/scan.test.mjs` — a different script, but check
`test/reconcile/` before adding a file there. Rebase onto current main before
you start.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
