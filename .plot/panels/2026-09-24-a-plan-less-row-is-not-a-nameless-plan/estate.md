# Estate lens — a-plan-less-row-is-not-a-nameless-plan

Position: amend

Every claim the plan makes about the code is TRUE and I reproduced all three by running the real functions. The amendment is about two things the plan gets wrong around the edges: it cites the wrong file:line for the nameless head (the guard it says is missing already exists one arm over, and the actual gap is elsewhere), and its "measured 2026-09-24" reproduction does not hold on the live board right now.

## Verified by running

### 1. `sections.ts:43` — the hint. CONFIRMED verbatim.

`packages/board/src/app/lib/agent-rows/sections.ts:43`:

```ts
{ key: 'not-started', icon: '📋', label: 'Not started', hint: 'approved — nobody has taken it' },
```

**And the comment above it (`sections.ts:38-42`) makes a claim that is FALSE for exactly this population** — this is a finding the plan does not have and should carry:

```
// *approved* rather than only *nobody has taken it*: the section is filtered
// on the plan's phase first, so every row in it is one an agent may actually
// take.
```

The section is NOT filtered on phase for a plan-less row. `packages/board/src/server/fleet.ts:4063` declares `planPhase = ''`, and every phase gate below it tests `planPhase !== ''`:

- `fleet.ts:4347` `if (planPhase === 'delivered' || planPhase === 'released')`
- `fleet.ts:4366` `if (planPhase === 'draft')`
- `fleet.ts:4409` `if (planPhase !== '' && planPhase !== 'approved')`
- `fleet.ts:4665` same

A row with no plan carries `planPhase === ''` and falls through **every one of them** into `{ group: 'not-started' }` (`fleet.ts:4418-4420`, `:4973`, `:5034`, `:5374-5393`). The docstring at `fleet.ts:4058-4061` even says so explicitly: *"every other value, including "", falls through."* So the hint's own justification is the defect: the filter it claims to rely on does not apply to the rows the plan is about. **The plan should quote this comment — it is stronger evidence than the hint alone.**

### 2. `sections.ts:195-200` — `groupByPlan`. CONFIRMED, quoted exactly.

`packages/board/src/app/lib/agent-rows/sections.ts:195-200`:

```ts
export function groupByPlan(rows: AgentRow[]): PlanGroup[] {
  const groups = new Map<string, PlanGroup>();
  for (const row of rows) {
    const existing = groups.get(row.plan);
    if (existing) existing.rows.push(row);
    else groups.set(row.plan, { plan: row.plan, planFile: row.planFile, rows: [row] });
```

No empty guard. Consumers: `AgentList.tsx:880` (the render) and `sections.ts:424` (the tally, inside `sectionTally`). Plus `sortByWaiting(grouped)` for NOT STARTED at `AgentList.tsx:893`.

### 3. The three wrongs, verified INDEPENDENTLY

I wrote a throwaway vitest file importing the real `sections.ts` and ran it under Node 24.4.1 (`packages/board`, vitest 4.1.10). Removed afterwards; `git status packages/board/test/` is clean.

Two rows, `plan: ''`, `phase: null`, `group: 'not-started'`:

```
groups:           [ { plan: "", n: 2 } ]          ← ONE group, both branches
showPlanHeading:  [ false ]
tallyNotStarted:  { plans: 1, slices: 2, differ: true }
tallyQuiet:       { plans: 2, slices: 2, differ: false }
tallyDone:        { plans: 2, slices: 2, differ: false }
```

`{ plans: 1, slices: 2 }` renders as **`NOT STARTED (1 plan · 2 slices)`** — the plan's quoted string is exact, not quoted from a comment.

**The tally IS derived from the group count, and only in this section.** Scaling it up:

```
3 plan-less rows,  not-started: { plans: 1, slices: 3 }   groupByPlan(...).length === 1
3 real plans,      not-started: { plans: 3, slices: 3 }
1 real plan (2 rows) + 2 plan-less: { plans: 2, slices: 4 }
```

The cause is `sections.ts:421` + `:436`: `const countsPlans = section === 'not-started'`, then `planLines += countsPlans || … ? 1 : groupSlices`. In NOT STARTED every group contributes exactly 1 to `plans`, so the empty bucket is counted as a plan. In QUIET/DONE `countsPlans` is false and the same rows tally 2/2. **So wrong #3 is real, is confined to NOT STARTED, and does follow from the grouping — the plan's "needs no separate fix once the bucket stops being a plan" is correct.**

## Where the plan is WRONG, and why this is amend not proceed

### The nameless-head citation is misplaced. The guard it wants already exists — in the other arm.

`showPlanHeading` (`sections.ts:381-383`) ALREADY refuses a nameless group:

```ts
export function showPlanHeading(group: PlanGroup): boolean {
  return Boolean(group.plan) && group.rows.length > 1;
}
```

and `planHeads` (`AgentList.tsx:1301`) ALREADY guards: `!countsPlans && Boolean(group.plan) && …`.

**This was fixed on 2026-08-16**, commit `0de436190` *"plot-board: a group with no plan has nothing to head, and no count to hide in"* — same defect, same words: *"the heading then rendered `{group.plan}` as nothing followed by `(3)` — a label that labels nothing."* It added `headings && group.plan &&` to the renderer and a pinning test.

**The surviving gap is the NOT STARTED arm specifically, and the plan never names it.** At `AgentList.tsx:1303` the code forks `if (countsPlans) {` and renders `<PlanRow group={group} …>` **unconditionally** at `AgentList.tsx:1366`, with `data-plan-group={group.plan}` at `:1357` — no `Boolean(group.plan)` anywhere in that arm. The other arm's `PlanRow` at `:1647` is gated on `planHeads`, which carries the guard. So the nameless `PLAN` head is a `PlanRow` in the countsPlans fork, not a `groupByPlan` defect and not an `h3` heading.

**Why this matters for the fix, not just the prose:** the plan's Design says *"the grouping key is the component's, and the fix is that an empty plan is not a group key."* That is the wrong lever. `groupByPlan` cannot be the fix for the head, because `showPlanHeading` proves an empty key is already handled correctly wherever the guard was applied. Splitting the key would also change `sortByWaiting`, the fold state (`openPlans.has(group.plan)` — every plan-less group would share the key `''` for folding, or need N new keys), `data-plan-group`, and `slicesElsewhere(fleet.slices, group.plan, …)`. **The 2026-08-16 precedent is the cheaper shape: guard at the render site and at the tally, leave the key alone.** The plan's own "Done when" — *"a real plan's grouping is unchanged"* — is satisfied more safely that way.

The plan must cite `AgentList.tsx:1303-1366` and commit `0de436190`, and drop or rewrite *"an empty plan is not a group key."*

### The live board shows ZERO plan-less rows in NOT STARTED. The defect is not currently visible.

`curl -s http://localhost:7777/api/fleet` (read-only), 19 rows:

```
groups: { 'waiting-on-you': 17, done: 2 }
plan-less rows: 2
```

Both plan-less rows are in **`done`**, not `not-started`:

| branch | plan | group | state | phase | pr | note |
|---|---|---|---|---|---|---|
| `feature/one-monitor-watches-the-slice` | `""` | `done` | wip | null | #741 | merged — last commit 17 days ago |
| `bug/the-index-is-read-once` | `""` | `done` | wip | null | #948 | merged — last commit 6 days ago |

`sectionTally(…, 'done', …)` on these gives `{plans: 2, slices: 2, differ: false}` — no miscount, and `countsPlans` is false so no `PlanRow` head. **So right now: no NOT STARTED section, no nameless head, no wrong tally on this board.**

This does not refute the plan — the code path is live and I reproduced every consequence by running it — but the plan's Notes claim is now stale:

> *"The nameless `PLAN` head is visible on this repository's board right now — it was the first thing the operator noticed after `/plot-board --start`."*

It is not visible right now. That sentence must be dated and past-tensed, or the slice will start by looking for something it cannot find.

### The separability claim is UNPROVEN on today's evidence, and it is the plan's load-bearing claim.

The plan says: *"It does not fix #972. Some rows are plan-less only because the fleet cannot see a plan on its own branch. Fixing that shrinks this population and leaves this defect intact — genuinely plan-less branches exist and are the subject here."*

The two plan-less rows I measured are **merged branches with merged PRs whose plans are gone or were never on main** — neither is a same-branch `Impl:` plan waiting to be seen, so on the DONE side the populations do separate. But the plan offers **no measured example of a genuinely plan-less branch in NOT STARTED**, and #972's own plan (`docs/plans/2026-09-24-the-fleet-sees-a-plan-on-its-own-branch.md`, Changelog) says its two rows appeared *"under NOT STARTED with no name"* — i.e. the only NOT-STARTED instance either plan has measured is a #972 instance. Sibling panels today already corrected the 972 plan for quoting rather than measuring (`a8cfe918b`). **The slice must measure at least one genuinely plan-less branch in NOT STARTED, or record honestly that the population is currently empty and the fix is a guard against a reachable state rather than an observed one.** The code path is real either way; the claim "genuinely plan-less branches exist" is the part with no measurement behind it.

## Prior art and tests

- `git log -S 'groupByPlan'` — 17 commits. The relevant one is `0de436190` (above). Nothing since has touched empty-plan grouping; `f733ac9d1` (#414) added `sectionTally` and introduced the `countsPlans` per-group `+= 1` that produces wrong #3.
- **An existing unit test PINS the current behaviour and the plan will break it.** `packages/board/test/unit/agent-list.test.ts:393-407`, `describe('groupByPlan with unplanned rows')`:

  > *"They share `plan: ''` by construction, so they collapse into one group whose name is empty. **That is fine** — but the RENDERER must not head it… Pinned here because the grouping is what makes such a group possible at all."*

  ```ts
  expect(groups.filter((g) => g.plan === '')).toHaveLength(1);
  ```

  This test asserts the exact opposite of *"an empty plan is not a group key."* The plan must name it — either as a test it deliberately rewrites (with the argument for reversing a pinned decision) or, better, as confirmation that the grouping is not the lever. There is also `agent-list.test.ts` *"never labels a nameless group, however many rows it holds"* covering `showPlanHeading`.
- **Browser tests: none covers a plan-less row in NOT STARTED.** `tuple-row.browser.test.ts` and `agent-panel-links.browser.test.ts` carry `plan: ''` fixtures; `agent-panel-links.browser.test.ts:222` asserts only that a panel with an empty plan renders no plan link. `row-withholds.browser.test.ts:76,433` and `unplanned-issues.browser.test.ts` cover unplanned ISSUE rows in WAITING ON YOU — a different row kind. The plan's proposed browser test on a two-plan-less-branch fixture is genuinely new coverage. Note per the estate's memory: such a fixture needs `pnpm build:board` first.

## What to amend

1. Cite `AgentList.tsx:1303-1366` as the nameless-head site, and commit `0de436190` as the precedent that already solved the identical defect in the sibling arm. Drop *"an empty plan is not a group key"* — guard at the render site and the tally, as `showPlanHeading` and `planHeads` already do.
2. Quote the `sections.ts:38-42` comment. *"The section is filtered on the plan's phase first"* is false for `planPhase === ''` (`fleet.ts:4063` and four gates) — that is the sharpest statement of wrong #1 available.
3. Date the Notes claim. The nameless head is not on the board now: 2 plan-less rows, both in DONE.
4. Name `agent-list.test.ts:393-407` as the pinned test the change touches.
5. Measure one genuinely plan-less NOT STARTED branch, or say plainly the population is empty today.

None of this changes the slice's scope or its "Done when" list, which are correct as written. The mechanism is real, the numbers are real, the citations and the lever are wrong.
