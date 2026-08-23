## Implementation brief — done-means-delivered (wave: Verified)

- **Plan (canonical):** `docs/plans/2026-08-21-done-means-delivered.md` on `main`
- **Branch:** `feature/deliver-finds-prs-without-annotations` (base: `main`)
- **Ends as:** one PR to `main`

Wave 1 (`merged-waves-reach-testing`) merged as **#345**. You are wave 2.

### What to build

`/plot-deliver` matches **merged PR heads to branch names** where a plan carries
no `→ #N` annotation — which is what `plot-reconcile-scan.sh` already does.

### The decisions the plan settles — do not re-derive them

**The technique already exists; reuse its reasoning.**
`plot-reconcile-scan.sh` matches merged PR heads because *"the missing
annotation and the missing delivery share a cause, so an annotation-dependent
check is blind to exactly the plans it exists to catch."* That is the argument
for this wave too.

**This is real and current.** Measured 2026-08-23: five plans in the active
sprint have every branch merged and still read `Phase: Approved`, and at least
one carried no `→ #N` at all — I hit it delivering by hand this morning and had
to resolve the PR number manually.

**Matching must not weaken the gate.** A plan with an unmerged branch still
refuses, and names it. Finding a PR nobody annotated is a convenience; deciding
a plan is deliverable is still the same check.

### Done when

The plan's `## Branches` → *Verified* entry lists the tests explicitly: a plan
with zero annotations and all branches merged verifies; one with an unmerged
branch refuses and names it; annotated plans behave exactly as today.

Plus: `nvm use` (Node 24), `pnpm test`, `pnpm run test:e2e`, and a changeset
with its `bumps:` block. **No board rebuild** — you touch no board source. If
you find you do, stop and report it.

### Bookkeeping

Push your first real commit as soon as it exists. Append `→ #<number>` to this
branch's line in the plan's `## Branches` on **main** — check
`git branch --show-current` is `main` first.

### Scope guard

You own `skills/plot-deliver/SKILL.md` and any helper it calls, plus tests.

**Do NOT rename `Endgame` to `Testing`.** That is wave 4 of this same plan
(`feature/the-phase-after-development-is-testing`) and it touches the
`BOARD_PHASES` enum plus 13 plan files. Two branches renaming one enum member is
a conflict for nothing.

If you find something the plan did not anticipate, report it rather than
improvising outside scope.
