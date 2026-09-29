# A sprint view says what it hid

> «Sprint only» exempts every PR row that names no plan, deliberately — and the exemption is invisible. An operator reading a sprint view sees four unrelated PRs, a «6 hidden» count that does not include them, and no way to tell the exemption from a bug.

## Status

- **State:** Approved
- **Approved:** 2026-09-29, jwloka, in-session
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #1058
- **Sprint:** plot-observes-and-recovers-its-own-fleet
- **Rounds:** 1
- **Started:** 2026-09-29, jwloka, `bug/a-sprint-view-says-what-it-hid`

## Changelog

- A sprint-filtered board says how many rows it exempted for having no plan, so an unrelated PR is not mistaken for sprint work.

Board impact: this is a board view. No payload change.

## Motivation

`AgentList.tsx:528-536`:

```tsx
: fleet.rows.filter((r) => {
    // EXEMPT: rows with no plan
    if (r.kind === 'release') return true;
    if (r.kind === 'pr' && r.plan === '') return true;
    // FILTER: rows with a plan, by membership
    return slugPassesSprintFilter(r.plan, selectedSprints, membership);
  });
```

**The code's own comment says «rows with no plan» and that is WRONG.** The exemption is `release`, or `pr` **with an empty plan** — and `rowKind` (`fleet.ts:5879-5958`) is ordered, so a row's kind is not the kind you would guess:

- **`fleet.ts:5917` — `if (conflicts) return 'branch';` sits ABOVE the `pr` arm.** A plan-less PR **that conflicts** becomes a `branch` row, reaches `slugPassesSprintFilter('')`, and is **hidden** — at the exact moment it most needs a human.
- **`fleet.ts:5903` — `carriesDraftPlan` → `'plan'`.** An `idea/*` PR awaiting approval is hidden from a sprint-filtered view.

Measured: `slugPassesSprintFilter('')` against a selected sprint returns **false**, so every plan-less row of kind `branch`, `plan`, `ticket`, `build` or `agent` is already hidden.

**So the view this plan says must not exist already does**, and an earlier draft's *"It does not hide a plan-less PR"* was false. With sprint `1-8-leg` selected, four rows pass that no sprint member names:

```
#1056  infra/husky-hooks-crlf-and-exec-bit
#1091  docs/EWZLEG-867-triage-handover      (plan already delivered)
#1103  infra/EWZLEG-880-upgrade-dependencies
#1104  sprint/1-8-leg                        (the sprint PR itself)
```

The header says «6 hidden by Sprint only», and those four are **not** among the six. So the count describes the filtered population and the exempt one is silent — an operator cannot tell *"this PR is exempt"* from *"this filter is broken"*.

### Why the exemption should stay

A PR with no plan is not noise by default. `#1104` is the **sprint's own PR**. `#1103` may be the dependency bump the sprint needs. Hiding them would make «Sprint only» a view that omits work an operator must act on — and this estate has the measurement for that shape: `plot-reconcile-scan.sh` reports a plan-less merged PR and explicitly does **not** count it as drift, because *"of the 18 measured, eight belonged to a sprint whose note said 'Nothing here has a plan yet'"*.

**And that argument condemns the current predicate harder than an earlier draft realised.** `sprint/1-8-leg` — the example this plan leans on — vanishes from the view the moment it conflicts. The slice must say whether it fixes that or records it out of scope with the consequence named. It may not both forbid the view and leave it standing.

**So the defect is legibility, not membership.**

## Design

### The rule

**A filter that exempts a row says so, and counts it.**

**The mark is required; the count is the cheap half.** The reporter wrote *"hidden (or at least marked «not in sprint» and counted)"* — and an earlier draft listed three options, refused to choose, then described only the count in its Slices entry, which is the weakest of the three and the one a branch would have built.

**A count is not a mark.** With four exempt rows among dozens, «4 shown without a plan» gives an operator a number and leaves them scanning every row to find which four. The reporter's stated difficulty was per-row identification.

**None of this hides a row.** That is the boundary this plan sets and the slice may not cross it.

### The count it would sit beside is already mislabelled

**`hiddenCount` is per SECTION, not global** (`AgentList.tsx:966-969`, rendered at `:1119-1121`). The reporter's «6 hidden» was one section's number. A global sibling beside a per-section count would be two numbers over two populations reading as a pair.

**And it counts rows the sprint filter did not hide.** `rows` descends from `visibleRows` = `rowsForReader(filteredRows, reader, mineOnly)` (`:556`); `unfilteredSectionedRows` is `rowsBySection(fleet.rows)` (`:933`). The difference therefore includes **ownership-hidden** rows, under a label that says *«hidden by Sprint only»*. Executed: 3 rows, 1 visible, suffix *"2 hidden by Sprint only"* — one hidden by sprint, one by `mineOnly`.

`AgentList.tsx:546-551` states the opposite as a rule:

> COMPOSED RATHER THAN MERGED … folding ownership into that count would make one number the answer to two different questions … So this narrows the rows and contributes nothing to that accounting.

**It contributes.** The comment is the rule and the code below breaks it — a rule with no gate. **The slice fixes the denominator or records that it hangs an honest count beside a wrong one.**

### The established place is the CONTROL, not the header

`mineOnly` does not have this defect: it reports on its own control (`:830`, `:855-857`), globally, printing `0 hidden` rather than suppressing it. So the precedent for *a filter says what it did* exists, and it is on the control.

**A row hidden by ownership is currently counted twice** — once honestly on the checkbox, once again inside every section's «hidden by Sprint only».

### What the count must not become

**`slugPassesSprintFilter` already answers membership** and the exempt rows never reach it. The count is a second tally over the same pass, not a second opinion on the predicate — a row is exempt because of its kind and its empty plan, which is a fact, not a judgement.

### Three populations never reach the filter at all

`brokenRows` (`:429`), `draftRows` (`:434`) and `filteredIssues` (`:561`, `const filteredIssues = fleet.issues;` — issues carry no sprint field) come from `fleet` directly and are added to WAITING ON YOU's `countOf` (`:983-987`).

**So the section the reporter read inflates its tally with three unfiltered populations beyond the two named here.** A count that omits them answers the complaint for PRs and leaves it standing for issues and draft plans in the same section.

### What this does NOT do

- **It does not hide a plan-less PR.** The sprint's own PR is the counter-example.
- **It does not change `slugPassesSprintFilter`.**
- **It does not touch the `release` exemption** on the same predicate, which has the same shape and the same answer.
- **It does not add a payload field** — `r.plan === ''` is already on the wire.

## Done when

- **An exempt row is MARKED**, asserted with a fixture carrying both a member plan row and an exempt one — the reporter asked to tell them apart while looking at the row.
- **A sprint-filtered view states how many rows it exempted**, and says against which population, given `hiddenCount` is per section.
- **The exemption is stated as measured** — `release`, or `pr` with an empty plan — and the plan records that a **conflicted** plan-less PR (`fleet.ts:5917`) and an `idea/*` draft-plan PR (`:5903`) are hidden today, with whether the slice fixes that.
- **`brokenRows`, `draftRows` and `issues` are named**, since they reach WAITING ON YOU's count without passing the filter at all.
- **No row is hidden that is shown today**, asserted — the regression this plan must not cause.
- The `release` exemption is counted the same way or the plan records why it differs.
- **The wording distinguishes exempt from hidden.** «6 hidden» and «4 shown without a plan» are different facts and a reader must not have to derive one from the other.

## Slices

### A sprint view says what it hid (Branch: bug/a-sprint-view-says-what-it-hid, PR: #1071)

**Mark the exempt row**, and count the exempt rows in the same pass that filters. A count alone does not discharge the report.

## Notes

**Reported from a Bitbucket estate running Plot 2.21.0 with `Main branch: develop`.** The filter works correctly for plan rows — the reporter confirmed the «6 hidden» count — so this is a gap in what the view says about itself, not in what it computes.


### Round 1, 2026-09-29

One juror, **amend**, **executed**. Moderation: `.plot/panels/2026-09-29-a-sprint-view-says-what-it-hid/panel.md`.

The refusal to hide rows was upheld, and the juror confirmed it reads the report rather than overriding it — the reporter's own parenthetical offered *"or at least marked and counted"*.

**Four corrections, and two are defects in shipped code:**

1. **The exemption is not «no plan».** `rowKind` is ordered: a conflicted plan-less PR becomes a `branch` row and **is hidden**, as does an `idea/*` draft-plan PR. The view this plan says must not exist already does — and `sprint/1-8-leg`, its own load-bearing example, vanishes the moment it conflicts.
2. **`hiddenCount` counts ownership-hidden rows under a «Sprint only» label**, contradicting the rule stated at `:546-551`. A rule with no gate.
3. **The count belongs on the control**, where `mineOnly` already reports, not in the section header.
4. **The Slices entry built the weakest of three options.** A count is not a mark; the mark is now required.

Also folded: three populations (`brokenRows`, `draftRows`, `issues`) never reach the filter and inflate the same section's tally.