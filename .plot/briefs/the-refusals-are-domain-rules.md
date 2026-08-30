# Implementation brief — production-calls (Refusing)

- **Plan (canonical):** `docs/plans/2026-08-28-production-calls-the-domain-one-rule-at-a-time.md` on main
- **Branch:** `feature/the-refusals-are-domain-rules` (base: `main`)
- **Ends as:** one PR to main
- **Gated with the plan** — see the Delivering brief.

### What to build

The refusals — the conditions under which a command declines — become domain
rules.

### Refusals are the highest-stakes rules in this repo

They are what stands between a cleanup and losing work. **Measured 2026-08-30:**

- `plot-reap.sh`'s refusals **saved two changesets** for PRs #491 and #493,
  whose changesets existed nowhere else
- and its **fifth** refusal was broken for months — it matched a legacy path
  prefix and therefore saw **no worktrees at all**, reporting `reapable=0` when
  it meant *nothing was looked at*

**Both facts are the same lesson:** a refusal that is wrong in the permissive
direction destroys work, and one that is wrong in the strict direction hides
that it is doing nothing.

### Done when

- each refusal is a named value returned by a rule, **individually triggerable
  against fixtures**
- the rule is at the package's coverage threshold
- **the script contains no `if` about whether an operation may proceed**
- the old implementations are deleted in the same commit

**The assertion that carries this slice:** for each command whose refusals move,
**`--dry-run` output is byte-identical before and after on the same estate.**

**And the trap that assertion has already sprung once:** `plot-reap.sh`'s
baseline was empty by defect, so a byte-identical comparison would have proven
the rewrite was faithfully *blind*. **Check that your before-state is
non-trivial** — a baseline with zero rows proves nothing.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm run test:reconcile`, changeset.

### Scope guard

The refusals. Not eligibility, not deliverability, not the spawning.

**A refusal you cannot trigger in a test is a refusal you cannot verify moved.**
If one depends on something a fixture cannot produce, say so in the PR rather
than moving it untested.
