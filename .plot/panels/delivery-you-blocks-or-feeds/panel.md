# Panel: delivery-you-blocks-or-feeds

Reconciliation: unanimous `amend` (estate, contradiction, deliverable, cost). Gate: 4 of 4 committed on the first run, no send-back.

siblings: 7 read, 0 unread (no sprint is active; the unfinished plans in `docs/plans/active/`)

## What each juror looked at

All four read the plan, both design specs, `delivery-placement.ts`, `delivery-row-form.ts`, `delivery-view.ts`, `AgentList.tsx` and the seven sibling plans. None ran code or the board. Every position is a reading position.

## Findings held by three or more jurors

1. **The PR rule's first condition has no source.** `humanCommentOpen` exists, but only `workflows/merge.ts` and `fleet/src/shared/auto-merge.ts` call it. `PrReading` holds `ci` and `review` only. The design's non-goal forbids new host reads (spec:221). All four.
2. **The two slices collide.** Both wait only on `feature/delivery-section-header` and both edit `delivery-placement.ts`, `delivery-row-form.ts`, `delivery-view.ts` and `AgentList.tsx`. Slice 2's Unblock rows depend on slice 1's groups. Contradiction, deliverable, cost.
3. **Release and Delete on a loose branch already ship** (`AgentList.tsx:1165-1172`). Changelog line 4 and Done When line 4 describe current behaviour. The new part is the closed PR. Estate, deliverable, cost.
4. **"You ignores Mine" belongs to no slice and no Done When line** (`delivery-placement.ts:337`). Estate, contradiction, deliverable, cost.
5. **"Rebuild the board artifact with each slice" conflicts with `check-no-bundle-diff.sh`.** Contradiction, cost.

## Findings held by one or two jurors

- **Closed PR under Unblock with Delete contradicts `loose-delete`.** The controller refuses `named` for a branch a plan's slice names, and `a-deferred-slice-keeps-its-branch` relies on that refusal. Contradiction only. This is the juror's most serious gap and the others did not look at it.
- **Tickets show nowhere between this plan and plan 6.** Cost only. It widens the Open Question, which asks where the count links.
- **Folding Review a result into Blocks delivery carries `release-approval` with it, and the release shows twice.** `blocked-marker` and `merge-conflict` are unnamed. Contradiction, estate (the 12 `YouReason` values need a mapping).
- **The Auto-review arm drops today's `ci === 'passed'` guard when read literally.** Estate, cost.
- **No source for the open-question chip, and the phase strip is unbuilt.** Estate, deliverable.
- **`holdersOf`, `REASON_DO` and `ROW_COLUMNS` are group- or section-keyed and change with the fold.** Estate.
- **Dead story link; no Unblock count in the header.** Contradiction.

## What the lenses had in common

Each took the 2026-11-16 design as canonical and checked the plan against the design and the code. None asked whether the design's own rules (the PR rule wording, the Mine rule) are right. Four jurors agreeing on `amend` says the plan under-specifies; it says nothing about whether the design is correct.

## Disagreements

None on position. The jurors rank the most serious gap differently: the comment reading (estate), the closed-PR Delete refusal (contradiction), the slice collision (deliverable), the tickets gap (cost). These are four separate defects, not one defect named four ways.

Nothing is approved, rejected or changed in phase.
