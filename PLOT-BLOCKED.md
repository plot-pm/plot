PLOT-BLOCKED: This slice waits on `bug/a-sprint-item-has-one-scorer`, which has not started — its own dependency, PR #805, is still open. Should the wait hold, or do you want the independent half (deleting the `status:` annotation) cut as its own slice now?

## The measurement

The brief says *"do not start before it lands"*. Checked 2026-09-07:

| link | state |
|---|---|
| `infra/a-shell-script-asks-the-domain` | **PR #805, OPEN** — not merged |
| `bug/a-sprint-item-has-one-scorer` | **no branch, no PR** — it waits on #805 |
| `bug/a-withdrawn-item-is-not-open` (this slice) | waits on the scorer |

The chain is two deep and neither link is closed. Verified on `origin/main`: `scoreItem` (`packages/domain/src/entities/sprint.ts:92`) still reaches no production caller — the only call is inside `openPromises`, whose own only caller is a re-export at `index.ts:358`. The live rule is still the 12 lines of bash at `plot-sprint-release.sh:73`. Nothing the scorer plan promised has landed.

## Why I did not start anyway

The wait is not sequencing hygiene; the plan argues the cost:

> **IT WAITS FOR THE SINGLE SCORER, AND THE ANNOTATION SAYS SO.** [`a-sprint-item-has-one-scorer`] found that `scoreItem` has no production caller and the live rule is 12 lines of bash — so against today's shape this is FOUR edits with nothing to catch a missed one. After that plan lands it is one function and one enum, with a corpus test that fails if the shell disagrees.

And the scorer plan states the same thing from its side — that a fourth state landing first *"entrenches the split"*. Adding the fourth status now means editing the bash rule, the Zod enum, `release.ts` and the `/plot-release` skill separately, with no test able to catch a missed one because the bash and the TypeScript cannot import each other. That is the defect the scorer plan exists to remove, paid in advance.

## What I found that the plan did not anticipate

**The annotation count is larger than measured, and spread wider.** The plan says *"35 lines across four sprints carry one"*. Measured today:

```
docs/sprints/2026-W35-the-board-serves-an-enterprise-stack.md      15
docs/sprints/2026-W35-the-board-tells-the-truth-in-every-section.md 20
docs/sprints/2026-W36-the-board-shows-the-strategic-layer.md        5
docs/sprints/2026-W36-a-half-landed-workflow-says-so.md             1
docs/sprints/2026-W36-the-domain-is-one-implementation.md          16
docs/sprints/2026-W37-the-domain-owns-the-lifecycle.md              5
docs/sprints/2026-W37-the-published-board-works.md                  3
```

**65 lines across seven sprints**, not 35 across four. The values: 63 `delivered`, 1 `closed`, 1 `draft` — and **zero `rejected`**, which confirms the plan's actual finding (the writer never writes the value the reader would need). The done-when says *"the 35 lines carrying it"*; that number is now wrong and a slice meeting it verbatim would leave 30 lines behind.

## The question, concretely

Two options, and the second is a scope decision I should not make alone:

1. **Hold the wait.** Restart this branch after `bug/a-sprint-item-has-one-scorer` merges. Nothing is lost; the fourth status becomes one function and one enum, as the plan intends.

2. **Cut the annotation deletion as its own slice now.** Removing `<!-- status: ... -->` from the `/plot-sprint` contract (`skills/plot-sprint/SKILL.md:246`) and from the 65 lines touches neither `item_state`, nor the enum, nor `release.ts` — so it does not depend on the scorer and does not entrench anything. But the plan states one done-when over both halves, and splitting a slice changes the plan.

I recommend **1**, and mention 2 only because the annotation half is genuinely unblocked and independently verifiable.

Nothing was changed in this worktree.
