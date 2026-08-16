## Implementation brief — board-shows-discovery, single branch

- **Plan (canonical):** `docs/plans/2026-08-16-board-shows-discovery.md` on `main`
- **Approved:** 2026-08-16, jwloka, plan-PR #127 merged
- **Branch:** `bug/board-shows-discovery` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass
- **Concurrency:** runs beside `bug/fleet-merged-branch-state` and
  `feature/update-board-test`, both of which live in
  `skills/plot/scripts/**` and `test/reconcile/**`. **You own
  `packages/board/**` exclusively**, including the rebuilt artifact — you are
  the only one of the three who rebuilds it, which is what keeps the fan-out
  collision-free. Do not edit anything outside the board package.

### What to build

Read the plan in full. Two changes, and **both are required** — either alone
leaves the Discovery column empty, which is the whole defect.

**1. `toBoardPhase`: `draft → 'Discovery'`**, `approved` unchanged
(`started ? 'Development' : 'Design'`). Design then means exactly one thing —
*designed, not yet started* — which is what its two current cards actually are.

Remove the swimlane filter in the **same** change:

```ts
const phases = BOARD_PHASES.filter((p) => p !== 'Discovery');
```

That line is coherent today only *because* the column holds nothing. Once
Discovery holds Draft plans, a row header that silently drops them is the same
bug wearing different clothes.

**2. Source plan files from prefixed branches, not just the working tree.**
`collectPlanFiles()` walks `docs/plans/{active,delivered,}` on the filesystem —
one branch's working tree. Confirmed exhaustively: **not one plan file on
`main` is in phase Draft**, so remapping alone changes nothing visible.

The rule, which needs no new convention:

> plan files on branches under the configured idea prefix that are **not** on
> the default branch — that set *is* the Draft plans.

Verified on both idea branches: each carries **exactly one** plan file absent
from the default branch, and it is exactly the Draft one. Everything else
matches `main` because the branch was cut from it.

`Branch prefixes` is already config (`idea/, feature/, bug/, docs/, infra/`) —
read it, do not hardcode `idea/`. Nothing is inferred from the branch name
beyond *where to look*; the phase is still read from the file exactly as for
every other plan. This is also what makes it cover `Impl: same branch` plans,
whose plan rides `feature/<slug>` — same rule, wider net, and deliberate.

### Two constraints found by measurement, not reasoning

**Read the local ref mirror, never the network.**

```
git ls-remote --heads origin 'refs/heads/idea/*'    459.3 ms   ← network
git for-each-ref refs/remotes/origin/idea/*           8.0 ms   ← local
git ls-tree / git show                                7.1 ms
```

57×, and the local answer is already correct: the fleet scan fetches every run,
so `refs/remotes/origin/*` is as fresh as the pulse. Total ≈22 ms for today's
two branches against the ~1 s the board already spends. `ls-remote` looks more
authoritative and would make a 5-second poll a network dependency.

**`plot-plan-meta.sh` takes paths, not content**
(`Usage: plot-plan-meta.sh <plan-file>…`), so a git-sourced plan must be staged
to a file before parsing. Tested — it parses correctly from any path. But the
returned `file` field is then the **staging path**, and `PlanCard.tsx` renders
`card.path` verbatim, so a Discovery card would display
`/var/folders/…/probe.md` instead of `docs/plans/2026-08-16-….md`. Restore the
repo-relative path after parsing: a plan's identity is its canonical path, not
wherever it was staged.

### Done when

- **A Draft plan under PR review appears in Discovery.** Demonstrate against
  the real repo — do not assert it from the code.
- Design shows only approved-not-started plans; its two current cards stay put.
- **The swimlane view shows the same plans as the column view.** Assert both
  renderers over one payload.
- **The card's path is the repo-relative plan path**, never the staging path.
  Assert the exact string — this fails silently and merely looks untidy.
- **No network call is added to the poll path.** Pin that the implementation
  uses `for-each-ref`, not `ls-remote`. Timing assertions are not enough: the
  wrong call is only ~450 ms slower and would pass a generous threshold.
- **A repo with no idea branches behaves exactly as today** — additive and
  silent when empty; this is the common case for adopters.
- An `Impl: same branch` plan in Draft is found too.
- A branch with no plan files is skipped without error, and prefixed branches
  whose plan files all exist on the default branch produce **no duplicate
  cards**. De-duplicate by canonical path, matching `collectPlanFiles`'s
  existing contract.
- `pnpm run test:board`, `pnpm run typecheck`, `pnpm test`, `pnpm run validate`
  all pass.
- `pnpm build:board` run and the artifact committed — CI gates on no-diff.
- A changeset is present.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`.

### Scope guard

`packages/board/**` only. If you find something the plan did not anticipate,
report it rather than improvising outside scope — in particular, do **not**
change `plot-fleet-scan.sh` or `plot-plan-meta.sh`; both are owned by other
branches or by the plan format contract.
