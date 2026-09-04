## Implementation brief — a-merged-branch-cannot-be-claimed (slice Finding the re-claim)

- **Plan (canonical):** `docs/plans/2026-09-04-a-ref-is-not-a-claim.md` on `main`
- **Approved:** 2026-09-04, Jan Wloka, in-session
- **Branch:** `bug/a-merged-branch-cannot-be-claimed` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 2 of three. **Find the cause first. The refusal is the deliverable only once the cause is written down.**

### What is already measured

**Ten merged branches carry a ref whose tip is LATER than its own merge**, by two to six hours, and every tip commit is `plot: claim <branch>`. `gh pr merge --delete-branch` worked; a worker re-created the ref afterwards.

| branch | merged | ref tip |
|---|---|---|
| `feature/the-shell-stops-parsing-plans` | 09-01 05:44 | 09-02 00:09 |
| `feature/a-monitor-is-a-pure-rule` | 09-01 19:29 | 09-02 00:14 |
| `feature/the-board-reads-the-quiet-kinds` | 09-04 06:06 | 09-04 08:36 |

**Observed twice on one branch.** `feature/an-agent-declares-what-it-is` merged as #679 at 20:46 on 09-03, was re-claimed at 08:59, deleted, and re-claimed again at 13:35 — 35 minutes after deletion. Four slices sat blocked behind it each time.

### The hypothesis to confirm or refute

**The hop is correct; the offer is wrong.** `plot-worker-loop.sh` asks `--next` for another claimable branch and claims what it is offered — exactly as written. So the defect is in what `--next` considers claimable.

**`--next` runs `--offline`**, and an offline answer cannot ask the host whether a branch landed. `plot-worker-loop.sh:952` records that trade in its own comment.

**Confirm it before changing it.** This plan has already reported one cause it had not proven; do not add a second. Reproduce the re-claim, name what did it, and put the finding in the PR body.

### What this branch owns

**Whatever offers work asks the host before offering.** A merged branch is not claimable, and the check belongs wherever the offer is made — not at the hop, which is behaving correctly.

**A test that would have caught it.** Given a branch whose PR merged, `--next` must not name it.

### What it does NOT own

**The board's reading of merge state.** Slice 1.

**Deleting the ten refs.** Once the re-claim stops, they can be swept by the existing reaper on its existing licence. Do not add a sweep here.

### Done when

- The cause is named in the PR with the evidence that proves it.
- A merged branch is not offered as claimable, with a test.
- Nothing at the hop changed unless the evidence says the hop is wrong.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus`.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.
