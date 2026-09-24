# Work given up is not work never done

> A plan whose every slice is deferred counts zero merged branches, so `allSlicesMerged` reports it as a plan nobody built. The `deliver` controller refuses it while `plot-deliver.sh` delivers it — two readers, one plan, opposite answers.

## Status

- **State:** Released
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-23, in-session review after panel (amend 2/2); the auto-deliver gate the panel required is built in the same slice
- **Delivered:** 2026-09-23
- **Released:** 2026-09-23, 2.20.0

## Changelog

- A plan whose slices were all deferred becomes deliverable through the controller, as it already is through the script. Measured 2026-09-22: the `deliver` endpoint refused `a-test-must-not-stop-the-fleet` with *"has a branch that is not merged"* while `plot-deliver.sh --dry-run` reported *"0 branch(es) merged, 1 deferred"* and would have delivered. Ten plans on this estate have only deferred slices and four of them reached `Released`, every one delivered by the script.

Board impact: yes. `allSlicesMerged` also gates the board's Deliver control and `auto-deliver`, so such a plan is offered no button and is never auto-delivered.

## Design

### What was measured, 2026-09-22

```
POST /api/deliver a-test-must-not-stop-the-fleet
  → not-deliverable: "has a branch that is not merged — a plan is deliverable
    only once every non-deferred branch has landed"

plot-deliver.sh a-test-must-not-stop-the-fleet --dry-run
  → "verified 0 branch(es) merged, 1 deferred"
  → "would flip Phase → Delivered"
```

The plan's single slice carries `<!-- deferred: built directly on main 2026-09-22 (6d47cfa7a) … Nothing left to dispatch -->`, and `plot-plan-meta.sh` parses it as `deferred: true`. **Both readers see the same annotation and disagree about what it means.**

### Where the disagreement is

`packages/domain/src/rules/deliverable.ts`, the last line of `allSlicesMerged`:

```ts
// Every slice complete over no branches at all is a plan nobody built.
return merged > 0 ? 'merged' : 'not-merged';
```

`merged` counts only non-deferred branches — correctly, that is the rule two lines above. So a plan whose branches are **all** deferred reaches the end with `merged === 0` and takes the `not-merged` arm, which the board renders as *a branch is not merged*.

**The rule already draws this exact distinction, one level down.** Its own comment, eight lines earlier:

> Deferred branches are still exempt. A slice holding only deferred branches names work somebody gave up, which is a decision; a slice holding none names no work at all, which is a malformed plan.

That reasoning is applied to a **slice** and not to a **plan**. A plan of one all-deferred slice is *work somebody gave up*; a plan whose slices name no branches is *a malformed plan*. The final line cannot tell them apart because `merged === 0` is true of both.

### Why the guard exists, and must survive

`merged > 0` is not accidental. Its comment names the case it catches: a plan whose slices are all `complete` over no branches at all — a prose heading that parses as a finished wave. `sliceVerdict` answers `empty` for such a slice, and the line above already refuses `slice.branches.length === 0`. The counter is the second net.

**So the fix must keep refusing a plan that names no work, while admitting one whose work was given up.** Those are different readings and the rule has both facts already: a deferred branch is counted nowhere, but it is not absent.

### The shape of the fix

Count what was given up, distinctly from what was merged:

```ts
let merged = 0;
let deferred = 0;
for (const slice of plan.slices) {
  const branches = slice.branches.filter((b) => b.state !== 'deferred');
  if (slice.branches.length === 0) return 'not-merged';
  deferred += slice.branches.length - branches.length;
  if (branches.length === 0) continue;
  if (slice.verdict !== 'complete') return 'not-merged';
  merged += branches.length;
}
return merged + deferred > 0 ? 'merged' : 'not-merged';
```

**A plan naming no branch at all still answers `not-merged`**, because `merged + deferred` is 0 exactly when the plan names nothing — which is the case the guard was written for and the only one it then refuses.

**Nothing else in the rule moves.** A plan with one merged slice and one unfinished slice still returns `not-merged` at the `slice.verdict` test, before the counter is read.

### Why the script is right and the rule is wrong

`plot-deliver.sh` reports *"0 merged, 1 deferred"* and delivers. Four plans on this estate reached `Released` that way, the most recent `the-supervisor-says-why-it-handed-nothing` (delivered `1d6b8073d`, 2026-09-07). **The shape is routine and the script has always handled it.**

`docs/shell-and-domain.md` allows duplication and forbids undeclared duplication — *"what makes it safe is not that one side is authoritative, it is that a test says they agree."* No test pairs these two, which is why the disagreement survived four deliveries of exactly this shape.

### What this does NOT do

- **It does not deliver anything.** Fixing the reading makes the controller answer what the script already answers; whether a given plan should be delivered stays a person's call through `/plot-deliver`.
- **It does not touch `deliver.ts`'s own refusal** at `workflows/deliver.ts:181`, which filters `!b.deferred && !b.merged` and is already correct.
- **It does not change the shell.** The shell is the side that is right.
- **It does not judge whether a deferred annotation was honest.** A plan claiming work was built on main when it was not is a different defect, and one no rule can see.

### Done when

- `allSlicesMerged` answers `merged` for a plan whose every branch is deferred, and `not-merged` for a plan that names no branch at all. Both are unit tests.
- A plan with one merged slice and one unfinished slice still answers `not-merged` — the regression this must not cause.
- `POST /api/deliver` accepts `a-test-must-not-stop-the-fleet`, which it refuses today. The board offers its Deliver control.
- **A corpus pair is declared** between `allSlicesMerged` and `plot-deliver.sh`'s merged/deferred count, under `packages/domain/corpus/`. The two readers disagreed for four deliveries with nothing to notice; `docs/shell-and-domain.md` names a declared pair as what makes duplication safe.
- The domain's 100% coverage floor holds; the board artifact is rebuilt.

## Slices

### The rule counts what was given up (Branch: bug/the-rule-counts-what-was-given-up)

- `bug/the-rule-counts-what-was-given-up` — `allSlicesMerged` counts deferred branches alongside merged ones so a plan whose work was given up is distinguishable from a plan that names none; unit tests for both arms plus the mixed-slice regression; a corpus pair against `plot-deliver.sh`'s count declared under `packages/domain/corpus/`

## Notes

- Found by asking the `deliver` controller to deliver `a-test-must-not-stop-the-fleet` and reading its refusal rather than working around it. `CLAUDE.md`'s *The Master Agent Uses The Controllers* says a refusal is the end of that action and **where a rule exists and disagrees with its script, that is a defect to report** — this plan is that report.
- Two approved plans are undeliverable through the controller until this lands: `a-test-must-not-stop-the-fleet` and `a-failed-tick-must-not-end-the-daemon`. The second owes three corrections of its own and is not merely blocked on this.
- Ten plans on this estate have only deferred slices; four are `Released`, one `Rejected`, one `Superseded`, two `Approved` and two `Draft`. The Released four are the evidence that the script's reading is the estate's actual practice.
