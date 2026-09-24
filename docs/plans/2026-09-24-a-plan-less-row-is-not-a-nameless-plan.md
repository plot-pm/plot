# A plan-less row is not a nameless plan

> NOT STARTED promises *"approved — nobody has taken it"*. A branch no plan names has no phase to be approved, and it lands there anyway — folded with every other plan-less row into one group keyed on the empty string, rendered as a nameless `PLAN` head and counted as a plan in the section's tally.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #973

## Changelog

- A branch no plan names is no longer rendered as a nameless plan or counted as one. Measured on Plot 2.20.0: two pushed branches with no plan and no PR produced `NOT STARTED (1 plan · 2 slices)` under a `PLAN (2)` head with no name, in a section whose hint promises approved work.

Board impact: **yes, entirely.** The section rule, the grouping key and the tally are all board readings.

## Motivation

**The section's hint is a promise the rows break.** `sections.ts:43`:

```ts
{ key: 'not-started', icon: '📋', label: 'Not started', hint: 'approved — nobody has taken it' },
```

A row with `phase: null` is not approved. Placing it here tells a reader that work is claimable when nothing has judged it.

**And the count is wrong in a way that compounds.** `groupByPlan` (`sections.ts:195-200`) keys on `row.plan`:

```ts
const existing = groups.get(row.plan);
if (existing) existing.rows.push(row);
else groups.set(row.plan, { plan: row.plan, planFile: row.planFile, rows: [row] });
```

Every plan-less row shares the key `''`, so N unrelated branches become **one group**, the head renders with no name, and the tally counts that bucket as a plan. Two branches with nothing in common are presented as one plan's two slices.

## Design

### What was measured, 2026-09-24

```json
{"kind": "branch", "plan": "", "phase": null, "group": "not-started"}
```

renders as:

```
NOT STARTED (1 plan · 2 slices)
  PLAN (2)          ← no name
    BRANCH …        in progress
    BRANCH …        in progress
```

**Three separate wrongs from one missing guard**: the section placement, the nameless head, and the tally.

### Where each belongs

- **The section placement is a rule.** *Does this row belong in NOT STARTED?* is a decision about a row's state, so it is a domain property — CLAUDE.md: *"a view state that cannot be asserted without a browser is a domain property that has not been extracted yet."*
- **The grouping key is the component's**, and the fix is that an empty plan is not a group key. Whether plan-less rows share one labelled group or stand alone is a rendering choice.
- **The tally follows the grouping** and needs no separate fix once the bucket stops being a plan.

### The shape of the fix

1. **A row with no plan does not enter NOT STARTED.** The section promises approved work; an unjudged branch is not that.
2. **Where plan-less rows are shown, they are labelled as such** — *no plan* — never as a plan with an empty name.
3. **The tally counts plans, and a plan-less bucket is not one.**

### Where such a row should go instead is the open question

The issue says only what must not happen. **Three candidates, and this plan does not pick one:**

| Destination | For | Against |
|---|---|---|
| A labelled group inside NOT STARTED | keeps it visible | the hint still promises approved work |
| WAITING ON YOU | a branch nobody planned is arguably a person's problem | #967 already reports that section answers too many questions |
| Its own section | honest | a new section is a big change for a small population |

**Naming the destination is the first thing the slice settles**, and it is a judgement about what a reader should do with such a branch — not something the code decides.

### What this does NOT do

- **It does not hide the rows.** A pushed branch nobody planned is worth seeing; the defect is where and how, not whether.
- **It does not fix #972.** Some rows are plan-less only because the fleet cannot see a plan on its own branch. **Fixing that shrinks this population and leaves this defect intact** — genuinely plan-less branches exist and are the subject here.
- **It does not change `groupByPlan`'s behaviour for real plans.** Keying on `row.plan` is right where there is one.

### Open Questions

- [ ] **Where does a plan-less branch go?** The three candidates above. #967 is reshaping WAITING ON YOU, so the answer may want to wait for it — or may be part of it.

### Done when

- A row with no plan and no phase is not in NOT STARTED.
- **No group head renders with an empty name**, and a test pins it.
- The section tally counts plans, not buckets: two plan-less branches never read as *1 plan*.
- **A real plan's grouping is unchanged** — the regression this must not cause.

## Slices

### A row with no plan is not a plan (Branch: bug/a-row-with-no-plan-is-not-a-plan)

- `bug/a-row-with-no-plan-is-not-a-plan` — decide the destination for plan-less rows and record the argument in the plan; keep them out of NOT STARTED; stop `groupByPlan` producing a nameless group and stop the tally counting it; browser test on a fixture carrying two plan-less branches

## Notes

- Reported alongside #972 from the same estate, and the issue is careful to separate them: *"the section's handling of genuinely plan-less branches is wrong on its own."* That separation is right and is why these are two plans.
- **The nameless `PLAN` head is visible on this repository's board right now** — it was the first thing the operator noticed after `/plot-board --start`, which is how this ticket reached the top of the list.
