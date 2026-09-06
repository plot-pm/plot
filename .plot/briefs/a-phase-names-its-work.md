## Implementation brief — a-phase-names-its-work (slice: Naming the work in a phase)

- **Plan (canonical):** `docs/plans/2026-09-04-the-workflow-owns-the-word-phase.md` on `main`
- **Story:** `the-domain-knows-what-plot-knows`
- **Branch:** `feature/a-phase-names-its-work` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 of three. Slices 2 and 3 (`feature/a-plan-can-be-rejected`, `infra/a-plan-file-says-state`) wait on it. Two earlier slices of this plan merged as **#711** and **#721**.

## What this delivers

Each phase declares which workflows belong to it, giving `WorkflowName`'s flat union its missing structure.

## The union today

`packages/domain/src/workflows/decision.ts:395` declares `WorkflowName` as a flat list, and `DevelopmentWorkflow` (landed in #721) holds the five phases — `Discovery → Design → Development → Testing → Release` — with their order and leadership. Nothing connects the two.

**Asserted: the fleet's workflows are not phases of this one.** `assign`, `reap` and `supervise` act on **agents and desks**; `approve`, `deliver` and `release` act on **a plan moving through its lifecycle**. A list that mixes them cannot answer *what comes next*, because the two sets have no common successor relation.

**So the deliverable is a partition, not an annotation.** Some workflows belong to a phase; the fleet's belong to no phase, and that must be expressible rather than a gap. A workflow with no phase is a stated answer, not a missing one.

## Done when

- each phase declares the workflows that belong to it
- the fleet's workflows are outside that structure, deliberately and visibly
- a workflow belonging to no phase is representable and asserted
- nothing the board renders changes
- `pnpm test` and the domain typecheck pass

## Do not

- **Do not add a phase for the fleet's workflows.** The assertion is that they are not phases of this workflow.
- **Do not build a second ordering machine.** The plan settles this for the phase order: the transitions enforce the sequence, and *"a disagreement between two enforcers is worse than one enforcer."* The same holds here.
- **Do not change the wire format or the plan file's fields.** #711 kept both untouched on purpose; 196 plan files parse unchanged.
- **Do not use `function` declarations** in the domain package.
- **Do not run `pnpm run test:e2e`.** CI is its gate.
- **`pnpm run typecheck` covers `@plot-pm/board` only.** Run the domain's own `tsc`.
