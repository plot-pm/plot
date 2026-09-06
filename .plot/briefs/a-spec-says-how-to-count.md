## Implementation brief — a-spec-says-how-to-count (slice: The specs cite the command, not its output)

- **Plan (canonical):** `docs/plans/2026-09-05-the-slice-contract-says-what-it-reads.md` on `main`
- **Story:** `the-master-agent-holds-the-fleet`
- **Branch:** `docs/a-spec-says-how-to-count` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 2 of two. Slice 1 merged as **#727** — an empty slice no longer reads as `complete`, and `eligible.ts` and `deliverable.ts` now agree about the shape.

## What this delivers

`DESIGN-slice.md` and `DESIGN-plan.md` stop carrying slice counts and name the command that produces them.

## Why, and the argument is now demonstrable

**The numbers were wrong when the plan found them.** `DESIGN-slice.md:63` says *"271 held one branch, 21 held several, 11 held none"* across 158 plans; `DESIGN-plan.md` reports its field table against 158 plans throughout. The two disagreed about one property by a factor of three, and each was right when written.

**Re-measured 2026-09-06 through `plot-plan-meta.sh`, which is the contract:**

```
plans: 217   slices: 495   multi-branch: 24   empty: 22
```

**The shapes held and the population did not.** 21 → 24 and 11 → 22 are drift; **158 → 217 plans is 37% in weeks**, and every count in both specs is stated against the smaller number. A new number goes stale the same way one cycle later.

**One measurement worth carrying into the change.** A hand-rolled markdown scan over the same files answered `multi-branch: 106, empty: 181` — the parser answers 24 and 22. The difference is prose subheadings under `## Slices` that a regex reads as slices and the parser does not. **That is the reason a spec must name the command rather than any number**: two readers counting "the same" property by different means differ by 4x, and only one of them is the contract.

## What to change

**Both specs, and only where a count is asserted.**

- `DESIGN-slice.md` — §8 Scope, the `| 8 | ... one slice, one branch — and the 32 that disagree |` contents row, and the measured paragraph at `:63`.
- `DESIGN-plan.md` — the field table at `:169`–`:228` states *"Validated field by field against the parser's output over all 158 plans"* and gives per-field counts (`story` 121, `rounds` 68, `phase_alt` 0/158, `design_raw` 0/158).

**The field table is the harder case and it is not a simple deletion.** Its counts carry an argument: `rounds` at 68 of 158 makes the point that it is *"an optional KEY, not just an optional value"*, and `phase_alt` at 0/158 distinguishes *a conflict nobody has hit* from *a state nobody has entered*. **Keep the arguments; make the numbers reproducible.** Name the command that regenerates the table and mark the figures as a dated sample rather than a standing fact.

**The command to name for slice shapes is the reconcile scan**, which already reports both of them:

```
skills/plot/scripts/plot-reconcile-scan.sh
  → uncut_slices=       a slice holding more than one branch
  → prose_slice_names=  a heading the parser reads as a slice with no branch
```

Both are in the machine-countable footer at `:1647`. Section 7 prints the multi-branch ones by name with a `/plot-reslice` hint. **Do not build a counter** — this is the third plan this week to propose something the estate already had, and that is what `a-plan-greps-for-its-own-deliverable` exists to stop.

## Done when

- neither spec asserts a slice count as a standing fact
- both name the command a reader runs to get today's answer
- the arguments those counts supported survive the change
- nothing in either spec contradicts the other
- `pnpm test` passes

## Do not

- **Do not add a script.** `uncut_slices=` and `prose_slice_names=` already exist; cite them.
- **Do not rewrite either spec beyond the counts.** The unit is the claim, not the file.
- **Do not change `## Slices` sections in any plan.** No plan file changes in this slice.
- **Do not run `pnpm run test:e2e`.** It dispatches real workers into sandbox repos; CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** The domain has its own CI step; run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p tsconfig.json` if you touch it (this slice should not).
