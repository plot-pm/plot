# Juror verdict: mechanism (owner of the push-to-main path)

Position: amend

Evidence: Read the plan, issue #2804, issue #1349, plan `2026-10-17-delivery-reads-the-delivered-plan-and.md` (slice `bug/default-branch-writes-take-turns` → #2039, commit `212b5ccdc`), `skills/plot/scripts/plot-push-main.sh`, `skills/plot/scripts/plot-push-lock.mjs`, `packages/board/src/server/entry/ladder.ts`, `packages/board/src/server/entry/deliver.ts` (release arm), `packages/board/src/server/release.ts`, `packages/domain/src/adapters/trees/trees-git.ts`, `skills/plot-release/SKILL.md` step 5b, `packages/board/test/unit/ladder*.test.ts` (headers only). Ran: the reflog of `refs/remotes/origin/main` and `git log origin/main` for 2026-10-28 in the main checkout; the mtimes and values of the 53 `plot-release-*.state` files under `.worktrees/`; a reproduction script (`scratchpad/juror-2804-mechanism/sim.sh`) that runs 20 concurrent writers against a local bare repo using the real, unmodified `plot-push-main.sh` and `plot-push-lock.mjs`, the adapter's exact git arguments (`worktree add -q -B`, `checkout -q -f -B`), a 1 s pre-push hook, and the ladder's loop shape (5 attempts, jittered wait, fetch, re-cut, re-apply); and a 30-way concurrent `git branch -D` probe. Git 2.55.0, Node 24.21.0. I ran no vitest file.

## (a) Problem statement

The cited facts check out against the code:

- `PLOT_PUSH_LOCK_WAIT` defaults to 120 s (`plot-push-lock.mjs:57`); the 2026-10-07 measurement is at `plot-push-lock.mjs:11-14`.
- Five attempts is `DEFAULT_ATTEMPTS` (`ladder.ts:27`), with a 2–10 s jittered wait (`ladder.ts:30-33`).
- `releaseStatus` is at `release.ts:89`, and its states `unknown | running | done | failed` are at `release.ts:65`.
- Step 5b gives one call per plan and says nothing about waiting (`skills/plot-release/SKILL.md:445-452`).

**The plan misnames the cause.** It says the lock "serialises the push, and 5 retries do not cover a queue of about 50 writers". That describes the symptom. The cause is the scope of the lock: it covers the `git push` and nothing before it.

- `plot-push-main.sh:109` takes the lock, and the lock ends when that script exits.
- The base is read earlier and outside the lock. The first cut is at `deliver.ts:835-840`: `fetch`, then `addBranch(…, origin/main)`. Each retry reads it again at `ladder.ts:196-207`: `fetch`, `resetBranch`, `reapply`, `commitAndPush`.
- So every waiter queues on the lock with a base that was read before it started waiting. The first push that lands makes every queued base stale.
- Each stale job then holds the lock for a full push round trip just to receive `non-fast-forward`. With the Writer App, that round trip includes a token exchange (`plot-push-main.sh:121`).
- The lock does not prevent the race. It lines the losers up behind each other.

The reproduction shows this. Under the current shape (`run3`, booking branches created `--no-track`, 20 writers):

- 4 of 20 jobs exhausted 5 attempts.
- 47 attempts were rejected `non-fast-forward` and 9 ended `locked` (exit 6).

With the lock moved to span fetch → cut → commit → push (`run4`, same 20 writers):

- 18 of 18 jobs that got a worktree landed on the first attempt.
- 0 attempts were rejected.

The current shape fails at 20 writers, not only at about 50. The fault is the shape, not the size of the queue.

**There is a second cause the plan does not name: `.git/config` lock contention.** `trees-git.ts:457` runs `git worktree add -q -B <branch> <path> origin/main`, and `trees-git.ts:464` runs `git checkout -q -f -B <branch> origin/main`. With a remote-tracking start point and default `branch.autoSetupMerge`, both commands write upstream config into `.git/config`. Concurrent jobs collide on that write.

- In the faithful run (`run1`/`run2`, the adapter's exact arguments), 14 of 20 jobs failed before any push, with `error: could not lock config file .git/config: File exists` / `unable to write upstream branch configuration`.
- In `deliver.ts:841-842`, that failure surfaces as the refusal "could not prepare a booking worktree…".
- On a retry it surfaces at `ladder.ts:202-204` as "retry stopped — could not reset".
- Neither message says `non-fast-forward`.
- Separately, concurrent `worktree add` produced `fatal: failed to read .git/worktrees/wt10/commondir` in 2 of 20 jobs, even with `--no-track`.

**The plan's numbers do not add up.** 24 failed plus 11 released is 35 of 53, which leaves 18 jobs unaccounted for. The config-lock failure is a likely home for those 18, but this is inference: the original first-pass logs were truncated by the re-run, because `release.ts:167` opens the log with `'w'`. The plan should state the 18 or name them as unknown.

The local reflog adds one fact the plan should carry. 52 `update by push` entries for the release commits fall between 07:07:55 and 07:13:35 on 2026-10-28, which is about 6.5 s per landed push. That is the lock's real throughput. At that rate, a 120 s wait covers about 18 queued writers.

## (b) Approach

- **Candidate 2 (raise the retry budget) treats the symptom.** Under the current shape, every landed push still costs every other waiter one attempt. The attempts needed grow with N, and so does the time each job holds the lock to be rejected. Reject it as the fix.
- **Candidate 3 (batch the push) changes the one-call-per-plan contract.** `release.ts` is one slug per route. Six controllers share the ladder: `deliver.ts:499` and `:866`, `approve.ts:1270`, `verify.ts:782`, `needs-design.ts:471`, `brief-book.ts:179`, and `record-pr.ts:129`. Batching reaches none of them. Out of scope for a bug.
- **Candidate 4 (document the wait) is a rule.** Ship it only as a companion edit.
- **Candidate 1 (queue in the board) fixes the cause for one route only. It has three problems.**
  1. It serialises only callers that go through the board. Step 5b's own no-board path is `plot-deliver.sh --release` (`SKILL.md:448`), and the approve, brief-book, record-pr, verify and needs-design bundles run outside the board as well. They still race each other, and they race the board's queue. The same defect returns through every other entrance. #1349 already named approve, and the plan's Open Point 3 is that concern.
  2. A queue held in board memory dies with the board process (`node --watch` restarts it). A queued release that was never spawned leaves either no log, which `releaseStatus` (`release.ts:96-98`) reads as `unknown`, or a pre-opened log with no state file, which it reads as `running` forever. Either is a new false state.
  3. It puts a lifecycle-ordering decision in a board route. The layering rule wants that decision in a place every controller passes through. That place already exists: `commitAndPush` is the one ladder all six controllers climb, which the header at `ladder.ts:1-7` states.
- **The cause-level fix is to widen the lock's scope, not to add a queue.**
  - `commitAndPush` takes the default-branch lock before it reads the base. It holds the lock through fetch → reset → reapply → commit → push, and it releases the lock after the push outcome.
  - The first cut in each caller moves inside that window, or `commitAndPush` performs it.
  - `plot-push-main.sh` then must not take the lock a second time. Either `commitAndPush` passes the held lock in, for example a `PLOT_PUSH_LOCK_HELD=<pid>` that `plot-push-lock.mjs take` honours, or the lock moves out of the script into the ladder. `plot-dispatch.sh` and `plot-reconcile-scan.sh` also name `plot-push-main.sh` and keep the script-level lock.
  - This covers all six callers and every entrance, board or no board.
  - The race the plan describes then cannot occur, because no writer holds a base that another writer can move.
- **Booking branches stop writing `.git/config`.** Add `--no-track` to `addBranch` and `resetBranch` (`trees-git.ts:457`, `:464`). A booking branch is pushed as `<branch>:<default>` and never needs an upstream. This is independent of the lock, and it removes the second cause even for writers that never meet the lock.

## (c) Slices

The single slice is the right size if it targets the ladder instead of `release.ts`. The proposed cut:

1. **`bug/default-branch-lock-spans-the-booking`**:
   - the lock spans the read-modify-write in `commitAndPush` and the callers' first cut;
   - `--no-track` in `addBranch`/`resetBranch`;
   - exit 6 handled as "wait again" without re-cutting, as the header at `plot-push-main.sh:35-37` already prescribes. `ladder.ts:193-207` currently treats exit 6 as a rejection and re-cuts.
2. **The step 5b edit (candidate 4)** names the serialisation and says that back-to-back calls are safe. Docs only, so it can ride with slice 1.

Nothing needs to ship first on its own. `--no-track` is small enough to ship first if the lock-span slice stalls, and it alone removes the 14-of-20 pre-push failures I reproduced. Board impact: `ladder.ts` and `trees-git.ts` change, so main rebuilds the bundles. `release.ts` changes only if a queued state is added.

## (d) Open questions

- **Which candidate?** None as written. Choose candidate 1's intent, serialisation, but put it in the ladder lock, not a board queue. Reasons are in (b).
- **Does a queued job need a `queued` state?** Not with the ladder lock. The process is spawned and its log exists, so `releaseStatus` correctly reads `running` while the job waits on the lock. The job should print one line such as `step: waiting for the default-branch lock held by pid N (<action>)`, so `lastLines` shows why. A board queue would need a new state, and it would need to live in the domain ("Every rendered state is a domain property"). That is one more reason not to build the queue.
- **Should the same queue cover `/api/approve`?** Yes, and the ladder lock does this without extra work. `approve.ts:1270` calls `commitAndPush`, and so do verify, needs-design, brief-book and record-pr.
- **Is 120 s the right bound?** No, not as an absolute wall-clock bound. At the measured 6.5 s per push, it covers about 18 waiters, and job 53 would wait about 340 s. The lock also polls every 250 ms (`plot-push-lock.mjs:87`) with no FIFO order, so a waiter can starve however long the bound is. Two proposals:
  - make the bound measure no progress: restart the 120 s whenever the `owner` holder changes, so a moving queue never times out and a hung holder still does after 120 s;
  - or add a ticket for FIFO order.
  The stale-holder rule (`plot-push-lock.mjs:21-26`, 600 s) still covers a hung holder.
- **New: where did the other 18 of 53 go?** The plan must state them. My reproduction points at the `.git/config` lock.
- **New: does a widened lock hold across the release arm's tracker call?** It must not. The tracker write after the push (`deliver.ts:887` onward) must stay outside the lock, so a slow `gh`/Jira call does not block every other writer.
- **New: what happens to `plot-dispatch.sh`'s push-main use when the ladder holds the lock?** The ladder must not re-enter the lock from a nested script.

## (e) Tests

- **Board unit, real repository** (extend `packages/board/test/unit/ladder-real-repo.test.ts`, which already runs the real `plot-push-main.sh` against a bare origin):
  - Start N = 8 `commitAndPush` calls at once, more than `DEFAULT_ATTEMPTS`. Use `retryWait` stubbed to 0, a pre-push hook that sleeps about 200 ms, and booking worktrees cut through `treesGit`.
  - Assert that all 8 files are on `origin/main`, that no outcome is `rejected`, and that no `non-fast-forward` line appears.
  - On today's code this is probabilistic (my 20-writer run lost 4). Pair it with the deterministic test below.
  - The test must wait for its children to exit (memory: *board tests that spawn must wait for exit*).
- **Board unit, deterministic:**
  - With a `Trees` fixture, assert that `fetch` and `resetBranch` run only while the lock directory exists, recorded at call time. This is the property that makes the race impossible.
  - Also assert that exit 6 from the push consumes no attempt and does not call `resetBranch`.
- **Domain/adapter unit:** add `trees-git` cases where `addBranch` and `resetBranch` leave no `branch.<name>.merge` key in `.git/config`. Add one case that runs 10 `addBranch` calls at once and gets 10 worktrees.
- **Contract (`test/reconcile`):** if the bound becomes progress-based, add a case where `plot-push-lock.mjs take` outlives `PLOT_PUSH_LOCK_WAIT` while the holder changes, and a case where it exits 6 when one holder stays past the bound.
- **No browser test is needed.** No rendered state changes unless a `queued` state is added.

## Amendments

1. Restate the cause: the lock covers the push but not the base read (`plot-push-main.sh:109` against `deliver.ts:835-840` and `ladder.ts:196-207`). Every landed push therefore makes every queued writer stale.
2. Add the second cause: `git worktree add -B` and `checkout -B` from `origin/main` write `.git/config` (`trees-git.ts:457`, `:464`), and concurrent jobs fail on its lock before they push. Reconcile the 53 = 11 + 24 + 18 count.
3. Replace "candidate 1, queue in the board" with "the default-branch lock spans the ladder's read-modify-write", so all six `commitAndPush` callers and the non-board entrances are covered. Keep the tracker call outside the lock.
4. Add `--no-track` to the booking branch's `addBranch` and `resetBranch`.
5. Make `commitAndPush` handle exit 6 as wait-and-repeat without re-cutting and without consuming an attempt, as `plot-push-main.sh:35-37` prescribes.
6. Replace the absolute 120 s wait with a no-progress bound, or add FIFO tickets. Record the 6.5 s per push measured on 2026-10-28.
7. Answer Open Points 2 and 3 as in (d). Add the three new questions.
8. Name the tests in (e). Set the regression size above `DEFAULT_ATTEMPTS`, and include the deterministic "fetch runs under the lock" assertion.
