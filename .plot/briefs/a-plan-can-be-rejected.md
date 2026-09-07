## Implementation brief — a-plan-can-be-rejected (slice: The states nothing can write)

- **Plan (canonical):** `docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-plan-can-be-rejected` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slices 1, 2 and 4 merged as **#711**, **#721** and **#739**.

## What this delivers

`reject()` and `supersede()` in `packages/domain/src/transitions/plan.ts`.

**BOTH STATES ALREADY EXIST AND NEITHER IS REACHABLE.** `Phase` declares them, `plot-plan-meta.sh:338` accepts them, `plot-reconcile-scan.sh:662` acts on them, and the board drops such plans from its cards. **Only the transition is missing** — `transitions/plan.ts` names `reject`/`supersede` twice today, and that is in prose.

**AND PEOPLE WRITE THEM BY HAND.** The plan measured four plan files carrying these states, written with a text editor. **Re-measured 2026-09-07: six.** The number is growing while the transition does not exist.

**Every other state has a transition that records who did it and when; these two have a text editor.**

## Follow the transitions that exist

`approve`, `deliver` and `release` are the worked examples in the same file — each takes an input, tests preconditions, and returns a `Decision` naming the phase and the record to write, or a `Refusal` naming the reason. **Do not invent a fourth shape.**

**WHAT THE RECORD CARRIES IS THE DELIVERABLE.** `Approved:` carries a date, a person and a channel. A rejection needs the same, plus **why** — a plan rejected without a reason is a file nobody can act on. A supersession needs **which plan replaces it**, which is the fact `moved:` already carries at branch level.

## The preconditions are the argument

**Which states may be rejected or superseded is a judgement to state in the code.** A Draft plan and a Delivered one are not equally rejectable — work that shipped cannot be un-shipped by an edit to its phase. Say what each verb accepts and refuse the rest by name, as the other three do.

## Done when

- `reject()` and `supersede()` exist in `transitions/plan.ts` with the same shape as `approve`/`deliver`/`release`
- a rejection records who, when and **why**; a supersession records which plan replaces it
- the phases each verb accepts are stated, and every other phase is refused by name
- the six plan files carrying these states by hand still parse unchanged
- `pnpm test`, `pnpm run test:reconcile` and the domain typecheck pass

## Do not

- **Do not change the wire format or the `Phase:` field.** #711 kept both untouched and 196 plan files parse unchanged.
- **Do not rewrite the six hand-written files.** They are the evidence; correcting them is a separate decision.
- **Do not make either verb reachable from a script in this slice.** The transition is the deliverable; a `/plot-reject` command is not.
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc`.
