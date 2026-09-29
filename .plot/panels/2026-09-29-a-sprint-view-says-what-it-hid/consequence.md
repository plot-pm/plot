Position: amend
Evidence: executed
consequence: amend

# Consequence — a sprint view says what it hid

The plan is right that the defect is legibility and right to refuse to hide rows. It is wrong about **which rows are exempt**, and that error is load-bearing: the boundary it draws ("plan-less rows always pass, count them") describes a predicate the code does not have. A slice built to that description would ship a count that is wrong on this estate, beside an existing count that is already wrong for a different reason the plan never noticed.

Four findings, in descending order of consequence.

## 1. The exemption is not "no plan". It is "no plan AND a clean PR right now."

The plan's Motivation quotes the predicate exactly — `AgentList.tsx:528-536` is verbatim and correctly cited, which is more than several plans this week managed — and then paraphrases it as *"EXEMPT: rows with no plan"*, adopting the code's own comment as the rule. **That comment is wrong, and the plan inherits the error.**

`RowKindSchema` (`packages/board/src/contract/schema.ts:1415-1417`) has EIGHT kinds:

```
'ticket', 'plan', 'pr', 'build', 'agent', 'branch', 'release', 'wave',
```

The predicate exempts two: `release`, and `pr` where `plan === ''`. Every other kind with an empty plan reaches `slugPassesSprintFilter('')`, which I executed:

```
planless '' vs ['1-8-leg'] -> false
member 'alpha'            -> true
nonmember 'gamma'         -> false
planless with NO_SPRINT   -> true
```

So `branch`, `plan`, `ticket`, `build` and `agent` rows with no plan are **hidden today**. The plan asserts the opposite in its "What this does NOT do": *"It does not hide a plan-less PR."*

**The counter-example the plan leans on is the one that breaks.** `rowKind` (`fleet.ts:5879-5958`) is ordered, and I simulated it against the reporter's own four branches plus the near-misses:

```
pr       EXEMPT  infra/husky-hooks-crlf-and-exec-bit
pr       EXEMPT  docs/EWZLEG-867-triage-handover
pr       EXEMPT  infra/EWZLEG-880-upgrade-dependencies
pr       EXEMPT  sprint/1-8-leg
branch   FILTERED sprint/1-8-leg (WITH CONFLICT)
plan     FILTERED idea/some-new-plan
branch   FILTERED infra/no-pr-yet
```

`fleet.ts:5917` — `if (conflicts) return 'branch';` — sits ABOVE the `pr` arm. So **`sprint/1-8-leg`, the plan's load-bearing example of work an operator must never lose, disappears from a sprint-filtered board the moment it conflicts**, which is exactly the moment it most needs a human. Same for `idea/*` (`fleet.ts:5903`, `carriesDraftPlan` → `'plan'`): a draft plan PR awaiting approval, in a sprint-filtered view, is hidden.

The plan's own argument condemns the current predicate more strongly than the plan realises. It says hiding a plan-less PR *"would make «Sprint only» a view that omits work an operator must act on"*. That view already exists — for conflicted PRs and draft plans — and the plan's "What this does NOT do" section forbids the slice from touching it.

**Amendment required:** the plan must either (a) state the exemption as it actually is — *a clean-PR row or a release row* — and count that, or (b) widen the exemption to the rule it claims. It cannot describe (b) and build (a). As written, a slice implementing the plan faithfully would count "rows with no plan", find the code disagrees, and either fix the predicate (crossing the plan's stated boundary, "it does not change `slugPassesSprintFilter`") or ship a count whose label lies.

## 2. The count the plan proposes sits beside a count that is already wrong — and the plan never looked at it.

Sharp question 4 is well aimed. The plan assumes a global «6 hidden» that needs a sibling. It is neither global nor purely the sprint filter's.

`AgentList.tsx:966-969`:

```tsx
const unfilteredRows = key === 'waiting-on-machine'
  ? unfilteredSectionedRows.filter(inMachineSection)
  : unfilteredSectionedRows.filter((r) => r.group === key);
const hiddenCount = unfilteredRows.length - rows.length;
```

It is **per section** (`:1119-1121` renders `— ${hiddenCount} hidden by Sprint only` inside each section header). The reporter's «6 hidden» was one section's number, not the board's. A global sibling «4 shown without a plan» placed beside a per-section «6 hidden» would be two numbers over two different populations reading as a pair.

Worse: `rows` descends from `visibleRows`, which is `rowsForReader(filteredRows, reader, mineOnly)` (`:556`), while `unfilteredSectionedRows` is `rowsBySection(fleet.rows)` (`:933-935`). **So `hiddenCount` includes rows hidden by the ownership filter, under a label that says «Sprint only».** Executed:

```
fleet.rows = 3  visible = 1
printed suffix: "2 hidden by Sprint only"
actually hidden by sprint: 1   by mineOnly: 1
```

This directly contradicts the comment two hundred lines above it (`:546-551`), which claims the composition was kept clean:

> COMPOSED RATHER THAN MERGED. The sprint filter reports what it withheld per section, counted against `fleet.rows`; folding ownership into that count would make one number the answer to two different questions, and a reader told `3 hidden` could not tell which filter hid them. So this narrows the rows and contributes nothing to that accounting.

It contributes to that accounting. The comment states the rule and the code below breaks it — the estate's own recurring shape, *a rule with no gate*. The plan's Done-when #4 says *«6 hidden» and «4 shown without a plan» are different facts and a reader must not have to derive one from the other*. That standard, applied honestly, condemns the number the plan is building a sibling for.

**Amendment required:** the plan must either fix the label's denominator or record that it knowingly hangs a new honest count beside a mislabelled one.

## 3. Question 5's answer, and it is the opposite of what the question supposes.

`mineOnly` does **not** have the same defect. It already explains itself, globally, on its own control (`:830`, `:855-857`):

```tsx
const hidden = mineOnly ? filteredRows.length - visibleRows.length : 0;
…
<span data-mine-hidden={hidden} …>
  {hidden === 1 ? '1 row hidden' : `${hidden} rows hidden`}
```

with a deliberate comment that `0 hidden` is printed rather than suppressed. So the board today has ONE filter that states its effect on its control and ONE that states it per-section under a wrong label — and a row hidden by ownership is **counted twice**, once honestly on the checkbox and once again inside every section's "hidden by Sprint only".

This is a consequence for the plan's shape, not just its arithmetic: the precedent for "a filter says what it did" is already set, and it is **on the control**, not in the section header. The plan proposes the sibling in the header without noticing there is an established place for it.

## 4. The `release` exemption is one row here, and the plan's third Done-when is cheap to satisfy — but the exempt population is much larger than the plan counted.

Question 3, measured. `GET /api/fleet` on the live board (read-only, port 7777, `complete: true`, `ready: true`, 18 rows):

```
kinds {"wave":16,"pr":1,"release":1}
planless pr rows: 1
release rows: [ 'changeset-release/main plan="" ' ]
```

One release row, one plan-less PR row. `RELEASE_BRANCH = /^changeset-release\//` (`schema.ts:2349`) matches exactly one branch per repo, and Changesets reuses it. So counting it adds "1" to a sprint view — negligible noise, and the plan's "count it the same way" is the right call. **No amendment needed here**; this is the plan's soundest paragraph.

But the plan's census of what a sprint filter passes untested is incomplete. Three further populations never reach the predicate at all:

- `brokenRows` — `brokenAgentRows(fleet.agents, …)` (`:429`), from `fleet` directly
- `draftRows` — `draftPlanRows(fleet.draftPlans, …)` (`:434`), from `fleet` directly
- `filteredIssues` — `const filteredIssues = fleet.issues;` (`:561`), with a comment saying issues have no sprint field so they always pass

All three are added to WAITING ON YOU's `countOf` (`:983-987`). So the section the reporter was reading inflates its tally with three unfiltered populations beyond the two the plan names. A count of «rows shown without a plan» that omits them answers the reporter's complaint for PRs and leaves the same complaint standing for issues and draft plans in the same section.

## 5. On the reporter-override question (sharp question 1)

**The plan's refusal to hide is justified, and it is not an author overriding a user.** The reporter wrote *"hidden (**or at least** marked «not in sprint» and counted)"* — the parenthetical is the reporter's own fallback, and the plan takes it. That is reading the report, not overriding it.

Where the plan *does* substitute its preference is narrower and real: the reporter offered "marked AND counted"; the plan lists marking as option 2, counting as option 1, both as option 3 — and then describes only counting in its Slices section (*"Count the exempt rows in the same pass that filters, and render the count beside the hidden one"*). Sharp question 2 is right: **a count is not a mark.** With four exempt rows among dozens, «4 shown without a plan» tells an operator a number and leaves them scanning every row to find which four. The reporter asked to be able to tell an exempt row from a bug *while looking at the row*.

The plan sets up three options, refuses to choose ("the slice picks one with an argument"), and then pre-empts its own slice by describing option 1 in the only Slices entry. That is the weakest of the three, and it is the one the branch will build.

**Amendment required:** either the Slices entry names the mark (option 2 or 3), or the plan argues explicitly why a count alone discharges *"marked «not in sprint»"* — which on the evidence it cannot, since the reporter's stated difficulty was per-row identification.

## What would make this proceed

1. State the exemption as measured — `release`, or `pr` with an empty plan — and say that a conflicted plan-less PR and an `idea/*` draft-plan PR are hidden today. Either fix that or record it as out of scope with the consequence named.
2. Say where the new count goes and against what population, given `hiddenCount` is per-section.
3. Note that "hidden by Sprint only" currently includes ownership-hidden rows, contradicting `:546-551`. Fix or record.
4. Make the Slices entry build the mark, not only the count — or argue the count discharges the report.
5. Add `brokenRows`, `draftRows` and `issues` to the census of what a sprint filter does not test.

## Against my own position

**The strongest case for `proceed`:** every one of my findings is a widening, not a refutation. The plan's core judgement — *the defect is legibility, not membership; do not hide* — survives all four findings intact, and findings 1 and 2 arguably strengthen it. A slice that ships «N shown without a plan» leaves the board strictly more honest than it is today, and none of my findings makes that increment wrong; they make it incomplete. "Amend" on a plan whose thesis holds is a high bar to clear, and reasonable panels reject that bar.

**The strongest case for `reject`:** finding 1 is not a detail. The plan's central counter-example is false under the condition that matters most, and a plan whose load-bearing evidence inverts under a one-line code path is a plan that was written from a comment rather than from the code. On this estate that is a rejectable defect, and seventeen verdicts with zero `proceed` suggests the panel's calibration agrees.

**Why I land on amend anyway:** the plan's citation is exact, its estate reasoning (`plot-reconcile-scan.sh`'s plan-less-merged-PR precedent) is a real and apt measurement, and its refusal to hide is correct on both the code and the report. Every defect I found is fixable by editing the Motivation, the boundary statement, and the one Slices line — no re-argument of the thesis. That is amendment, not rejection.

**Where I am least confident:** I did not run the board's browser tests or reproduce the reporter's «6 hidden» on their Bitbucket estate, whose row population differs from this one. My `rowKind` result is a faithful re-implementation of `fleet.ts:5898-5958` executed against the reporter's branch names, not the live function — the ordering is plain in the source, but a caller passing `conflicts` differently would change the conflicted-PR conclusion. Finding 1's severity rests on that arm firing in practice, which I read but did not execute end to end.
