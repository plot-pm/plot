## Implementation brief — board-watches-for-stuck-branches, wave 3 (Repair)

- **Plan (canonical):** `docs/plans/2026-08-17-board-watches-for-stuck-branches.md` on `main`
- **Approved:** 2026-08-17, jwloka, plan-PR #181 merged (one interrogation round)
- **Branch:** `feature/pulse-resolves-artifact-conflicts` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review per repo convention; CI `validate` must pass

### What to build

**The only automatic write this system grants.** An artifact-only merge
conflict is repaired without a click: merge, take a side, rebuild, run
the board suite, and push **only if it passes**.

Read this brief twice before writing anything. Every constraint below is
load-bearing — the permission exists *because* of them, not despite them.

### Why this one repair may be automatic

Three properties, each verified rather than assumed:

1. **`-merge` keeps the file valid.** `.gitattributes` marks
   `skills/plot/scripts/board/board-server.mjs` so git keeps one side
   whole and writes **no conflict markers**. The artifact stays buildable
   JavaScript *through* a conflict.
2. **The rebuild is deterministic.** Measured: `build.mjs` embeds no
   timestamp and no randomness. The output does not depend on which side
   was kept.
3. **CI proves it.** The no-diff gate fails the build if the committed
   artifact does not match a fresh rebuild.

Together: the one repair whose correctness is checkable **without
judgement**. That is the whole licence. No other failure has these
properties, and none may be added to this path.

### Six constraints — none of them optional

**The fence is `length === 1`, not `includes`.** Wave 1 shipped it:

```ts
return conflicts.length === 1 && conflicts[0] === BOARD_ARTIFACT_PATH;
```

Consume `stuck.state === 'artifact-conflict'`. Do **not** re-derive the
classification, and do not widen it. A conflict touching the artifact
*and* anything else needs judgement as a whole even though one of its
files does not.

**Never act on a host verdict with no observed set.** Recorded in the
plan after wave 1 found it: `merge-tree` predicts from **this machine's**
refs; the host computed against the branch as it stands. A stale ref
makes the prediction wrong *in the reassuring direction*. So
`pr.state === 'conflicts'` with an empty `conflicts` array is a plain
`conflict`, never `artifact-conflict` — and this wave may only act on a
set it has actually observed. Wave 1 already encodes this; do not undo
it.

**Tests run BEFORE the push.** The CI no-diff gate is what makes the
repair checkable, but CI runs only *after* the push. A resolver that
pushes and waits would create exactly the state this plan defines as
stuck: a red PR in the queue. So the sequence ends on
`pnpm run test:board` **green in the branch's own worktree**, and CI
becomes confirmation rather than discovery.

**If the suite fails, push nothing** and leave the branch reported as a
real conflict. The repair stopped being mechanical the moment its own
gate said so.

**Do not read the artifact diff.** Take either side — the rebuild
overwrites it. Never phrase it as "take ours": under `git merge` *ours*
is the branch being merged into, under `git rebase` it is the upstream,
and this repo rebases routinely.

**One repair at a time, and never two on one branch.** A second run while
the first is working would fight over the same worktree. Guard it the way
the board already guards in-flight work.

### The measurement that changes the shape

**`Worker command` is NOT configured in this repo** — measured just now
via `plot-config.sh get "Worker command"`. So `plot-dispatch.sh` would
create a worktree and report `worker=unconfigured`: no agent, no repair.

**And an agent is the wrong instrument anyway.** The plan's own sequence
is fully determined:

```
git merge origin/main            # in the branch's own worktree
git checkout --<side> skills/plot/scripts/board/board-server.mjs
pnpm build:board
pnpm run test:board
git commit && git push           # only on green
```

Every step is fixed and nothing between them is a decision — which is
*precisely* what licenses the automation. Handing this to an agent would
introduce judgement exactly where its absence is the permission.

So build it as a **script** the server runs, not as a dispatched agent.
Reuse `plot-dispatch.sh`'s worktree and claim mechanics if that is the
cleanest path; do not reuse its worker-spawning.

### Done when

- **Only `artifact-conflict` is repaired.** Assert `conflict`,
  `ci-failing` and `unpushed` are untouched.
- **A mixed conflict set is refused.** The pairing that matters: an
  implementation asking *is the artifact among the conflicts* passes
  every artifact-only assertion and silently repairs merges that need
  judgement. Assert artifact-plus-one-other is refused.
- **A host verdict with no observed set is refused.** Assert
  `pr.state === 'conflicts'` with `conflicts: []` triggers no repair.
- **Nothing is pushed until the board suite passes.** Assert a failing
  suite pushes nothing and reports a real conflict instead.
- **The committed artifact matches a fresh rebuild**, whichever side was
  kept — the property `.gitattributes` argues and CI gates.
- **Two repairs never run on one branch at once.** Assert a second
  trigger while the first is in flight is refused.
- **The localhost guard is unchanged.** Assert `/api/dispatch` and
  `/api/approve` still refuse over a non-localhost binding — this
  resolver is a separate path and must not widen them.
- **Every repair is reported.** Assert the row says a repair ran, and
  says so whether it succeeded or was abandoned. A silent automatic write
  is indistinguishable from a defect, which is the failure mode this
  whole plan exists to remove.
- **No other failure gains an automatic path.** Assert the resolver's
  entry condition is exactly the one state.

Plus: `pnpm run test:board`, `pnpm run test:reconcile`,
`pnpm run typecheck`, `pnpm test`, `pnpm run validate` all pass;
`pnpm build:board` run **in your own worktree** and the artifact
committed (CI gates on no-diff); a changeset is present with its
`bumps:` block. **Do not edit versions by hand.**
macOS bash 3.2 — **no `declare -A`**.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the
plan's `## Branches` section on `main`. **Check you are on `main` before
that edit** — an agent today committed plan bookkeeping onto another
agent's branch by not checking.

**Push your first real commit as soon as it exists**, and **push again
immediately after any rebase**.

### Scope guard

The resolver path, its guard, and its tests. Reuse wave 1's
classification and wave 2's reporting; do not modify either.

**Do NOT widen `/api/dispatch` or `/api/approve`.**

**Do NOT add a rerun route.** Wave 2 found there is none and deliberately
offered a link instead; a real rerun needs its own guarded route and its
own plan.

**Do NOT touch `[data-change-mark]`, `[data-live-dot]`,
`[data-activity-mark]` or `[data-stuck-cue]`.** Four marks, four
meanings, and no mark implemented by modifying another.

**`activity-shows-itself` wave 2 and `not-started-says-what-it-waits-for`
are both eligible in `AgentList.tsx`.** Neither is dispatched right now;
if one lands while you work, rebase rather than race.

### Notes on this repo

Vitest runs with `environment: 'node'` — no jsdom. Recent waves put their
decisions in **exported pure functions** and asserted those. The entry
condition and the refusals all reduce to predicates; the sequence itself
wants an integration test against a real temp repo.

**Two known CI flakes — neither is yours, do not "fix" them:**
1. Playwright's CDN has returned `403 — this service is not available in
   your location` while installing a browser.
2. `discovery.test.mjs` counts `plot-board-branch-*` in a **shared**
   `os.tmpdir()`; CI has also seen `ENOTEMPTY` tearing down its temp
   `.git`. A recorded finding awaiting its own plan.

GitHub's API returned `503` twice this afternoon. If a push or a merge
fails that way, retry rather than concluding anything about the code.

If you find something the plan did not anticipate, **report it rather
than improvising** — and on this wave more than any other. The permission
here is narrow by construction, and widening it quietly would remove the
argument that grants it.
