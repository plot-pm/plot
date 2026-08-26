## Implementation brief — a-closed-sprint-says-what-it-achieved (wave Reconciled)

- **Plan (canonical):** `docs/plans/2026-08-26-a-closed-sprint-says-what-it-achieved.md` on main
- **Approved:** 2026-08-26, Jan Wloka, in-session
- **Branch:** `bug/closing-a-sprint-reconciles-its-tally` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** repo convention (CI green + review)

Wave 1 of 2. `Reported` (`bug/the-scan-sees-a-stale-sprint-tally`) is the scan
side and is held back — `plot-reconcile-scan.sh` is occupied by
`bug/a-degraded-scan-says-why` right now.

### What to build

`/plot-sprint close` reconciles its checkboxes against each plan's phase before
it flips the sprint, so an item whose plan has been delivered is not recorded as
unfinished.

### The measurement, verified

Two closed sprints understated what they achieved:

| sprint | reported at close | actually done |
|---|---|---|
| `2026-W34-the-board-tells-the-truth` | **1 of 13** | 12 of 13 |
| `2026-W34-working-shows-the-agent` | 10 of 11 | 11 of 11 |

Re-verified 2026-08-26: the first reads `Phase: Closed` with **1 checked, 12
unchecked**, and of those twelve, **ten resolve to plans that are Delivered or
Released and none is still open**. Its retrospective, read today, is wrong about
its own subject.

### One direction is guarded, the other is not

`/plot-sprint close` already refuses on a **checked box over an undelivered
plan** — a false completion (`SKILL.md`, the "False-positive completions"
block). **That guard is right and stays** (Done-when 4).

Nothing checks the inverse: an **unchecked box over a delivered plan**. It is a
false *incompletion*, and it is the one that happened, eleven times.

The rule already exists in the estate — `plot-sprint-release.sh` states it for
the ACTIVE case: *"a checked box over an undelivered plan is `disputed`, while
an unchecked box over a delivered one is `done`, because `/plot-deliver` moves
the plan and nobody re-ticks the box."* It is simply never applied at CLOSE,
which is the moment the tally stops being recomputed and becomes the record.

### The decisions the plan settles — do not re-derive them

**Tick on the plan's own PHASE, never on a re-reading of the work.** The phase is
a recorded transition with a date. Judging *"is this really done?"* from the diff
at close time is a different and much larger act, and not what the checkbox
means.

**BOTH directions must read the phase, not the directory** (Done-when 4b). The
existing guard detects false completions by asking whether the plan is in
`active/`; this wave's new step reads the phase via `plot-plan-meta.sh`. Move the
old one onto the phase too.

Why: `/plot-deliver` deliberately made the phase edit the transition and the
index write **best-effort**, saying so outright — *"an index that can only ever
make a plan invisible is not a check."* So a delivered plan whose symlink move
failed would be reported by the old guard as a false completion, refusing on the
bookkeeping of work that shipped. **Measured: zero plans are in that state
today**, so this is a fix against drift, not a live bug — assert it with a test,
not against the estate.

**An item with NO resolvable plan is left alone and named** (Done-when 3). These
sprints carry bare prose lines — *"Decide PR #57…"*, *"A release window: dispatch
refuses…"* — with no phase to read. A step that ticks what it cannot verify is
the false completion the existing guard exists to prevent.

**Not chosen: refuse to close while items disagree.** Symmetrical with the
existing guard and rejected: a false incompletion harms nobody at close time —
the work is done either way — while a refusal blocks an operator from closing a
finished sprint over bookkeeping.

**Not chosen: recompute the tally on every read.** The checkbox is a person's
mark; a sprint can legitimately hold an item that is done but was descoped. The
reconcile ASKS; it does not assume.

### Done when

The plan's `## Done when` list is the specification — items 1, 2, 3, 4 and 4b are
this wave's (5, 6 belong to `Reported`). Two exist because a naive
implementation passes without them:

- **Item 2** — it ticks a `delivered` plan as well as a `released` one.
  Otherwise it misses every plan that shipped in an unreleased version, which is
  most of them at close time.
- **Item 3** — a prose line is untouched and named.

Plus: `pnpm run validate`, `pnpm run test:reconcile`. Node 24 (`nvm use`).
**`pnpm test` is NOT a test run here.** Add a changeset with a `bumps:` block for
`plot-sprint`.

Every skill question needs a `PLOT-UNASKED` line; a repo-wide test sweeps all
skills for that shape.

### Bookkeeping

When the PR exists, annotate the wave heading on main — `## Waves` plan, PR
**inside** the heading:

```
### Reconciled (Branch: bug/closing-a-sprint-reconciles-its-tally, PR: #N)
```

A trailing `→ #N` parses as `prs=[]`. Check `git branch --show-current` is main
before that edit.

### Scope guard

This branch owns the close step in `skills/plot-sprint/SKILL.md`.

**Do not touch `plot-reconcile-scan.sh`** — that is wave 2 AND
`bug/a-degraded-scan-says-why` is live in it right now. Two branches editing it
would collide.

**Do not repair the two W34 sprints by hand.** They were reconciled manually on
2026-08-26 already; that repair is what produced the measurement.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
