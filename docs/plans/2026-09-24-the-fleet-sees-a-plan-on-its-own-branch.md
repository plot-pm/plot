# The fleet sees a plan on its own branch

> A plan created with `Impl: same branch` lives on its work branch until that branch merges. The Board tab reads it; the Fleet tab does not. One estate, two enumerations, and the branch carrying the plan shows up as an anonymous row with `plan: ""`.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #972

## Changelog

- The fleet view reports a branch whose own tree holds a plan file as that plan's branch, rather than as a plain unplanned branch. Measured on Plot 2.20.0: two plans created by `/plot-idea` with `Impl: same branch` appeared as Draft cards on `/api/board` and as `{"plan": "", "planFile": "", "phase": null}` rows on `/api/fleet`, under NOT STARTED with no name.

Board impact: **yes.** This is a board reading. The Board tab is already correct; the Fleet tab is the half that disagrees.

## Motivation

**`Impl: same branch` is a flow Plot offers, and the fleet cannot see its output.** `skills/plot-idea/SKILL.md` step 5 puts the plan on the work branch deliberately — the ceremony is matched to the change, and a small change does not earn an `idea/` branch and a PR. The scan then enumerates plans from `origin/<main>` and finds nothing.

**The two tabs of one board disagree about whether a plan exists**, which is worse than either answer alone: a reader who checks the Board tab and then the Fleet tab sees the plan appear and vanish.

## Design

### What was measured, 2026-09-24

| Reader | Sees a same-branch plan? | Where |
|---|---|---|
| `/api/board` (Board tab) | **yes** — a Draft card | `board.ts:810-813` |
| `/api/fleet` (Fleet tab) | **no** — `plan: ""` | `plot-fleet-scan.sh:122` |

`board.ts:808-813`:

```ts
const onDefault = await planPathsInTree(refs, `origin/${defaultBranch}`, planDir);
…
for (const { branch } of branches) {
  for (const relPath of await planPathsInTree(refs, `origin/${branch}`, planDir)) {
    if (onDefault.has(relPath) || seen.has(relPath)) continue;
```

**The board already walks every branch's tree for plan files.** It even carries the dedup this needs — `onDefault.has(relPath) || seen.has(relPath)` — with the comment that branches cut from one point share a plan file and *"a card per branch would report one plan as several."*

`plot-fleet-scan.sh:122` states the other rule as a property of the scan: *"Plans are enumerated from `origin/<main>`."*

**So the capability exists, in the same package, with the hard part already solved.** This is the fifth ticket today whose fix is *one of two readers already does it right* — the same shape as #966, #968, #969 and #970.

### An `idea/` plan is recognised and that is the tell

The issue records it: a plan on an `idea/` branch with a PR appears as `kind: "plan"`. That path works because the plan file reaches `origin/<main>` when the plan PR merges, or because the PR itself is the row. **Only the same-branch flow — the one with no PR and no merge until the work lands — is invisible.**

### The shape of the fix

Give the scan the enumeration the board already has: after reading plans from `origin/<main>`, read each candidate branch's own tree for plan files the default branch does not carry, and attribute the branch to the plan it holds.

**The dedup rule is not optional and must be copied, not re-derived.** Two branches cut from one point carry the same plan file, and without `onDefault`/`seen` the scan would report one plan as several — a defect the board already measured and fixed.

### The cost, and why it must be measured before it is paid

The scan is **18.3 s** and `plot-fleet-scan.sh` already carries a `--stream` mode because *"git alone is 12.7 s of that"*. Adding a `ls-tree` per branch multiplies the git work by the branch count — 28 branches on the reporting estate, 54 here.

**So the slice measures before and after and reports both.** If the cost is unacceptable the fix narrows — to branches with no PR, which is the population the defect describes — rather than shipping a scan nobody waits for.

### What this does NOT do

- **It does not change `Impl: same branch`.** The flow is correct; the reading is what is missing.
- **It does not move plan enumeration into the board.** `plot-fleet-scan.sh` is the scan's own reading and the two stay separate — what transfers is the rule, not the call.
- **It does not re-derive the dedup.** The board's `onDefault`/`seen` pair is the measured answer.
- **It does not touch #973's rendering.** A plan-less row is a separate defect with its own plan; this one reduces how many rows are plan-less, and does not make the remainder render correctly.

### Done when

- A branch whose tree holds a plan file the default branch does not carry is reported with that plan's slug and phase in `/api/fleet`.
- **Two branches carrying one plan file report one plan, not two** — the regression the board's comment names.
- The scan's cost is measured before and after, and both numbers are in the slice's commit message.
- A branch with no plan anywhere still reports `plan: ""`, which is #973's subject and not this one's.

## Slices

### The scan reads a branch's own plans (Branch: bug/the-scan-reads-a-branch-s-own-plans)

- `bug/the-scan-reads-a-branch-s-own-plans` — enumerate plan files from each candidate branch's tree as well as `origin/<main>`, carrying the board's `onDefault`/`seen` dedup; measure the scan before and after and report both; narrow to PR-less branches if the cost demands it

## Notes

- Reported from a plugin install on GitHub with two `Impl: same branch` plans. **Reproducible here in principle** — this estate has the same scan — but not currently observed, because every plan here reaches `origin/main` through a PR.
- The issue's own parenthetical names the interaction: these branches *"do carry plans that the fleet cannot see"*, and the NOT STARTED rendering of plan-less rows is wrong independently. Fixing this one shrinks #973's population without fixing #973.
