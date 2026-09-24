# A plan-less row is not a nameless plan

> NOT STARTED promises *"approved — nobody has taken it"*. A branch no plan names has no phase to be approved, and it lands there anyway — folded with every other plan-less row into one group keyed on the empty string, rendered as a nameless `PLAN` head and counted as a plan in the section's tally.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Issue:** #973
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Started:** 2026-09-24, Jan Wloka, `bug/a-row-with-no-plan-is-not-a-plan`

## Changelog

- A branch no plan names is no longer rendered as a nameless plan or counted as one. Measured on Plot 2.20.0: two pushed branches with no plan and no PR produced `NOT STARTED (1 plan · 2 slices)` under a `PLAN (2)` head with no name, in a section whose hint promises approved work.

Board impact: **yes, entirely.** The section rule, the grouping key and the tally are all board readings.

## Motivation

**The section's hint is a promise the rows break.** `sections.ts:43`:

```ts
{ key: 'not-started', icon: '📋', label: 'Not started', hint: 'approved — nobody has taken it' },
```

A row with `phase: null` is not approved. Placing it here tells a reader that work is claimable when nothing has judged it.

**The guard already exists, in the sibling arm.** `0de436190` (2026-08-16) — *"a group with no plan has nothing to head, and no count to hide in"* — is this plan's thesis, solved five weeks ago and never applied here. **The nameless-head site is `AgentList.tsx:1303-1366`**, and the lever is the render site and the tally, as `showPlanHeading` and `planHeads` already do — **not** the grouping key, which the draft named.

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

**Three separate wrongs, all reproduced by a juror running the real functions:**

```
groups:          [ { plan: "", n: 2 } ]        ← one group, both branches
showPlanHeading: [ false ]
tallyNotStarted: { plans: 1, slices: 2 }       ← "NOT STARTED (1 plan · 2 slices)"
tallyQuiet:      { plans: 2, slices: 2 }       ← the same rows, counted correctly
```

**The tally is confined to NOT STARTED**, and `sections.ts:421`/`:436` is why — `countsPlans = section === 'not-started'`, so every group there contributes exactly 1. The draft's *"needs no separate fix once the bucket stops being a plan"* is confirmed correct.

### Where each belongs

- **The section placement is a rule, and the draft mislocated it.** It claimed the placement is a domain property not yet extracted. A juror found it is decided in **neither** the domain nor the component: `fleet.ts` assigns `group` on the server, and the rule that would decide correctly (`rules/quiet.ts`) is reached only past the age gate. So the work is not an extraction — it is routing a reading to a rule that already exists.
- **The grouping key is the component's**, and the fix is that an empty plan is not a group key. Whether plan-less rows share one labelled group or stand alone is a rendering choice.
- **The tally follows the grouping** and needs no separate fix once the bucket stops being a plan.

### The shape of the fix

1. **A row with no plan does not enter NOT STARTED.** The section promises approved work; an unjudged branch is not that.
2. **Where plan-less rows are shown, they are labelled as such** — *no plan* — never as a plan with an empty name.
3. **The tally counts plans, and a plan-less bucket is not one.**

### Where such a row goes is NOT an open question — the estate already answers it

**The first draft offered three candidates and picked none. A juror found the answer already argued for in the code, and the moderator verified it.**

`fleet.ts:5039-5046` routes exactly this population to WAITING ON YOU as `abandoned`, and its comment names the population and the reason:

> ABANDONED, AND THE RULE DECIDES WHICH. Reaching here with `state === 'wip'` means real commits, no local activity, and … NO OPEN PR. That is `quietKind`'s `abandoned` exactly … **WAITING ON YOU, because it is the one kind that genuinely needs a person: revive it, or drop it.**

It routes **through the domain** — `quietNote` / `quietNeedsPerson` (`fleet.ts:5064`, `:5080` → `rules/quiet.ts:144`, `:203`).

**The measured rows never reach it because of one line above**, `fleet.ts:5033`:

```ts
if (ageMinutes !== null && ageMinutes <= quietMinutes) {
```

A branch whose tip is recent is returned to `not-started` before the rule written for it is ever consulted. **So this is a one-line reach, not a design decision.**

**A second reader agrees independently.** `plot-reconcile-scan.sh:2243` — section 19, *"Unclaimed work (a branch with changes no plan names — a person decides)"* — collects the same population and names the actions: *open a PR for it, write the plan that claims it, or delete the ref.*

Two readers, one answer, neither in the first draft.

### What this does NOT do

- **It does not hide the rows.** A pushed branch nobody planned is worth seeing; the defect is where and how, not whether.
- **It does not reshape WAITING ON YOU.** #967 proposes splitting that section three ways; this plan routes a population into it as the code already argues. If the split lands, `abandoned` is one of its *my problems* rows and nothing here conflicts.
- **It does not fix #972.** Some rows are plan-less only because the fleet cannot see a plan on its own branch. **Fixing that shrinks this population and leaves this defect intact** — genuinely plan-less branches exist and are the subject here.
- **It does not change `groupByPlan`'s behaviour for real plans.** Keying on `row.plan` is right where there is one.

### Open Questions

- [ ] **Does the age gate at `fleet.ts:5033` need narrowing, or bypassing for plan-less rows?** The destination is settled; how a recent-tipped branch reaches it is the implementation question, and it is the slice's first decision.

### Done when

- A row with no plan and no phase is not in NOT STARTED.
- **No group head renders with an empty name**, and a test pins it — `agent-list.test.ts:393-407` is the existing test the change touches.
- The section tally counts plans, not buckets: two plan-less branches never read as *1 plan*.
- **A real plan's grouping is unchanged** — the regression this must not cause.

## Slices

### A row with no plan is not a plan (Branch: bug/a-row-with-no-plan-is-not-a-plan)

- `bug/a-row-with-no-plan-is-not-a-plan` — decide the destination for plan-less rows and record the argument in the plan; keep them out of NOT STARTED; stop `groupByPlan` producing a nameless group and stop the tally counting it; browser test on a fixture carrying two plan-less branches

## Notes

- Reported alongside #972 from the same estate, and the issue is careful to separate them: *"the section's handling of genuinely plan-less branches is wrong on its own."* That separation is right and is why these are two plans.
- **Panelled 2026-09-24: `unanimous amend`.** The design juror answered the open question from three converging readings already on the estate, and corrected the layering claim. The draft's three candidates were not three: the estate had argued for one.
- **The nameless head was visible when the operator screenshotted it and is NOT on the board now** — checked live: 2 plan-less rows, both in DONE. The population in NOT STARTED is empty today, so the slice must build its own fixture rather than rely on the estate showing it.
