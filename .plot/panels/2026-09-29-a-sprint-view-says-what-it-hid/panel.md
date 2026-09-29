# Panel — a sprint view says what it hid (#1058)

Subject: `docs/plans/2026-09-29-a-sprint-view-says-what-it-hid.md`
Round 1, 2026-09-29. One juror, both commitments gated.

| Juror | Position | Evidence |
|---|---|---|
| consequence | amend | executed |

## Upheld: the refusal to hide, and that it reads the report

The plan refuses to hide rows and proposes legibility instead. The juror checked whether that overrode the reporter and found it did not: the report says *"hidden (**or at least** marked «not in sprint» and counted)"* — the parenthetical is the reporter's own fallback, and the plan takes it.

## FINDING 1 — the exemption is not «no plan», and the plan's own example breaks

The predicate's comment says *"EXEMPT: rows with no plan"*, and the plan adopted it. **`rowKind` (`fleet.ts:5879-5958`) is ordered**, and two arms sit above the `pr` one:

- **`:5917` — `if (conflicts) return 'branch';`** A plan-less PR that conflicts becomes a `branch` row, reaches `slugPassesSprintFilter('')` → **false**, and is hidden.
- **`:5903` — `carriesDraftPlan` → `'plan'`.** An `idea/*` PR awaiting approval is hidden.

Both verified by the moderator at the cited lines.

**So `sprint/1-8-leg` — the plan's load-bearing example of work an operator must never lose — disappears from a sprint-filtered board the moment it conflicts**, which is when it most needs a human. The plan's *"It does not hide a plan-less PR"* was false, and its own argument condemns the current predicate harder than it realised.

## FINDING 2 — the count it would sit beside is already wrong

**`hiddenCount` is per section** (`:966-969`, rendered `:1119-1121`), not global. The reporter's «6 hidden» was one section's number.

**And it counts rows the sprint filter did not hide.** `rows` descends from `visibleRows` = `rowsForReader(filteredRows, reader, mineOnly)` (`:556`); `unfilteredSectionedRows` is `rowsBySection(fleet.rows)` (`:933`). The difference includes ownership-hidden rows under a label reading *«hidden by Sprint only»*. Executed: 3 rows, 1 visible, *"2 hidden by Sprint only"* — one by sprint, one by `mineOnly`.

`AgentList.tsx:546-551` states the opposite as a rule:

> COMPOSED RATHER THAN MERGED … folding ownership into that count would make one number the answer to two different questions … this narrows the rows and contributes nothing to that accounting.

**It contributes.** Verified by the moderator. A rule with no gate — the estate's recurring shape, found in its own component.

## FINDING 3 — the established place is the control

`mineOnly` already reports on its own control (`:830`, `:855-857`), globally, printing `0 hidden` rather than suppressing it. So the precedent exists and the plan proposed the sibling in the header without noticing.

**A row hidden by ownership is currently counted twice** — honestly on the checkbox, again inside every section's «Sprint only» tally.

## FINDING 4 — the Slices entry built the weakest option

The plan listed three shapes, refused to choose, then described only the count in its one Slices entry. **A count is not a mark**: with four exempt rows among dozens, a number leaves the operator scanning to find which four, and per-row identification was the reporter's stated difficulty.

The mark is now required.

## Sound, and confirmed

The `release` exemption is **one row** on this estate — `RELEASE_BRANCH = /^changeset-release\//` matches one branch per repo — so counting it adds negligible noise. The plan's *"count it the same way"* is right. The juror called this the plan's soundest paragraph.

## Census gap

`brokenRows` (`:429`), `draftRows` (`:434`) and `filteredIssues` (`:561`) come from `fleet` directly, never reach the predicate, and are added to WAITING ON YOU's `countOf` (`:983-987`). The section the reporter read inflates its tally with three populations the plan never named.

## Amendments folded in

1. The exemption stated as measured, with the conflicted-PR and draft-plan cases and the fact that `sprint/1-8-leg` is hidden when it conflicts.
2. `hiddenCount`'s per-section scope and its mislabelled denominator, with the rule it breaks.
3. The control named as the established place for a filter's report.
4. The Slices entry rewritten to build the mark.
5. The three unfiltered populations added to the census.
