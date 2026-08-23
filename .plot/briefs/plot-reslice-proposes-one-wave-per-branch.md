## Implementation brief — a-wave-is-one-branch (wave 1)

- **Plan (canonical):** `docs/plans/2026-08-21-a-wave-is-one-branch.md` on `main`
- **Approved:** 2026-08-23, Jan Wloka, in-session
- **Branch:** `feature/plot-reslice-proposes-one-wave-per-branch` (base: `main`)
- **Ends as:** one PR to `main`

### What to build

**A way to slice an invalid wave into valid ones.** The board can already SEE the
defect — `unsliced-wave`, five branches under
`opus5-longhorizon-hardening :: Implementation`, blocked 26 days — and cannot act
on it.

**Why the 2.9.0 sprint needs this:** an unsliced wave has **no single verdict**,
so the rule *a wave has exactly one section* is **undefined** over it. The
sprint's other rules cannot hold over a wave the model cannot describe.

### The decisions the plan settles — do not re-derive them

**Slice the wave; never do the work in it.** This is the scope line and it is
written into the plan's Design:

| | in scope |
|---|---|
| splitting `### Implementation` into five waves in the plan file | **yes** |
| building the six branches | **no** — `opus5-longhorizon-hardening` is out of this sprint |

**Deferring the branches was considered and rejected.** Marking them
`<!-- deferred: -->` exempts them from the merge gate, so the wave would complete
— but that claims work is *done* which is merely *unstarted*. **A verdict earned
by annotation rather than by merging is the false completion this whole release
removes.** Five blocked waves is the honest outcome.

**It PROPOSES; a person confirms.** The plan's own branch name says so. Rewriting
a plan's `## Branches` section unattended would edit the one artifact Plot treats
as the source of truth.

### Done when

The plan's `## Done when` is the specification. Beyond it:

- A five-branch wave yields **five waves, each with one branch**, and the branch
  names are unchanged — a reslice that renames a branch breaks every claim ref
  pointing at it.
- The plan file's other sections are **untouched**. Assert it: a rewriter that
  reformats the whole file passes any test that only checks the wave count.
- **Nothing is written without confirmation.**
- A plan that is already one-branch-per-wave yields **no proposal** — otherwise
  the tool proposes churn on a healthy estate.

Plus the repo's gates: `nvm use` (Node 24), `pnpm test`, `pnpm run test:reconcile`
(this touches the plan format — that suite is its contract), `trash` not `rm`.

### Bookkeeping

Append `→ #<number>` to this branch's line on `main` when the PR exists. **Push
your first real commit as soon as it exists**, and run tests in the foreground —
three workers stalled today with sound work uncommitted.

### Scope guard

You own the reslice proposal. **`plot-plan-meta.sh` is the plan-format contract
and has 614 contract tests** — if you change it, they must stay green.

Do not edit `opus5-longhorizon-hardening`'s plan as part of this branch; proving
the tool on it is a demonstration, not a deliverable.
