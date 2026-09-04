## Implementation brief — one-answer-to-did-this-land (slice Asking the host)

- **Plan (canonical):** `docs/plans/2026-09-04-a-ref-is-not-a-claim.md` on `main`
- **Approved:** 2026-09-04, Jan Wloka, in-session
- **Branch:** `feature/one-answer-to-did-this-land` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Slice 1 of three.

### The measurement

**2026-09-04: ten merged branches still carry a remote ref, and ancestry disagrees with the host on 10 of 10.** Squash-merge does not make `git merge-base --is-ancestor` occasionally wrong here — it makes it wrong every time, because the squashed commit is not the branch's commit.

`plot-pr-merged.sh` already states the rule: *reads `mergedAt`, never `state`, and never ancestry.* The estate has one right answer and does not use it where it keeps failing.

### What this branch owns

**Every path whose answer DECIDES WORK reads `plot-pr-merged.sh`.** No caller derives merge state from ancestry, and none from `state` — a merged PR reports `CLOSED` through some hosts.

**A CI gate that bans the DECISION, not the call.** This is the harder half and it is the point of the slice.

**Two of the seven ancestry callers are correct and must survive it:**

- `plot-merge-queue.sh:102` skips a branch already in main before predicting conflicts
- `refs-git.ts:159` is named `isMergedByAncestry` and answers `unknown` when it cannot tell

Neither asks *did this land*. They ask *can I skip this cheaply*, where a wrong answer costs extra work rather than hiding finished work. **A gate banning every `is-ancestor` would ban `refs-git.ts`'s own documented `unknown`** — the exact honesty this plan asks for everywhere else.

So the gate must distinguish them. If you cannot write one that does, **say so in the PR and ship the caller fixes without it** — a gate that fires on correct code is worse than none, and this repo has paid for that once already tonight in three corpus floors.

### What it does NOT own

**The re-claim.** Slice 2 owns what offers a merged branch.

**`origin/HEAD`.** Slice 3.

**Deleting refs.** `plot-release-refs.sh` keeps its plan-scoped licence; round 1 established the ten refs are re-created by a claim, not left behind by a failed deletion.

### Done when

- No path that decides merge state uses ancestry or `state`; each reads `plot-pr-merged.sh`.
- The two correct ancestry callers are untouched and still pass.
- The gate exists and does not fire on them — or the PR says why it was not written.
- Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, plus `cd packages/domain && npx tsc --noEmit` and `pnpm run test:corpus`.
- `pnpm build:board` run and the artifact committed.
- A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate.
