# Parallel release calls exhaust their push retries

> 53 back-to-back `POST /api/release` calls started 53 parallel jobs that all push to `main`, and most of them failed. The push lock covers only `git push`, so every queued writer pushes a stale base, and parallel booking worktrees collide on `.git/config`. The plan makes the default-branch lock span the whole booking, so a release sweep over N plans records all N plans.

## Status

- **State:** Approved
- **Type:** bug
- **Story:**
- **Sprint:** follow-ups-2-29-1
- **Issue:** #2804
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2816 merged
- **Started:** 2026-10-28, Jan Wloka, `bug/booking-branches-carry-no-upstream`
- **Started:** 2026-10-28, Jan Wloka, `bug/the-push-lock-spans-the-booking`

## Changelog

- A release sweep over N plans marks all N plans `Released`, whatever the order or timing of the calls.
- Parallel approve, deliver, release, verify, needs-design, brief and PR-record writes to the default branch take turns and land on their first attempt, from the board, from fleetd and from the no-board bundles.
- Parallel booking worktrees no longer fail with `could not lock config file .git/config`.
- A second release call for a plan that is already running or queued is refused by name, and the first call's log stays whole.
- When two plans in one release sweep name the same issue, the last plan to release closes the issue.
- `/plot-release` prints one line per plan that did not release, with the reason from that plan's job.

<!-- Board impact: yes. Changes `commitAndPush` in packages/board/src/server/entry/ladder.ts, the release route and its status in packages/board/src/server/release.ts, the release arm's sibling read in packages/board/src/server/entry/deliver.ts, and `addBranch`/`resetBranch` in packages/domain/src/adapters/trees/trees-git.ts. The plan format, template and docs/plans layout do not change. `plot-push-main.sh` and `plot-push-lock.mjs` change. A board artifact rebuild follows on main. -->

## Motivation

On 2026-10-28 the v2.29.0 release record ran as 53 `POST /api/release` calls sent back to back (#2804). The board starts one background job per call, so the jobs ran in parallel, and each job pushes its plan record to `main`. The operator's session reported 24 jobs that stopped after attempt 5 of 5 with `non-fast-forward` and 11 plans at `State: Released` after the first pass. That leaves 18 of 53 jobs unaccounted for. The first-pass logs cannot answer for them: each POST removes the slug's state file and opens its log with `'w'` (`packages/board/src/server/release.ts:166-167`), so the one-at-a-time re-run overwrote every first-pass log. Re-running the remaining plans one at a time released all of them; `origin/main` holds one release commit per slug.

Panel round 1 (four jurors, each executing a simulation against a local bare repository) found two causes.

**1. The lock covers the push and not the base.** `plot-push-main.sh:109` takes the lock, and only the `git push` runs inside it. The base is read earlier and outside the lock: the release arm fetches at `deliver.ts:835` and cuts the booking branch from `origin/main` at `deliver.ts:840`, and `commitAndPush` commits at `ladder.ts:173` before it calls the push script at `ladder.ts:176`. Each retry fetches, resets and reapplies outside the lock as well (`ladder.ts:196-211`). So every waiter holds a base that is older than every push made while it waited, and the first push that lands makes every queued base stale. At most one writer lands per retry round, and `DEFAULT_ATTEMPTS` is 5 (`ladder.ts:27`). The comment at `plot-push-main.sh:35-37` ("the base is still current") is false for the same reason.

- With the real `ladder.ts` in a lockstep schedule: N=6 lands 5, N=53 lands 5 (testability).
- 20 writers through the real `plot-push-main.sh` and `plot-push-lock.mjs`: 4 of 20 exhausted 5 attempts (mechanism, operator); 10 writers cut from one base: 9 of 10 rejected on the first round (safety).
- The same writers with the lock held from fetch through push: 20 of 20 and 53 of 53 land, with 0 rejections.
- `grep "push: locked"` over every `plot-*.log` on the desk root returns 0 lines, so no job reached the 120 s lock bound. Every surviving rejection is `non-fast-forward`.
- The 2026-10-07 measurement (`plot-push-lock.mjs:11-14`) fits this bound: 4 writers land within 5 attempts, and 53 do not.

**2. Parallel booking worktrees collide on `.git/config`.** `addBranch` runs `git worktree add -q -B <branch> <path> origin/main` (`trees-git.ts:457`), and `resetBranch` runs `git checkout -q -f -B <branch> origin/main` (`trees-git.ts:464`). With a remote-tracking start point, both write upstream config into `.git/config`, and concurrent runs fail with `error: could not lock config file .git/config: File exists`. Measured: 14 of 20 (mechanism), 21 of 40 `worktree add` and 13 of 19 `checkout -B` (testability). With `--no-track`, 39 of 40 succeed; the remaining failure is git's own concurrent `worktree add` race. In the release arm the failure surfaces as "could not prepare a booking worktree" (`deliver.ts:841-843`), and on a retry as "retry stopped — could not reset" (`ladder.ts:202-204`); neither message says `non-fast-forward`. This is the likely home of the 18 unaccounted jobs, and the truncated logs leave it unproven.

**Three defects next to the race.**

- A second POST for one slug runs a second job beside the first. Three surviving logs hold NUL bytes where the second call truncated the log under the first, and one shows `plan-state: 2475 written` twice, so the tracker write ran twice. The state file is last-writer-wins, so `releaseStatus` (`release.ts:89`) can report `done` while a job still runs.
- The rule "close a shared issue only when the last plan naming it releases" reads the sibling plans from the main checkout (`siblingLinesOf`, `deliver.ts:191-206`, called at `deliver.ts:908`). A booking push does not update the main checkout. Two plans in one sweep that name one issue each read the other as Delivered, both skip the close, and the issue stays open. Serialising the writers does not fix this.
- `/plot-release` step 5b sends one call per plan and then gates on a count (`skills/plot-release/SKILL.md:440-451`). It never reads `GET /api/release/<slug>` (`packages/board/src/server/index.ts:766`), which returns `failed` and the job's last log lines, so the cutter learns how many plans failed and not why. `SKILL.md:450-451` says the POST route is "the route the board's own button calls"; no board UI calls it.

## Design

### Approach

**Slice 1 — booking branches carry no upstream.** `addBranch` and `resetBranch` (`trees-git.ts:457,464`) pass `--no-track`. A booking branch is pushed as `<branch>:<default>` and never needs an upstream, so no booking writes `.git/config`. This change is independent of the lock and removes the collision even for writers that never meet the lock.

**Slice 2 — the default-branch lock spans the booking.** `commitAndPush` takes the default-branch lock before it reads the base and holds it through fetch, reset, reapply, commit and push on every attempt, including the first, then releases it after the push outcome. All seven callers inherit the fix: `deliver.ts:499` (deliver), `deliver.ts:866` (release), `approve.ts:1270`, `verify.ts:782`, `needs-design.ts:471`, `brief-book.ts:179` and `record-pr.ts:129`. The lock lives in the common git dir, so the board, fleetd and the no-board bundles take turns with each other.

- `plot-push-main.sh` accepts a lock its caller already holds (the caller names the holder pid, for example in an environment variable that `plot-push-lock.mjs take` honours), so the nested take does not wait on its own lock and exit 6. `plot-dispatch.sh` and `plot-reconcile-scan.sh` keep the script-level take.
- Exit 6 (`locked`) does not spend an attempt and does not re-cut the branch. Today `ladder.ts:188` stops only on 3 and 4, and exit 6 falls through to the retry path.
- The fixed 120 s `PLOT_PUSH_LOCK_WAIT` (`plot-push-lock.mjs:57`) becomes a no-progress bound: the wait restarts whenever the lock's holder changes, so a moving queue never times out and a hung holder still does. One hold lasts about 5–6.5 s (the reflog shows 52 release pushes between 07:07:55 and 07:13:35), so 53 writers need about 265–340 s. The stale-holder rule (600 s, `plot-push-lock.mjs:21-26`) still covers a hung holder.
- A waiting job prints one line naming the holder (for example `step: waiting for the default-branch lock held by pid N (<action>)`), so `releaseStatus` reads `running` and the log's last lines say why. No `queued` state is needed.
- The release arm's tracker writes stay outside the lock: they run after `cleanup()` (`deliver.ts:898`), so a slow `gh` or Jira call blocks no other writer.
- A retry still re-decides the plan on the fresh base, and `bookRelease` writes nothing where the record already exists, so no slug gets two release commits.

**Slice 3 — one release job per plan.** `POST /api/release` refuses a slug whose job is running or queued, naming the running job and its log, and leaves that log untouched. Status belongs to a job, not to a slug, so a second call never truncates the first job's log and `releaseStatus` never reports another job's exit code.

**Slice 4 — the shared-issue rule reads the post-push tree.** The release arm reads the sibling plans from the booking worktree after the push, before `cleanup()` removes it, rather than from the main checkout. `tmpwt` then holds `origin/main` with this plan's record and every record that landed before it.

**Slice 5 — step 5b reads each outcome.** After the calls, `/plot-release` step 5b reads `GET /api/release/<slug>` per slug (or the bundle's exit code and `summary:` line on the no-board path) and prints one line per plan that did not release, with its message. It states that back-to-back calls are safe. It drops the claim at `SKILL.md:450-451` that a board button calls the route.

**Dropped candidates.**

- A queue in the board (`/api/release` serialises its own jobs) covers one entrance in one process. It leaves the no-board `plot-deliver.mjs --release`, approve, fleetd's PR records and brief bookings racing the queue, loses queued jobs on a board restart, and leaves `releaseStatus` reading `running` for a queued job that never started (`release.ts:96-97`).
- More retries keep the race and scale with the queue: N writers need N attempts.
- Batching several plans into one push changes the one-call-per-plan controller contract and reaches none of the other six callers.

### Decisions

Decided 2026-10-28 by Jan Wloka after panel round 1 (`.plot/panels/2026-10-28-parallel-release-calls-exhaust-their-push/panel.md`):

- [x] Ship all five slices, in this order: `--no-track`, the lock span, one job per plan, the post-push sibling read, step 5b.
- [x] Booking branches are created with `--no-track` (`trees-git.ts:457,464`), which removes the `.git/config` lock collision.
- [x] The default-branch lock spans fetch through push inside `commitAndPush` (`ladder.ts`) and covers all seven ladder callers. `plot-push-main.sh` accepts a lock its caller holds; exit 6 does not spend an attempt; the fixed 120 s wait becomes a no-progress bound.
- [x] Drop candidate 1 (board queue) and candidate 2 (more retries), for the reasons under *Dropped candidates*. Candidate 3 (batch push) is dropped with them.
- [x] A waiting job keeps the existing `releaseStatus` states (`unknown`, `running`, `done`, `failed`); no `queued` state.
- [x] The fix covers `POST /api/approve`: `approve.ts:1270` calls the same `commitAndPush`.
- [x] A second release call for a plan already running or queued is refused; status is kept per job.
- [x] The shared-issue close reads the other plans from the post-push tree (`deliver.ts:191-206,908`).
- [x] Step 5b reads each slug's outcome and prints one line per failed plan; the false `SKILL.md:451` claim goes.

### Tests

- **Slice 1:** a `trees-git` adapter case against a scratch repository: `addBranch` and `resetBranch` from `origin/main` leave no `branch.<name>.merge` key in `.git/config` (deterministic, fails today). One concurrency case runs 10 `addBranch` calls at once and gets 10 worktrees.
- **Slice 2, deterministic:** in `packages/board/test/unit/ladder.test.ts`, N=6 concurrent `commitAndPush` calls over one shared fake remote (a push lands only when the writer's base equals the tip) with a lockstep `retryWait` barrier and a FIFO fake lock, no timers. Today 5 of 6 land; after the change 6 of 6 land. The same file asserts that `fetch` and `resetBranch` run only while the lock is held, and that exit 6 consumes no attempt and does not call `resetBranch`.
- **Slice 2, real repository:** one small case in `packages/board/test/unit/ladder-real-repo.test.ts` (N=3, `attempts = 2`, `retryWait` stubbed to 0) proves against real git and the real `plot-push-main.sh` that the lock is taken before the fetch and that all N files reach `origin/main`. The test waits for its children to exit.
- **Slice 2, contract:** in `test/reconcile/pushmain.test.mjs`, `plot-push-main.sh` with a declared holder that holds the lock pushes at once and does not wait the bound; without it, the script still waits and exits 6. For `plot-push-lock.mjs take`: a wait outlives `PLOT_PUSH_LOCK_WAIT` while the holder changes, and exits 6 when one holder stays past the bound.
- **Slice 3:** a board unit test on the release route: a second POST for a running slug is refused and leaves the first log untouched; status for one job never reports another job's exit code.
- **Slice 4:** a board unit test on the release arm with fixture ports: two plans name one issue, both release in sequence while the main checkout does not move, and the second release closes the issue.
- **Slice 5:** skill text; checked in the manual lifecycle walkthrough with at least 5 plans.
- No browser test and no 53-call HTTP test: no rendered state changes, and the defect sits below the endpoint.

### Open Questions

- [ ] Mixed writers are unmeasured. All four jurors measured release-shaped writers only. A release sweep while fleet bookings and `sprint:` commits push at once is not measured, and `sprint:` commits use a bare `git push` (`skills/plot-sprint/SKILL.md:731`, and its other `git push` blocks) that never takes the lock. The wider lock helps only writers that take it. Should `sprint:` commits push through `plot-push-main.sh`?
- [ ] Does the step 5b gate (`plot-reconcile-scan.sh` section 6) read plan state from the main checkout, and so report a freshly released plan as `unreleased_delivered` until a pull?

## Slices

### Booking branches

- `bug/booking-branches-carry-no-upstream` — `addBranch` and `resetBranch` pass `--no-track`; a `trees-git` test asserts no upstream key and 10 parallel worktrees <!-- builds: --no-track in trees-git.ts addBranch and resetBranch --> → #2838

### Default-branch lock

- `bug/the-push-lock-spans-the-booking` — `commitAndPush` holds the default-branch lock from fetch through push; `plot-push-main.sh` accepts a held lock; exit 6 spends no attempt; the wait bound measures progress <!-- builds: lock span in ladder.ts, held-lock pass-through in plot-push-main.sh and plot-push-lock.mjs, no-progress bound --> → #2860

### Release jobs

- `bug/one-release-job-per-plan` — `POST /api/release` refuses a slug already running or queued; status is kept per job, so a log is never truncated by a second call

### Shared issues

- `bug/shared-issue-reads-the-post-push-tree` — the release arm reads sibling plans from the booking worktree after the push, so the last plan to release closes a shared issue

### Release outcomes

- `docs/release-step-5b-reads-each-outcome` — step 5b reads `GET /api/release/<slug>` per plan and prints one line per failed plan; the false board-button claim goes

## Notes

- Created from tracker issue #2804. The plan names it in `Issue:` and writes nothing to the tracker.
- Follow-up: the per-call log truncation (`release.ts:166-167`) destroyed the first-pass evidence for the 18 unaccounted jobs. Slice 3 keeps a running job's log whole; whether a finished job's log survives a later call for the same slug is a separate follow-up issue to file.
- Earlier work in the same area: #1349 and `2026-10-17-delivery-reads-the-delivered-plan-and` (slice `bug/default-branch-writes-take-turns`, #2039), which added the push lock.
- Slices 1, 3 and 4 touch separate files and can merge in any order; slice 1 first removes the config-lock failures with the smallest change. Slice 5 describes the behaviour of slices 2 and 3 and merges last.
