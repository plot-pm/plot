---
'@plot-pm/board': patch
---

A plan has a state; the development workflow has phases. `Phase` was declared
twice in `packages/domain/src` meaning different things — `transitions/plan.ts`
held a plan's states, `rules/phase.ts` holds the workflow's five columns — and a
delivered plan sits in both: its state is `delivered`, its phase is `Testing`.

`transitions/plan.ts`'s type is now `PlanState`, and the four `phase-*` refusal
reasons are `state-*` there and in the four `workflows/` files that declare the
same reasons about a plan's state. `rules/phase.ts` is untouched.

The plan file's `- **Phase:**` field and the `phase` wire key are unchanged.
Measured: 205 plan files parse byte-identically before and after, the board's
2822 tests pass, and every decided line of `plot-transition.mjs` is unchanged —
only the refusal reason word moves. No shell script branches on a reason:
`plot-approve.sh` and `plot-deliver.sh` read the sentence with `cut -f2-`.
