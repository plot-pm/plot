## Implementation brief — the-domain-speaks-slices (slice 3: Parsing)

- **Plan (canonical):** `docs/plans/2026-08-29-the-domain-speaks-slices.md` on `main`
- **Approved:** 2026-08-29, Jan Wloka, in-session
- **Branch:** `infra/a-plan-may-say-slices` (base: `main`)
- **Ends as:** one PR to `main`
- **Pulled ahead of slice 2**, deliberately. The scan reads this `blocked`
  because `Speaking` precedes it in the plan and the wave gate serialises
  *within* a plan. That gate asks about ORDER, not dependency — and verified
  2026-08-29, the two branches share **no file**: `Speaking` touches
  `packages/board/src/**` and this one touches
  `skills/plot/scripts/plot-plan-meta.sh` and `test/reconcile/`.

### What to build

Teach `skills/plot/scripts/plot-plan-meta.sh` to accept a **`## Slices`** heading
alongside the two it already handles.

**This parser has done exactly this before, and the precedent is the design.**
It already parses `## Branches` (the original spelling, still used by **30 live
plans**) and `## Waves` — *"both spellings are covered from one place"*
(`plot-plan-meta.sh:516`). Add the third **there**, not as a separate arm.

### The decisions the plan settles — do not re-derive them

**No existing plan file is rewritten. None.** 132 plans carry `## Waves` and 30
carry `## Branches`. A delivered plan describes what was built under the
vocabulary of its day; rewriting them edits the past to match the present and
churns every plan's `git blame` for a word. **This is the finding that made the
plan small — do not undo it by being helpful.**

**New plans may use the new spelling.** That is the whole deliverable: the
parser stops being the reason a plan cannot say what the spec says.

### Done when

Per the plan:

- **a plan with `## Slices` parses identically** to the same plan with
  `## Waves` — assert on *both* inputs and compare the parsed output, not on one
  plus a claim about the other
- **the 132 existing plans still parse** — verified by running the parser over
  `docs/plans/*.md`, not by reasoning
- **`plot-reconcile-scan.sh` reports the same counts before and after** — capture
  its footer on `main`, capture it again on your branch, diff them

Plus: `pnpm test` and `pnpm run test:reconcile` green, and a changeset with a
`bumps:` block naming the skill you touched.

**A caution specific to this file:** `plot-plan-meta.sh`'s awk region is
single-quoted, so **an apostrophe anywhere in an awk comment closes the shell
string early** and produces syntax errors far from the edit. Never write `awk's`
or `doesn't` in that region.

### Bookkeeping

- Push your first real commit **as soon as it exists**; push again after any rebase.
- When the PR exists, append `PR: #<number>` inside this slice's `### ` heading
  on main: `### Parsing (Branch: x, PR: #N)` — not a trailing arrow.
- Run every test in the FOREGROUND; a `-p` run has no next turn.

### Scope guard

**This branch owns:** `skills/plot/scripts/plot-plan-meta.sh` and its tests
under `test/reconcile/`.

**Do not touch `plot-fleet-scan.sh`.** It emits `"waves"` on the wire and that
is a separate migration step with its own timing.

**Shell suites in this repo fail falsely under worktree contention** — an
all-`ETIMEDOUT` run with a shifting failing set is load, not a defect. Re-run
the failing file alone before believing it.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
