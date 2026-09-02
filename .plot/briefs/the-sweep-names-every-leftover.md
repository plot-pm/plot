## Implementation brief — the-sweep-names-every-leftover (wave Sweeping what was overlooked)

- **Plan (canonical):** `docs/plans/2026-09-02-an-agent-holds-one-desk.md` on `main`
- **Approved:** 2026-09-02, Jan Wloka, in-session
- **Branch:** `feature/the-sweep-names-every-leftover` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** in-session

Wave 4 of five.

### What this branch owns

**The sweep answers one question: is anything here that nobody is coming back for?** It does not care whether the cause was a dead agent, an interrupted dispatch, a `--stop`, or a merge somebody did on the host.

**Three populations are swept today and three are not.** Measured 2026-09-02 on this estate:

| Leftover | Swept by | Measured |
|---|---|---|
| worktrees | `plot-reap.sh` | 19 reaped by hand |
| worker files, registry entries | `plot-reap.sh` | with the tree |
| remote refs | `plot-release-refs.sh`, plan-scoped | 9 deleted, scan 218.5 s → 111.5 s |
| **local branches** | **nothing** | **85 of 98 already merged** |
| **orphaned claim refs** | **nothing** | a claim whose agent never existed |
| **dirty trees nobody owns** | refused, never resolved | 2 desks, 52 and 1 files |

**Local branches are the largest population and the one no script looks at.** The gate is two measurements, and it is the reaper's rather than git's:

> **the host says merged, AND no worktree holds it → delete**

**`git branch -d` is not the gate.** It refuses an unmerged branch, which sounds like the safety this needs — except **squash-merge leaves a branch permanently ahead of main**, the trap `plot-pr-merged.sh` exists for. `-d` would refuse all 85, for the wrong reason. Ask `plot-pr-merged.sh` instead: it reads `mergedAt`, never `state` (a merged PR reports `CLOSED`) and never ancestry, across ANY PR rather than the newest, and an unreachable host answers *not merged*, so silence is never permission.

**The second half of the gate matters on its own.** Deleting a branch out from under a checkout is exactly what the reaper's guards exist to prevent. `plot-release-refs.sh:126` already collects every branch checked out anywhere for its guard 4; reuse that reading rather than writing a second one.

**A local branch is not the third case it first looks like.** An earlier draft called it *"the last copy of a reflog"* and borrowed the remote-ref caution for it. That is wrong: a local branch whose PR merged is re-fetchable from `origin`, so it is a copy, not the copy, and the argument that protects remote refs does not transfer.

**Report-only was the alternative, and 85 rows is the argument against it.** A sweep that reports and never acts becomes one more thing a person has to clear — the problem this plan exists to remove, reintroduced one level up.

**An orphaned claim ref is a claim whose agent never existed.** `plot-reconcile-scan.sh:423` defines the marker precisely: a claim commit is titled `plot: claim ...` **and** empty, its tree equal to its parent's — the subject alone is not evidence, because a human commit titled *"plot: claim handling refactor"* carrying real files would otherwise read as an empty claim. `plot-reconcile-scan.sh` section 3 already classifies these: a `deferred:`/`moved:` annotation in the plan means reapable, a bare `claimed:` needs judgment. **Sweep only what that classification already calls reapable**; leave the judgment cases for a person, and keep reporting them.

**A dirty tree nobody owns is refused today and never resolved.** Keep it refused. `uncommitted-changes` is a refusal for the reason the create-or-reset guard does not `reset --hard`: the case where the guard is wrong is exactly the case where destruction cannot be undone. **Name it as a leftover with an owner of nobody, and report it loudly enough that a person clears it** — do not delete it.

**The five refusals stay exactly as written**, in both implementations. `plot-reap.sh:414`–`:419` renders them and `packages/domain/src/rules/reapable.ts:89`–`:101` decides them: `live-worker`, `blocked-marker`, `uncommitted-changes`, `on-default-branch`, `no-merged-pr`. They were written for precisely this population, and a backstop that guesses is worse than none. `plot-reap.sh:30` states the rule that governs any new kind: **a rule that cannot be asked REFUSES.**

**The five guards on `plot-release-refs.sh` stay too**, and their asymmetry with the reaper is deliberate: a deferred/moved branch keeps its ref (`:164`), no merged PR keeps it (`:176`), an **open** PR vetoes even where an older PR merged (`:186` — `changeset-release/main` is merged repeatedly and Changesets recreates and reuses it), a branch checked out anywhere keeps it (`:198`), and the default branch is never deleted (`:153`).

**The asymmetry between kinds is deliberate and stays.** A removed checkout comes back with `git worktree add`; a deleted remote ref does not. So worktrees are swept estate-wide and refs stay plan-scoped — the licence `plot-release-refs.sh:29` already argues. **A local branch joins the estate-wide side**, because it is re-fetchable.

**Every new kind is `--dry-run` by default, removes on `--yes`, and is bounded by `--max N`** — the shape `plot-reap.sh` and `plot-release-refs.sh` both already have.

**The cutover population is this sweep's, and the plan says so rather than leaving it inferred.** This estate carried 11 worktrees, 8 loop processes and 1 manifest while the plan was written — desks made under the old model, most with no identity. An old desk is exactly the leftover this branch already handles.

### What it does NOT own

**It does not change how a desk is created or reset.** `feature/an-agent-decides-create-or-reset` owns `plot-worker-loop.sh:723` and the create-or-reset guard. The sweep is the repair for agents that died holding a desk, not the routine path.

**It does not define `free` or clear `branch`.** `feature/an-agent-says-when-it-is-free` owns both.

**It does not build the queue or the assignment lock.** `feature/the-registry-queues-a-brief` owns those, and waits on the daemon.

**It does not amend a spec.** `docs/the-desk-belongs-to-the-agent` owns `DESIGN-worktree.md:60` and `DESIGN-branch.md:52`. `DESIGN-worktree.md:64` says every one of the five refusals is a question about the agent or what it left behind and none asks anything about the tree itself — **keep that true for every kind this branch adds.**

### Done when

- [ ] A merged local branch that no worktree holds is deleted, on those two measurements and never on `git branch -d` alone.
- [ ] A squash-merged branch is deleted, with a test that fails if the gate uses ancestry or `state`.
- [ ] An unreachable host deletes nothing.
- [ ] Orphaned claim refs the reconcile scan already classifies as reapable are swept; bare `claimed:` cases are reported and left.
- [ ] A dirty tree nobody owns is reported with its owner named as nobody, and nothing is deleted from it.
- [ ] The reaper's five refusals and `plot-release-refs.sh`'s five guards are unchanged in both the shell and `packages/domain/src/rules/reapable.ts`.
- [ ] Every new kind is `--dry-run` by default, acts on `--yes`, and honours `--max N`.
- [ ] Green: `pnpm run test:reconcile`, `pnpm run test:board`, `pnpm run typecheck`, **plus** `cd packages/domain && npx tsc --noEmit` and `pnpm --filter @plot-pm/domain run test:corpus` — the root `typecheck` script is `pnpm --filter @plot-pm/board typecheck`, so it covers the **board only**.
- [ ] `pnpm build:board` run and the artifact committed.
- [ ] A changeset, description FIRST and any `bumps:` block LAST.

**Do not run `pnpm run test:e2e`.** It is CI's gate, and it dispatches real workers into sandbox repositories. Two agents running it here produced 53 concurrent test processes, load average 8.69, and a board that could not answer a request in 25 seconds.
