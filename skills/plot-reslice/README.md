# plot-reslice

Slice a plan's multi-branch wave into one wave per branch — proposing the
names and the order, and letting a person confirm before writing.

## Purpose

Spoke of the Plot workflow. The manifesto defines a wave as holding **exactly
one branch** — a wave is the unit of ordering, a branch the unit of work, and
the two are one-to-one. A `### ` heading carrying several branch lines
violates that model: such a wave has no single verdict, so *a wave has one
section* is undefined over it, and any sprint rule that quantifies over waves
cannot hold.

`/plot-reslice` repairs that shape. It reads the entangled branches — their
diffs, PRs and conflicts — proposes one named wave per branch in an argued
dependency order, and rewrites **only** the plan's `## Branches` section once
a person confirms the order.

## Why it is a spoke command, not a script

Splitting the wave is mechanical; **naming the slices and ordering them is
judgement**. `Gated`, `Marked`, `Fitted` are words a person chose for what
each slice is *about*, and a wrong order blocks work that could have run in
parallel. That is why the repair cannot be one of the board's two licensed
write paths (wrapping a script, or a deterministic repair like
`plot-resolve-artifact.sh`): judgement is present, so the deterministic
licence is absent, and no script exists to wrap. The sanctioned third path is
the one `/api/idea` already uses — spawn a Plot agent — and this command is
what that agent runs.

See Manifesto Principle 3 (skills interpret and adapt; scripts collect and
report) and the memory `board-writes-wrap-scripts-or-are-licensed-repairs`.

## What it must not do

- **Never rename a branch.** The names are already in `## Branches` and carry
  live claim refs; a rename breaks every ref pointing at one. Only the `### `
  headings above the branch lines change.
- **Never reorder landed work.** A `complete` wave (every branch merged) is a
  record of how something shipped — the ordering already happened. The rule
  binds only waves with **unlanded work**.
- **Never merge or dispatch.** The repair produces a sliced plan;
  `/plot-dispatch` then does what it always does, one worktree per branch —
  which now means one per wave, as the model says.
- **Never propose churn on a healthy estate.** A plan already one-branch-per-
  wave yields **no proposal**.
- **Never write without confirmation.** Unattended (`PLOT_UNATTENDED=1`) it
  **stops** and emits a `PLOT-UNASKED:` line — the order is the judgement it
  cannot make alone, and the `## Branches` section is the source of truth.

## Tier

**Reusable / Publishable** — project-agnostic spoke of the Plot workflow.
Adopting projects configure via a `## Plot Config` section in their
`CLAUDE.md`. The plan format is unchanged: this command reads and writes the
same `## Branches` / `## Waves` shapes `plot-plan-meta.sh` already parses, and
touches neither the parser nor the board contract.

## Testing

Validated as part of the Plot end-to-end lifecycle tests, and by the
all-skills contract sweep (`test/reconcile/unattended.test.mjs`), which
verifies that the interaction line points at the shared unattended reference
and that every declared unattended shape carries a machine-readable
`PLOT-UNASKED:` line.

The behavioural properties this command guarantees:

- A multi-branch wave yields as many `### ` headings as it had branches, one
  branch line each.
- The branch **names are unchanged** — the parser's `branches` array is
  identical before and after; only the `waves` array changes.
- The rest of the plan file is **byte-identical**.
- A `complete` multi-branch wave is **left untouched**.
- A plan already one-branch-per-wave yields **no proposal**.
- No branch is dispatched and no PR is touched.

## Provenance

Originated in the plan
`docs/plans/2026-08-21-a-wave-is-one-branch.md` — *"A wave is one branch, and
an unsliced plan can be repaired"* — approved 2026-08-23. The board learned to
**see** an uncut slice (`stuckState`'s `unsliced-wave` arm) in the same
session the rule was defined; stopping there was deliberate, because a repair
that invents wave names would be the board making a plan decision. This
command is the sanctioned repair: it proposes, and a person confirms.

See [plot/README.md](../plot/README.md) for the full development history and
[plot/changelog.md](../plot/changelog.md) for commit-level details.

## Known Gaps

- Relies on `../plot/scripts/plot-plan-meta.sh`, `plot-fleet-scan.sh` and
  `plot-host.sh` via relative path — works with symlink installation but may
  need adjustment for other methods.
- Reads the branches' diffs and PRs to name the slices; where the host CLI is
  unavailable (e.g. Bitbucket for issue ops), the names lean on the diffs
  alone and the PR-derived evidence is thinner.

## Planned Improvements

- A companion report in `plot-reconcile-scan.sh` counting uncut slices so
  the estate can point at the plans this command should be run on (tracked by
  the sibling branch `feature/reconcile-counts-unsliced-waves`).
- A board menu item that spawns this command from an `unsliced-wave` row
  (tracked by the sibling branch `feature/the-board-offers-a-reslice`).
