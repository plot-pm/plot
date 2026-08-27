## Implementation brief — a-closed-sprint-says-what-it-achieved (wave Reported)

- **Plan (canonical):** `docs/plans/2026-08-26-a-closed-sprint-says-what-it-achieved.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/the-scan-sees-a-stale-sprint-tally` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 2 of 2. **`Reconciled` merged as #457** — `/plot-sprint close` now ticks
items whose plan is delivered before it closes. This wave is the *reporting*
half: what has ALREADY drifted, which closing can never reach.

### What to build

`plot-reconcile-scan.sh` gains a section reporting **sprint items left unchecked
whose plan is delivered or released** — in CLOSED sprints as well as active ones.

### Why closed sprints are the point, not an edge case

A closed sprint's tally is never recomputed by anything. `/plot-sprint close`
(wave 1) fixes every sprint closed from now on; **nothing fixes the ones already
closed**, and those are the population this wave exists for.

Measured 2026-08-26 and re-verified during interrogation:

| sprint | reported | actually done |
|---|---|---|
| `2026-W34-the-board-tells-the-truth` | **1 of 13** | 12 of 13 |
| `2026-W34-working-shows-the-agent` | 10 of 11 | 11 of 11 |

Of the twelve unchecked in the first, **ten resolve to plans that are Delivered
or Released and none is still open**. Its retrospective, read today, is wrong
about its own subject.

**A scan that only reads ACTIVE sprints misses this entire population** — that
is Done-when 5, and it is the assertion a natural implementation fails.

### The decisions the plan settles — do not re-derive them

**Advisory, exactly like section 9.** It names the file, the item and the plan's
phase, prints the fix, and **gates nothing**. A closed sprint with a stale tick
is wrong, not broken, and rewriting history automatically is worse than
reporting it. Follow `index_drift=`'s shape: its own footer field, and it stays
out of `attention=`.

**Machine-countable footer field**, as every section has. The footer today reads:

```
summary: drift=0 merged_not_delivered=0 stale=0 claims=0 attention=0 concurrent=0
         unreleased_delivered=0 unsliced_waves=0 prose_wave_names=0 index_drift=0
         pr_source=gh main=main
```

Add yours in the same style. **Do not add it to `attention=`** — that is what
gates, and this does not.

**Read the PHASE, not the directory.** `plot-plan-meta.sh` answers the phase;
`/plot-deliver` deliberately made the `active/` symlink best-effort and said so:
*"an index that can only ever make a plan invisible is not a check."* Wave 1
(#457) moved the close-side guard onto the phase for exactly this reason — do
not reintroduce a directory test here.

**An item with no resolvable plan is not a finding.** These sprints carry bare
prose lines — *"Decide PR #57…"*, *"A release window: dispatch refuses…"* — with
no phase to read. Skip them silently or name them as unresolvable; never report
them as drift.

### Done when

The plan's `## Done when` items **5 and 6** are this wave's specification (1–4
and 4b belong to `Reconciled`, merged as #457).

- **Item 5** — the scan reports a stale tally in a **CLOSED** sprint. Assert
  against one of the two measured today; a scan that reads only active sprints
  passes nothing here.
- **Item 6** — the scan **gates nothing**. Its footer count is advisory, like
  `index_drift`.

Plus: `pnpm run validate`, `pnpm run test:reconcile`. Node 24 (`nvm use`); use
`corepack pnpm` if the homebrew one misbehaves. **`pnpm test` is NOT a test run
in this repo** — it is `skills add . --list` and prints an installer listing.

Add a changeset with a `bumps:` block for `plot`.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, so the
PR goes **inside** the heading:

```
### Reported (Branch: bug/the-scan-sees-a-stale-sprint-tally, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit. Push your first real commit as soon as it exists.

### Scope guard

This branch owns the new section and its footer field in
`skills/plot/scripts/plot-reconcile-scan.sh`, plus its tests.

**Do not touch `/plot-sprint`'s close step** — that is wave 1, merged as #457.

**Do not repair the two W34 sprints.** They were reconciled by hand on
2026-08-26, and that repair is what produced the measurement above. Your job is
the report, not the fix.

`plot-reconcile-scan.sh` was edited today by `a-degraded-scan-says-why` (#456),
which changed how `load_open_pr_branches` reports a failed host call. Rebase onto
current main and read that arm as it is now.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
