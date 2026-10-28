# Panel moderation: parallel-release-calls-exhaust-their-push, round 1

**Reconciliation:** unanimous `amend` (mechanism, operator, safety, testability). Every verdict passed `plot-panel.mjs check` on the first send.

## What each juror looked at

| Juror | Ran |
|---|---|
| mechanism | 20 parallel writers through the real `plot-push-main.sh` and `plot-push-lock.mjs` against a local bare repo, with the adapter's exact git arguments, current lock versus lock from fetch to push |
| operator | 20 parallel writers through the real scripts; a grep of every release log for `push: locked` |
| safety | 10 parallel writers through the real `plot-push-main.sh`; a read of the release logs and status files |
| testability | the real `ladder.ts` under Node 24 with N writers on a fake remote, lockstep and timed; 40 concurrent `worktree add -B` and 19 `checkout -B` in a scratch repo |

All four executed, and four independent simulations agree.

## Where the jurors agree

1. **The plan names the wrong cause.** The lock covers only `git push` (`plot-push-main.sh:109`); the fetch, cut, reapply and commit run before it (`deliver.ts:835-847`, `ladder.ts:166-211`). Each landed push makes every queued writer's base stale. Current shape: 4 of 20 fail (mechanism, operator), 9 of 10 fail (safety), 5 of 53 land (testability, lockstep). Lock from fetch through push: 20 of 20, 53 of 53 land. More retries (candidate 2) treat the symptom.
2. **The fix belongs in `commitAndPush`, not in a board queue.** The ladder serves seven controllers (release, deliver, approve, verify, needs-design, brief-book, record-pr) across board, fleetd and the no-board bundles. A queue in `/api/release` (candidate 1) covers one entrance, loses jobs on a board restart, and leaves `releaseStatus` reading `running` forever.
3. **Two follow-on changes come with the wider lock:** `plot-push-main.sh` must accept a lock its caller holds, or the nested take waits 120 s and exits 6; and exit 6 must not spend an attempt. One hold lasts about 5–6.5 s, so 53 writers exceed a fixed 120 s; make it a no-progress bound.
4. **A second cause: the `.git/config` lock.** `trees-git.ts:457,464` create booking branches from `origin/main`, which writes upstream config; concurrent runs fail with `could not lock config file` (14 of 20, 21 of 40, 13 of 19). `--no-track` removes it (39 of 40). It surfaces as "could not prepare a booking worktree" and is the likely home of the 18 of 53 jobs the plan does not account for; the re-run truncated the first-pass logs, so this is unproven.

## Added by single jurors

- safety: a second call for a plan already running truncates its log and runs the tracker write twice (three logs hold NUL bytes; `plan-state: 2475 written` twice). Refuse a second call per plan; keep status per job.
- safety: the "close a shared issue only on the last release" rule reads the other plans from the main checkout (`deliver.ts:191-206,908`), which a release push does not update; two plans naming one issue each see the other as Delivered and the issue stays open. Serialising does not fix it.
- operator: step 5b's fix is "read each slug's outcome" (`GET /api/release/<slug>`) and print one line per failed plan; `SKILL.md:451` falsely says a board button calls the route.
- testability: a deterministic test belongs in `ladder.test.ts` (N=6, lockstep barrier, no timers: 5 of 6 today, 6 of 6 after), plus one small real-repo case.

## Shared blind spot

All four measured the ladder with release-shaped writers. None measured mixed writers at once (a release sweep while fleet bookings and `sprint:` commits push), and the `sprint:` commits use a bare `git push` that never takes the lock (safety). The wider lock helps only writers that take it.

## Amendments the panel asks for

- Replace the cause with the stale-base race and the config-lock collision; drop candidates 1 and 2.
- Slices: `--no-track` on booking branches; the lock spans fetch through push in `commitAndPush`, with a held-lock pass-through, exit 6 free of attempts and a no-progress bound; one call per plan with per-job status; read other plans from the post-push tree; step 5b reads each outcome.
- Tests: the deterministic ladder test, a small real-repo case, and a `trees-git` concurrency test.
- File the truncated release log as a follow-up.
