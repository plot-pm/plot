# Juror verdict: testability

Position: amend

Evidence: Read the plan, issue #2804 (`gh issue view`), `skills/plot/scripts/plot-push-main.sh`, `skills/plot/scripts/plot-push-lock.mjs`, `packages/board/src/server/release.ts`, `packages/board/src/server/entry/ladder.ts`, the release and deliver paths in `packages/board/src/server/entry/deliver.ts`, `packages/domain/src/adapters/trees/trees-git.ts:454-466`, `packages/board/test/unit/ladder.test.ts`, `ladder-real-repo.test.ts` (headings), and `skills/plot-release/SKILL.md:52,430-451`. Ran three things: (1) the REAL `ladder.ts` (copied unchanged, run under Node 24 type stripping) driven by N concurrent writers against a fake remote, in a deterministic lockstep schedule and in a timed schedule, with the lock scoped to the push (today) and to the whole attempt; (2) 40 concurrent `git worktree add -q -B <b> <path> origin/main` and 40 concurrent `git checkout -q -f -B <b> origin/main` in a scratch repo (the two commands `trees-git.ts:457,464` run), with and without `--no-track`; (3) a read of the 130 `plot-release-*.log/.state` files under `.worktrees/`. Scratch files are in `/private/tmp/claude-501/-Users-jwloka-Quatico-Agentic-Tools-plot/ca0ab00d-98d3-4ca8-8a1b-8a43a4eda657/scratchpad/juror-2804-testability/` (`sim.ts`, `git/`).

## (a) Problem statement

- **The cause is misnamed.** The plan says "the lock serialises the push, and 5 retries do not cover a queue of about 50 writers". The lock is the cause, not a partial fix: `plot-push-main.sh:109` takes the lock after the caller has already fetched, reset and committed (`ladder.ts:167-176`, `196-207`). A writer that waits in the lock queue behind k writers holds a base that is stale as soon as one of them lands. So per fetch generation, at most one queued writer can land, and the rest are rejected `non-fast-forward` with certainty. The lock turns a race into a guaranteed loss for everyone but the queue head.
- **Measured with the real ladder** (`sim.ts`, push-scoped lock, 5 attempts): lockstep N=4 → 4 landed; N=6 → 5 landed; N=53 → **5 landed, 48 rejected**; N=53 with 53 attempts → 53 landed. Timed schedule (push holds the lock 3 units, waits 2-10 units), N=53: 6 landed, 47 rejected, in 3 of 3 runs. The bound is `landed ≤ attempts` for any lockstep schedule. That is why "the lock fixed 4 writers and not 53": 4 ≤ 5.
- **A second cause is missing.** Concurrent booking worktrees race on `.git/config`. `addBranch` runs `git worktree add -q -B <branch> <path> origin/<main>` (`trees-git.ts:457`), and `resetBranch` runs `git checkout -q -f -B <branch> origin/<main>` (`trees-git.ts:464`). Both start from a remote-tracking ref, so git writes upstream config and takes `.git/config.lock`. Ran 40 concurrently: `worktree add` failed **21 of 40** and `checkout -B` failed **13 of 19**, each with `error: could not lock config file .git/config: File exists`. In the release path a failed `addBranch` refuses before any push ("could not prepare a booking worktree", `deliver.ts` runRelease), and a failed `resetBranch` stops the retry (`ladder.ts:201-205`). With `--no-track` the same runs gave 39 of 40 and 39 of 40 (the one residual failure each is git's own `worktree add` race, `commondir: Result too large`).
- **The arithmetic does not close.** 11 released + 24 exhausted = 35 of 53. The plan does not say what happened to the other 18 jobs. The config-lock race is a candidate cause, but I cannot confirm it from the logs: `release.ts:164-167` truncates the per-slug log on each call, so the one-at-a-time re-run overwrote every first-pass log. All 130 `plot-release-*.state` files read `0` today.
- Cited facts that hold: `releaseStatus` exists (`release.ts:89-112`) with states `unknown|running|done|failed` (`release.ts:65`); the route answers 202 before the job ends (`release.ts:196-201`); `PLOT_PUSH_LOCK_WAIT` defaults to 120 s (`plot-push-lock.mjs:57`); 5 attempts is `DEFAULT_ATTEMPTS` (`ladder.ts:27`); step 5b says one call per plan and nothing about waiting (`SKILL.md:52,451`).

## (b) Approach

- **Candidate 1 fixes the symptom at one caller.** `commitAndPush` is shared by `approve.ts`, `deliver.ts`, `verify.ts`, `needs-design.ts`, `brief-book.ts` and `record-pr.ts` (grep for `commitAndPush`). A queue in `release.ts` covers only `/api/release` calls through one board process. It does not cover a concurrent `/api/approve` batch (the 2026-10-07 measurement in `plot-push-lock.mjs:11-14`), a `plot-deliver.mjs --release` run from a shell, or fleetd booking writes running at the same time.
- **The cause-level fix is to widen the lock to the whole attempt**: take it before the fetch and hold it through the push, in `commitAndPush`. Measured with the real ladder: lockstep N=53, 5 attempts → 53 landed; timed N=53 → 53 landed. Every writer then lands on its first attempt after it gets the lock. Two consequences the plan must carry:
  - Re-entrancy: `plot-push-main.sh:109` takes the lock itself with `$$`. A ladder that already holds it would wait on itself for 120 s and get exit 6. The script needs a way to know the caller holds the lock (for example a holder pid passed in the environment).
  - Wait bound: with the lock over fetch→commit→push, writer k waits about k × (fetch + commit + push). At 3-5 s per attempt against GitHub, writer 53 waits 150-260 s, past the 120 s bound. Exit 6 then reaches `commitAndPush` as a plain rejection (`ladder.ts:180-193` treats every code except 0, 3, 4 as a rejection), so it spends an attempt. Either exit 6 must not spend an attempt, or the bound must scale.
- **Add `--no-track`** to `trees-git.ts:457` and `:464`. The booking branch is disposable and never needs an upstream; this removes the config-lock failures with no behaviour change.
- Candidate 2 (more retries) only works if attempts ≥ N (measured: 53 attempts land 53), so it scales with the queue, as the plan says. Candidate 3 changes the controller contract. Candidate 4 is a rule. None of the three is needed once the lock scope is right.
- Layering: the lock is a process-level resource, so taking it from `ladder.ts` belongs behind a port (the `scripts` port already starts `plot-push-main.sh`; a `plot-push-lock.mjs take/release` call through the same port adds no new spawn site).

## (c) Slices

- Cut it as two slices on two branches, both independently mergeable, in this order:
  1. `bug/booking-branches-race-on-git-config` — `--no-track` on `addBranch` and `resetBranch`. Small, no contract change, and it removes failures the push fix cannot touch. Ship it first.
  2. `bug/parallel-release-calls-exhaust-their-push` — the lock spans the whole attempt in `commitAndPush`, with re-entrancy in `plot-push-main.sh` and an exit-6 rule that does not spend an attempt.
- The step 5b edit (candidate 4) then needs no queue wording. If kept, it belongs in slice 2 and says the endpoint is safe to call back to back.
- Move the "log is truncated per call" defect (`release.ts:164-167`) to its own follow-up issue or name it in the plan: it destroyed the evidence for the 18 unaccounted jobs.

## (d) Open questions

- *Which candidate?* None of the four as written; widen the lock scope (see (b)). It covers approve, deliver and release through the one shared ladder.
- *Does a queued job need a `queued` state?* Not with the ladder-level fix: the job runs and waits on the lock, and `releaseStatus` keeps reading `running` (`release.ts:96-97`). With candidate 1 it would, because a job not yet started has no log and reads `unknown` (`release.ts:98`), which a card cannot tell apart from "never asked".
- *Should the queue cover `/api/approve`?* Yes, and the ladder-level fix covers it with no extra code, because `approve.ts` calls the same `commitAndPush`.
- *Is 120 s the right bound?* No for an attempt-scoped lock: about 53 × 3-5 s exceeds it (see (b)). Yes for today's push-scoped lock, but there it is irrelevant, because the loss happens on the stale base and not on the wait.
- New questions the plan should carry:
  - What happened to the 18 jobs that neither released nor logged 5 rejections? The config-lock race is the measured candidate.
  - Does exit 6 (`locked`) spend one of the 5 attempts? Today it does.
  - Is the wait bound per writer or per queue position?

## (e) Tests

- **Slice 2, the test that fails today and passes after, at the lowest tier:** a board unit test in `packages/board/test/unit/ladder.test.ts`. N = 6 concurrent `commitAndPush` calls (any N > `attempts`) over one shared fake remote (tip counter; a push lands only when the writer's base equals the tip; `fetch` reads the tip) and a lockstep `retryWait` barrier that releases the round only after every active writer has pushed. Expect 6 landed. Today it gives 5 landed and 1 rejected (`sim.ts`, run). The test is deterministic: there are no timers, the barrier fixes the interleaving, and the fake lock is a FIFO of promises. A 53-call test through real git, as the plan proposes, is not deterministic, needs a remote and is slow. Keep at most one real-repo case in `ladder-real-repo.test.ts`, with N = 3 and `attempts = 2`, to prove the lock is taken before the fetch against real git.
- Slice 2 also needs a contract test for `plot-push-main.sh` re-entrancy: with the caller's holder declared, the script does not wait on its own lock (a `test/reconcile` shell test, exit code and elapsed time under 1 s).
- **Slice 1:** a domain adapter test against a scratch repo: `addBranch` from `origin/main` leaves no `branch.<name>.merge` key in `.git/config`. That is deterministic and fails today. A concurrency test (40 parallel `addBranch` calls, all succeed) reproduces the failure (21 of 40 today) but is load-dependent, so keep it out of CI or treat it as evidence only.
- Candidate 1, if chosen anyway: a board unit test on `handleRelease` with a fake `scriptsFor().start` that records starts and holds `onExit`, asserting at most one start is outstanding after N POSTs. It is deterministic, but it proves only the board's ordering, not that N plans land.

## Amendments

1. Rename the cause: the push lock is taken after the fetch, so every queued writer pushes a stale base. Cite `plot-push-main.sh:109` against `ladder.ts:167-207`, and add the measured bound `landed ≤ attempts`.
2. Add the second cause: concurrent `-B ... origin/<main>` writes `.git/config` (`trees-git.ts:457,464`); 21 of 40 failed in a scratch repo. Fix it with `--no-track` in its own first slice.
3. Replace candidate 1 as the recommendation with "the lock spans fetch to push in `commitAndPush`". Name re-entrancy in `plot-push-main.sh` and an exit-6 rule that spends no attempt.
4. Account for the 18 jobs that neither released nor exhausted their retries, or state that the evidence is gone because `release.ts:164-167` truncates the log per call.
5. Replace "a test that sends 53 calls" with the deterministic lockstep unit test in `ladder.test.ts` (N > attempts, fails today 5/6), plus one small real-repo case.
6. Answer open point 3 as yes: the shared ladder covers `/api/approve` with no extra code. Answer open point 4 for the chosen lock scope.
