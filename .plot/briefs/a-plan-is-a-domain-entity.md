## Implementation brief — a-plan-is-a-domain-entity (slice: Naming the plan and the slice)

- **Plan (canonical):** `docs/plans/2026-09-04-every-element-is-a-domain-concept.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-plan-is-a-domain-entity` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slices for `a-merge-is-a-domain-question`, `every-pr-question-goes-through-the-adapter`, `issue-tracking-is-its-own-port` and `a-branch-is-a-domain-entity` merged as **#706**, **#717**, **#718** and **#737**. This is the last one; it unblocks the plan's delivery.

## What this delivers

`Plan` and `Slice` as types, carrying the phase and eligibility rules that `plot-plan-meta.sh` and `plot-fleet-scan.sh` decide today.

## Plan and Slice must not collapse into one

**THEY ARE 1:1 — a Slice holds exactly one branch — so the distinction has to be argued rather than assumed.** The argument is ownership:

> **A plan writes the Slice; git writes the Branch.**

**And the two disagree constantly.** Measured 2026-09-04: the estate carries **33 annotations stating something about a branch that no ref can tell you** — 29 `deferred:`, 3 `moved:`, 1 `split-from:`. A deferred slice is a plan's decision about work it will not do; the branch it names may not exist, may exist unmerged, or may have merged under another plan.

**CLAUDE.md's terminology is binding here.** `DESIGN-slice.md` settles it: a **Slice** holds exactly one branch and belongs to one plan; a **Wave** is the fleet's cohort, spans plans, and is persisted nowhere. **The code still says `Wave` where it means `Slice`** — a known defect with its own plan, and **no new code may add to it.**

## What the parser already gives you

`plot-plan-meta.sh` is 494 lines with **4 world calls** — almost pure parsing, and it is the plan-format contract. **Read its output rather than reparsing plan files**: it already reports phase, type, title, sprint, story, branches, PRs, the ceremony answers, the transition records, and `builds` since #744.

**`transitions/branch.ts` and `transitions/plan.ts` both exist** — #737 landed the first, and the second holds `approve`/`deliver`/`release`. This slice names the entities those transitions already move.

## Done when

- `Plan` and `Slice` are types in the domain, and the ownership distinction is stated in the code
- the phase and eligibility rules they carry are the ones the two scripts decide today
- nothing new spells `Wave` where it means `Slice`
- `plot-plan-meta.sh`'s output shape is unchanged, and 196 plan files parse as they do now
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not collapse `Plan` and `Slice`.** 1:1 today; the ownership argument is what keeps them apart.
- **Do not add a new `Wave` that means `Slice`.** CLAUDE.md forbids adding to that defect.
- **Do not reparse plan files.** `plot-plan-meta.sh` is the contract.
- **Do not change the parser's output shape.** Every consumer on the estate reads it.
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc`.
