# Implement leaves its brief and plan edits uncommitted in the main checkout

> A `--brief-only` implement run leaves its first writes of the brief and the `Started:` record in the operator's main checkout, which blocks the operator's own fast-forward. Separately, fleetd reads plans from the main checkout's working tree, so an approval merged on the host reaches the queue only after someone updates that checkout.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2725
- **Rounds:** 1
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-26, Jan Wloka, plan-PR #2726 merged
- **Started:** 2026-10-26, Jan Wloka, `bug/implement-books-the-brief-in-a-worktree`
- **Started:** 2026-10-26, Jan Wloka, `bug/fleetd-plan-store-reads-the-ref`

## Changelog

- A `--brief-only` implement run writes and commits its brief and `Started:` record only in a disposable worktree cut from `origin/<default>`, so the main checkout's status, `HEAD` and branch stay unchanged by the run.
- fleetd reads plans from `origin/<default>`, so a plan approved or delivered on the host reaches the queue without an update of the main checkout.

<!-- Board impact: the board already reads plans and briefs from `origin/<default>` (`collectPlanSources`, `packages/board/src/server/board.ts:743`; brief reads at `:2922`). Slice A changes no plan format, template or `docs/plans` layout. Slice B changes the source of fleetd's queue, and every board view that shows fleetd's queue then agrees with the board's own ref reading. -->

## Motivation

Three implement runs on 2026-10-26 left the operator's main checkout dirty:

- `d315381c6` (brief for `pr-reader-lock-elects-one-writer`): the agent wrote the brief and the plan edit into the main checkout, the gate refused its `git stash -u; git merge --ff-only; git stash pop`, and the agent committed from `/tmp/plot-brief-scratch`. A later `git pull` autostash conflicted on the plan's `Started:` lines.
- `8a714dee7` (brief for `fleet-start-probes-worker-writes`): the agent wrote both files into the main checkout, the gate refused the commit, and the agent committed and pushed from a disposable worktree. The gate then refused its `git restore`. The leftovers were byte-identical to `origin/main`, and `git merge --ff-only origin/main` refused until the operator removed them.
- `cc5c7a1d5` (brief for `nothing-done-asks-pr-state-only-where-it-decides`): this run wrote only in a disposable worktree and left nothing behind. The untracked `.plot/briefs/fleetd-holds-the-pr-index-lock.md` in the checkout came from an earlier run, `8f06bd8fc`.

The leftovers are the agent's own first writes. `skills/plot-implement/SKILL.md` step 4 (`:215-262`) writes the brief "where the plan lives" and commits there, and uses a disposable worktree only to recover a rejected push. When the commit is refused, the agent moves the work to a disposable worktree, and the first writes stay in the main checkout.

The refusals come from version skew, not from the gate's design. `packages/fleet/src/shared/implement-run.ts:617` sets `PLOT_MAIN_CHECKOUT_WRITER=1`, and `gatesMainCheckout` (`packages/domain/src/rules/main-checkout-write.ts:32-33`) exempts that marker. The marker arrived in `da7097509` (#2317, 2026-10-22). The board (pid 23604, started 2026-10-20) and fleetd (pid 8692, started 2026-10-17) ran bundles without it, while every agent session loaded the current plugin gate. The spawner sent `PLOT_UNATTENDED=1` without the marker, and the gate refused. #2728 tracks the skew and its detection, with its own plan.

fleetd does not read briefs from the main checkout. `briefPresent` (`packages/fleet/src/server/entry/registryd-main.ts:768-779`) and `brief_present` (`skills/plot/scripts/plot-dispatch.sh:548`) read `origin/<default>`, which a push from any worktree moves at once. Every `held on no-brief` line in the window names `bug/fleet-start-probes-worker-writes`, whose brief did not exist until `8a714dee7`. That hold was correct. The slice that `cc5c7a1d5` briefed was held on `no-free-agent` and then handed over.

Two harms remain:

1. A dirty main checkout blocks the operator's own fast-forward and autostash.
2. fleetd's plan list depends on the checkout. `listPlans` (`packages/domain/src/adapters/plan-store/plan-store-shell.ts:184-197`) runs `find docs/plans` in the working tree, and the queue builds from it (`registryd-main.ts:753-758`). A plan approved on the host (`9f2513068`, 20:38) stayed invisible to the queue until the operator fast-forwarded the checkout at 20:55:43. This is the likely reason `nothing-done-asks-pr-state-only-where-it-decides` sat in `not-claimable` (inference: the log does not name not-claimable branches).

A fix in the board or fleetd bundle reaches a machine only after a restart of that process. The operator restarted both on 2026-10-26 at 21:18, which removes the skew on this machine for now.

## Design

### Approach

**Slice A: the brief run books in a disposable worktree.** A `--brief-only` run writes and commits the brief and the `Started:` record only in a worktree cut from a freshly fetched `origin/<default>`, the way `write_started_record` (`skills/plot/scripts/plot-dispatch.sh:3406-3498`) books a `Started:` record: `git worktree add` from `origin/<default>` (`:3434`), commit, push, then `git worktree remove` (`:3498`). The main checkout stays byte-for-byte unchanged: `git status --porcelain`, `HEAD` and the checked-out branch are the same before and after the run, also when the spawner sets no `PLOT_MAIN_CHECKOUT_WRITER`.

- **The booking is code, not prose.** A JS entry point under `skills/plot/scripts/board/` takes the slug, the branch and the brief text, and runs entry → domain → port → adapter. The domain decides what to write (the brief path from the branch suffix, the `Started:` line, and "a brief already on `origin/<default>` is success, write no second commit", from step 4). The `Trees` port carries the git operations (`fetch`, `add`, `stage`, `commit`, `push`, `removeOnly`/`removeWithBranch` in `packages/domain/src/ports/trees.ts`); the push keeps the lock and Writer App mechanics of `plot-push-main.sh` behind an adapter. No new shell, so `scripts/check-shell-lines.sh` charges nothing. The new bundle gets a row in `skills/plot/scripts/README.md` (`scripts/check-helper-table.sh`).
- **Skill.** `skills/plot-implement/SKILL.md` step 4 and step 5 make the booking entry point the primary path under `--brief-only`: the agent writes the brief text to a scratch file outside the repository and calls the entry point, and writes nothing in the main checkout. The paragraph at `:129-135` changes from "runs this skill's agent directly in the operator's main checkout" to the new path. The skill version bumps (minor), and the Model Guidance rows for steps 4 and 5 change: step 5 under `--brief-only` is one call, not a commit.
- **The writer marker.** `startImplement` always sets `PLOT_BRIEF_ONLY` (`implement-run.ts:619`) and prompts `--brief-only` (`:115-116`), so every run it starts is a brief run. After Slice A the run needs no main-checkout write, and Slice A removes `PLOT_MAIN_CHECKOUT_WRITER` from `implement-run.ts:617`. The main-checkout gate then refuses any git write this run makes in the main checkout, which turns the rule into a gate for git calls. The gate does not see a file written by the agent's Write tool; the fixture test covers that. The non-brief-only path is an attended `/plot-implement`, where `PLOT_UNATTENDED` is unset and the gate does not apply, so it needs no marker either. The other roles that set the marker (`deliver.ts:649`, `reslice.ts:473`, `story.ts:514`, `auto-deliver.ts:272`, `brief-ask.ts:163`) keep it.
- **`restoreCheckedOutBranch` (#2162).** The restore at `implement-run.ts:633` stays as the backstop for a run that checks out a branch anyway. Its docstring (`:485-488`) claims the agent "writes no uncommitted change of its own here, by the `main-checkout` gate's own contract"; the three runs above prove that false under skew. The docstring changes to state what holds after Slice A: the run books in a disposable worktree, and the restore is a backstop that changes the branch only. The end handler also compares `git status --porcelain` of the main checkout before and after the run, and logs the paths the run added by name. It removes nothing.

**Slice B: fleetd's plan store reads the ref.** fleetd lists and reads plans from `origin/<default>`, the way the board does since `2026-08-27-the-board-reads-the-ref-not-the-checkout` (`collectPlanSources`, `board.ts:737-770`; `readPlansFromRef`, `:552`). A plan store over the ref implements the existing `PlanStore` port: `listPlans` through `Refs.listBlobs` on `origin/<default>` with the plan directory, regular files only, so the `active/` and `delivered/` symlinks drop out; `readPlans` through `Refs.readBlobs`, staged to files for the one `plot-plan-meta.sh` spawn the way `board.ts:2060-2085` stages ref-read plans. An unreadable ref answers an empty list, which queues nothing, the safe direction that `claimedBranches` already takes (`registryd-main.ts:761-765`).

- **What reads the store in fleetd, and what changes.** Three sites build `planStoreShell` in `registryd-main.ts`: the supervisor world (`:478`, `planLinesFor` at `:1120`), the queue world (`:741`, `plans` at `:753-758`), and the index monitor (`:1986`, `sliceBranchesOf` in `packages/fleet/src/shared/index-monitor.ts:31-37`). All three move to the ref. A plan that exists only in the operator's working tree, or a local edit not yet pushed, no longer reaches fleetd. That matches the agents fleetd starts, which work from `origin/<default>`.
- **What does not change.** The board's own `planStoreShell` callers (`approve.ts:823`, `deliver.ts:644`, `needs-design.ts:344`, `record-pr.ts:182`, `gate.ts:324`, `verify.ts:894`, `plan-for-branch.ts:33`, `board.ts:210`, `estate.ts:84`) read the plan they then write or judge in a checkout, and stay on the working tree.
- The default branch comes from `refs.defaultBranch()`, never a literal `main`.

**Rejected designs.** A fast-forward of the main checkout after the push adds a writer under the running board, fleetd and worker loops: `git merge --ff-only` moves whatever branch is checked out, the board keeps serving its old bundle while its children run new scripts, and under skew the stale controller would run the step anyway. Reading briefs from the ref is already the current code (`registryd-main.ts:768-779`), so it fixes nothing.

**Agreement with #2162 and #2630.** #2162 restores the branch the checkout was on; Slice A never moves that branch, so the restore has nothing to do on a compliant run and stays as a backstop. #2630 expects a write in the main checkout to start from a fresh `origin/main` and a rejected push to be recovered in a disposable worktree, never by a mixed reset. Slice A makes the disposable worktree from a fresh fetch the first path rather than the recovery, so no write starts from a stale `HEAD` and no reset is ever needed.

### Open Questions

- [x] Which design? Answered by the operator on 2026-10-26: the disposable worktree (Slice A) and the plan store over the ref (Slice B). No fast-forward of the operator's checkout.
- [x] Refuse and name the files, or skip silently? Answered: no step fast-forwards the checkout, so the question no longer applies. The end handler names any path a run leaves and removes nothing.
- [x] Does `fleet-start` or the fleetd tick already fast-forward the checkout? Answered: no. fleetd reads briefs from `origin/<default>` and plans from the working tree. The only post-run step on the checkout is `restoreCheckedOutBranch` (`implement-run.ts:633`).
- [ ] Does fleetd's brief ask use the same booking? `briefAskPrompt` (`packages/fleet/src/shared/brief-ask.ts:73-76`) runs `/plot-implement` without `--brief-only` and sets the marker (`:163`), so the agent writes in the main checkout. Adding `--brief-only` to that prompt and removing its marker puts it on Slice A's path; leaving it keeps the leftover risk for that role.

## Slices

### Brief Booking

- `bug/implement-books-the-brief-in-a-worktree` — a `--brief-only` run books the brief and `Started:` record from a disposable worktree; a fixture repo test runs it with `PLOT_UNATTENDED=1` and no writer marker, with the main checkout behind `origin` and an untracked operator file present, and asserts the checkout's `git status --porcelain`, `HEAD` and branch are unchanged and `origin/<default>` holds the brief; SKILL.md steps 4-5 and Model Guidance changed; changeset package `plot`, `plot-implement: minor` → #2740

### Fleetd Plan Source

- `bug/fleetd-plan-store-reads-the-ref` — fleetd's queue, supervisor and index monitor read plans from `origin/<default>`; a fixture repo test approves a plan on the remote while the local checkout stays behind and asserts the plan's slices are in fleetd's queue; an unreadable ref queues nothing; changeset package `plot`

## Notes

Source: https://github.com/plot-pm/plot/issues/2725. The issue is the problem statement; the plan's `Issue:` field is the only link back to it. The correction comment on #2725 records the evidence the panel corrected.

- Panel round 1 (unanimous amend): `.plot/panels/2026-10-26-implement-leaves-its-brief-and-plan/`.
- Version skew between a long-lived board or fleetd and the plugin gate is #2728, with its own plan. This plan adds no slice for it.
- Both slices ship in the board and fleetd bundles and reach a machine only after the operator restarts those processes.
- Follow-up, not filed: `findMissingBriefs` (`packages/fleet/src/shared/auto-dispatch.ts:61`) reads the literal `'origin/main'`, so an adopting repository on another default branch reads every brief as missing on that path.
- Gates the change passes: `scripts/check-plan-headings.sh`, `scripts/check-changeset-packages.sh` (package `plot`), `scripts/check-helper-table.sh` for the new bundle, the spawn ratchet *One place reaches a process* (the git calls go through the `Trees` adapter), and `scripts/check-shell-lines.sh` (no new shell).
