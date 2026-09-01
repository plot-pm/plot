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

## Half this slice is already built — verified 2026-09-01

**`plot-reap.sh` is done.** Its five refusals live in
`packages/domain/src/rules/reapable.ts` (6 exports), and the shell only renders the
verdict. Read `plot-reap.sh:400-422` before touching anything — its own comment
states the split: *"RENDERING, not deciding. The rule named the measurement; this
names what it means to someone reading the report."*

That is the target shape for dispatch. Copy it; do not invent a second one.

**It also means the dangerous half is finished.** Reap deletes worktrees — a wrong
refusal there removes a desk somebody is working at. What remains is dispatch,
which starts work rather than destroying it.

**Dispatch's remaining refusal sites, measured 2026-09-01:**

| line | refuses when |
|---|---|
| 468 | the agent manifest could not be written |
| 859 | `--restart` on a branch that already has a PR |
| 875 | `--restart` on a branch with a live worker pid |
| 887 | `--restart` on a branch holding a `PLOT-BLOCKED` marker |
| 1202 | the phase gate ref cannot be resolved — fails closed |

**1195 and 1202 are one decision with two outcomes, not two refusals.** The gate
refuses when `origin/<main>` is unreadable *unless* `--allow-local` was passed.
Model it as one rule taking `allowLocal` as a reading, or the escape hatch becomes
a branch in the shell again.
