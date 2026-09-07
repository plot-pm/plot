PLOT-BLOCKED: This slice waits on `infra/a-shell-script-asks-the-domain` (PR #805), which is OPEN and unmerged. Should I wait for it to land, or do you want this branch to carry #805's files itself?

## Why this is blocked rather than slow

The brief says: *"**Waits on:** `infra/a-shell-script-asks-the-domain` — do not start before it lands. The plan says why."* The plan says why in its slice section:

> **THE SEAM IS NOT THIS PLAN'S TO CHOOSE.** [`a-shell-script-asks-the-domain`] states when a shell script calls the domain and where the call goes; this slice waits on it and uses what it says. **An earlier draft named `plot-ask.mjs` here** — written before `node` startup was measured at 39 ms, and before two sibling plans reached a different answer for scripts that run per pass.

Every input this slice consumes exists only on PR #805's branch, and none of it is on `main`:

| input this slice needs | on `main`? | on `infra/a-shell-script-asks-the-domain`? |
|---|---|---|
| `docs/shell-and-domain.md` — the seam contract | no | yes |
| `packages/domain/corpus/production.ts` → `SprintItemRow`, `SprintRow`, `listSprintSlugs`, `readSprintRelease` | no | yes (lines 380–462) |
| `packages/domain/corpus/sprint-score.corpus.test.ts` — the comparison this slice must amend | no | yes |
| `packages/domain/corpus/compare.ts` → `Sides`, `describingAs` | partial (no `Sides`/`describingAs`) | yes |

Verified 2026-09-07:

```
$ git cat-file -e origin/main:docs/shell-and-domain.md
fatal: path 'docs/shell-and-domain.md' does not exist in 'origin/main'

$ gh pr view 805 --json state,mergeable
{"state":"OPEN","mergeable":"MERGEABLE"}
```

## The specific collision

PR #805 ships `corpus/sprint-score.corpus.test.ts` containing a test whose stated job is to fail when *this* slice lands:

> `it('names the items the domain cannot yet express, so the set can only shrink')`
> *"DECLARED, NOT SKIPPED. … it fails again — correctly — when `a-sprint-item-has-one-scorer` teaches the domain to say *no plan named* and the list should empty."*

So my change must **edit that file**. If I write my own copy of it on this branch, the merge of #805 conflicts on the one file both branches author, and the conflict is in test logic — not a `-merge` bundle that can be resolved by rebuilding. Duplicating `production.ts`'s four sprint readers has the same problem.

## What I verified while blocked (no files changed)

The defect the plan describes is real and I measured its size on the live estate:

- `plot-sprint-release.sh:73` `item_state` takes `delivered` as three-valued (`true`/`false`/`none`); the `none` arm takes the item at its checkbox.
- `packages/domain/src/entities/sprint.ts:92` `scoreItem(item, planIsDelivered: boolean)` cannot express `none`, so it scores such an item `disputed` when checked.
- **Across all 10 sprint files: 134 items, 4 with `delivered: "none"`, and all 4 are checked** — so all 4 are cases where the two implementations answer differently today. (`docs/shell-and-domain.md` on #805 says "five items"; the estate now reads four. Worth noting when that doc lands, since the corpus test asserts the set exactly.)

## What I need from you

One of:

1. **Wait for #805 to merge**, then restart this branch. Cleanest, and what the brief instructs. #805 is MERGEABLE with `corpus` passing.
2. **Rebase this branch onto `infra/a-shell-script-asks-the-domain`** instead of `main`, accepting that the PR shows both slices until #805 merges. This contradicts the brief's "base `main`" and "Ends as: one PR to `main`", so I did not choose it myself.

I have written nothing and pushed nothing. The branch is clean at its claim commit.
