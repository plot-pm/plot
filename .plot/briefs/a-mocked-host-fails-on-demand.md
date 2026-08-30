# Implementation brief — the-exclusion-names-what-it-hides (Covering)

- **Plan (canonical):** `docs/plans/2026-08-30-the-exclusion-names-what-it-hides.md` on main
- **Branch:** `infra/a-mocked-host-fails-on-demand` (base: `main`)
- **Ends as:** one PR to main
- **Depends on the Measuring slice.** Without its named list and its baseline,
  there is nothing to shrink and nothing to shrink it against.

### What to build

Close the two outliers with **mocked failures**:

```
src/adapters/host    57.50 lines   12.24 branches
src/adapters/clock   50.00          0.00
```

Every other adapter is between 65% and 100%. These two are the case the sprint
goal names directly: *a mocked host can fail on demand*.

### The decisions the plan settles — do not re-derive them

**The assertion that matters is the SHRINK, not the number.** New tests that
raise coverage while leaving the exclusion list unchanged have improved a metric
without changing what the package claims about itself. **Every branch you cover
comes off the list, in the same PR.**

**The existing comment's warning still binds** (`vitest.config.ts:32-43`):

> *a threshold that forces those to be faked teaches people to fake them*

So a mocked failure has to be a **failure the adapter could really meet**. A
stub that returns a shape the host never produces covers a branch and proves
nothing — it is the faking the comment predicts, wearing a green number.

### What to mock, and what it must look like

**`host-shell.ts`** — the failures are real and this repo has met all of them:

- a **non-zero exit with empty stdout** (`gh` under a rate limit — measured
  2026-08-30 against a nonexistent repo: `exit=1`, stdout empty)
- **malformed JSON** on stdout where the caller expects a document
- an **empty list from a healthy host**, which must stay distinguishable from
  both of the above — *absent is not none* is this repo's rule and the reason
  `a-throttled-host-says-so` exists

**`clock-system.ts`** at 0% branches — exercise its paths without waiting for
real time. If the only way to reach a branch is to sleep, that branch is a
candidate for staying excluded **with its reason written down**, not for a test
that sleeps.

### Done when

- `host-shell.ts` and `clock-system.ts` are no longer the outliers
- **the exclusion list shrinks by whatever these cover**, in this PR
- the threshold is raised to match, and holds on a clean run
- **a mocked failure corresponds to a failure the real adapter can meet** — say
  in the PR, per mock, which real condition it stands for

**What stays excluded is a finding, not a failure.** If a branch genuinely needs
a full disk or a signal mid-write, keep it excluded and **write the reason**.
That is the goal's actual requirement: named rather than assumed.

Plus: `pnpm test`, `pnpm run typecheck`, `pnpm --filter @plot-pm/domain test`,
changeset.

### Scope guard

The two outliers and the list they shrink. Not the other seven adapters, not the
purity grep, not the corpus tests — those are the non-coverage protections the
config names, and they stay as they are.

**Do not chase 100%.** The goal does not ask for it, and the comment explains
why asking would be worse than not.
