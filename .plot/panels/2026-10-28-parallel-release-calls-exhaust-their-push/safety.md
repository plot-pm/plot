# Juror verdict: safety

Position: amend

Evidence: Read the plan, issue #2804, `skills/plot/scripts/plot-push-main.sh`, `skills/plot/scripts/plot-push-lock.mjs`, `packages/board/src/server/release.ts`, `packages/board/src/server/entry/ladder.ts`, `packages/board/src/server/entry/deliver.ts` (release arm), `packages/domain/src/adapters/trees/trees-git.ts`, `skills/plot-release/SKILL.md` step 5b, `skills/plot-sprint/SKILL.md`, `plot-reconcile-scan.sh` section 6. Ran: (1) a 10-writer race through the real `plot-push-main.sh` against a local bare origin (scratch dir); (2) read the 53 live release logs and state files under `.worktrees/plot-release-*` on this machine, with their mtimes and `push=`/retry counts; (3) `git log origin/main` over the release window, counted per slug for duplicates.

## (a) Problem statement

1. **The cause is misnamed. The lock covers the push and not the read-modify-write.** `plot-push-main.sh:109` takes the lock immediately before the push (`:120-122`). The base is fetched and the commit cut earlier and outside the lock: `deliver.ts:835` fetches, `deliver.ts:840` cuts the booking branch from `origin/main`, `ladder.ts:173` commits, `ladder.ts:176` calls the push script. Every retry fetches, resets and reapplies (`ladder.ts:196-211`) outside the lock as well. **Ran:** 10 parallel writers, each with a commit cut from the same base, each pushed through `plot-push-main.sh` → 1 exit 0, 9 exit 1 `non-fast-forward`. The lock serialises the pushes, but each push is still stale. The plan's line "the lock fixed 4 writers and not 53" is not supported: at 10 writers the lock let 1 in 10 land on the first round. The real limit is "about one writer lands per retry round", and 5 rounds cannot drain 53.
2. **The numbers do not add up, and the evidence is gone.** 24 failed + 11 released = 35 of 53, so 18 jobs are not explained. The first-pass logs cannot be re-checked: every POST truncates the slug's log and deletes its state (`release.ts:166-167`), so the re-runs overwrote them. What is on disk now: 53 logs dated 07:08–07:13, 46 `push=bypassed` with 0–4 retries, 7 `push=nothing-to-commit`. `origin/main` holds 51 `plot: release … (v2.29.0)` commits between 07:07:50 and 07:13 +0100, and every slug appears exactly once. The plan should quote these numbers, or state that the 24/11 figures come from the operator's session and are not reproducible.
3. **`locked` (exit 6) spends a retry.** `ladder.ts:188` treats only 3 and 4 as final. Exit 6 falls through to the retry path (`:193-211`), so a writer that waited 120 s for the lock loses an attempt and then refetches anyway.
4. Confirmed: step 5b (`skills/plot-release/SKILL.md:430-ff`) says "for each plan … call" and says nothing about waiting or about `GET /api/release/<slug>`.

## (b) Approach — can the fix lose or duplicate a Released record?

**Duplication through git cannot happen today, and every candidate must keep it that way.** The push is fast-forward only. A retry re-decides the release on the reset tree (`deliver.ts:855-862`), and `bookRelease` writes nothing where `alreadyRecorded` holds (`deliver.ts:730`, `transitions/plan.ts:951`). Result: `nothing-to-commit`, exit 0. Observed: 7 jobs took exactly that path, and no slug has two release commits. A push that landed but reported a failure takes the same path on its retry, so it is safe. Candidate 3 (batch) must keep "re-decide each plan on the fresh base" per plan, or a batch commit cut from a stale base can overwrite a sibling writer's edit to the same plan.

**Loss modes the plan does not name:**

1. **Candidate 1 covers one entry point in one process.** Writers that a board queue does not see:
   - the no-board route `plot-deliver.mjs --release`, which step 5b names first;
   - a second board on another worktree of the same repository;
   - `/api/approve` (`approve.ts:1270`);
   - fleet bookings through the same ladder (`record-pr.ts:141`, `brief-book.ts:179`).

   On 2026-10-28, `plot: record PR #2730` and the `sprint:` commits landed on `main` at 08:01–08:02, inside the period of the re-runs. Sprint commits use a bare `git push` (`skills/plot-sprint/SKILL.md:728-731`) and never take the lock. Fixing the lock scope covers every writer that goes through `commitAndPush`, across processes and boards. A board queue does not.
2. **An in-memory queue loses jobs on a board restart, silently.** The route answers 202 and opens the log at POST time (`release.ts:167`). `releaseStatus` reports `running` for any slug whose log exists and whose state file does not (`release.ts:96-97`). If the board restarts with jobs still queued, those jobs never start and read `running` forever. This is a partial sweep that reports nothing. Board restarts are routine here: a bundle update needs one. The queue must either be persisted, or open the log only when a job starts and report a lost queued job as `failed`/`unknown`.
3. **Two POSTs for one slug already ran at the same time, and the log shows it.** `.worktrees/plot-release-a-desk-continuation-skips-its-run.log` holds a `nothing-to-commit` run, then a run of NUL bytes, then a second run's tail (`flipped … push=bypassed`). The second POST truncated the log while the first job was still writing at its offset. Both jobs ran the tracker write (`plan-state: 2475 written released` appears twice). The state file is last-writer-wins, so `releaseStatus` can report `done` for a job that is still running. The same pattern shows in 2 more logs (`an-agent-refused-every-write-ends`, `board-status-banner-offline-tickets-and`). Any queue must refuse or merge a POST for a slug that is already queued or running, and status must belong to a job, not to a slug.
4. **Stale local reads drop the issue close for a shared issue.** The release arm reads the plan phase from the main checkout (`deliver.ts:766`). It also reads the sibling plans for "close only when the last plan naming it releases" from the main checkout (`deliver.ts:191-206`, `:908`). A booking push does not update the main checkout. Take two plans in one sweep that name the same issue: each sees the other as `delivered`, so both skip the issue, and it stays open. Serialising the jobs does not fix this. Reading the siblings from the booking worktree after the push does: `tmpwt` holds `origin/main` with this plan's record, before `cleanup()` at `deliver.ts:898`. The same stale read explains the 7 re-runs of plans that `main` already held: their logs say `phase=delivered` even though the commit had landed.
5. **The 120 s wait does not drain the queue, and the lock has no FIFO** (`plot-push-lock.mjs:61-88`: `mkdir` plus a 250 ms poll). Even with the scope fixed, a writer at the back can starve.

Rules: a lock-scope fix stays in an adapter-side script and in `ladder.ts`, so it meets the layering rule. A board queue with a new `queued` state is a rendered state and must come from a domain property, not from `release.ts` alone.

## (c) Slices

The single slice mixes a cause with two independent defects. Proposed cut:

1. `bug/the-push-lock-covers-the-whole-booking`: hold the lock in `commitAndPush` from fetch through push, give `plot-push-main.sh` a mode that runs under a lock the caller already holds, and treat exit 6 as "wait and retry without spending an attempt". This fixes approve, deliver, release, PR records and brief bookings together. Ship it first.
2. `bug/release-refuses-a-second-call-per-slug`: `POST /api/release` refuses (409) a slug whose job is running or queued, does not truncate a live log, and keys its status per job. This is board work; a queue, if one is still wanted after slice 1, goes here with persisted or start-time logs.
3. `bug/release-reads-siblings-from-the-booking-tree` (or a separate plan): the shared-issue rule reads the siblings from the post-push tree. Independent of the others, and small enough to ship first.

The step 5b edit (poll `GET /api/release/<slug>`, quote the per-slug `summary:` line) goes with slice 2.

## (d) Open questions

- **Which candidate?** None of the four. Fix the lock scope (missing from the list), which removes the cause for every lock-respecting writer. Add per-slug deduplication in the board. Candidate 2 alone hides the cause. Candidate 3 changes the one-call-per-plan contract and the per-plan tracker write. Candidate 4 is a rule.
- **`queued` state?** Yes, if a queue exists: without one, `release.ts:96-97` reports `running` for a job that has not started, and a board restart freezes it there.
- **Same queue for `/api/approve`?** It shares the defect (`approve.ts:1270`, the 2026-10-07 measurement at `plot-push-lock.mjs:11-14`). The lock-scope fix covers it with no second queue.
- **Is 120 s enough?** No. Measured: the serial tail of the re-run landed 14 releases from 07:12:33 to 07:13:42, about 5 s each. 120 s covers about 24 queued writers, and 53 need about 265 s. Make the bound depend on the queue length, or let the board bound its own queue to one writer.
- **New questions:**
  - Does the 5b gate (`plot-reconcile-scan.sh` section 6, from `:3403`) read the plan state from the main checkout? If so, it reports success writes as `unreleased_delivered` until a pull, and that invites duplicate runs and duplicate tracker writes.
  - Should sprint commits (`plot-sprint` step 5) go through `plot-push-main.sh`?
  - What happens to a queued job when the board stops?

## (e) Tests

- Slice 1, contract tier (`test/reconcile`): N=10 writers cut from one base push through the ladder or `plot-push-main.sh` against a local bare origin, and all 10 land. The scratch race above is the template, and it fails today with 9 of 10 rejected. Board unit test for `ladder.ts`: with fake `Trees`/`Scripts`, the lock is taken before `fetch` and released after the push, and an exit 6 does not use up an attempt.
- Slice 2, board unit test (`release.ts`): a second POST for a running slug answers 409 and leaves the first log untouched. A queued job whose process is gone reads `failed`/`unknown`, never `running`. Add a browser test only if a `queued` badge is rendered.
- Slice 3, board unit test (`deliver.ts` release arm with fixture ports): two plans name one issue, both are released in sequence, the main checkout is not updated, and the second release closes the issue.
- Regression for the plan's own goal: a sweep of N > 5 calls with `retryWait` stubbed records N plans, one commit per slug, and no slug twice.

## Amendments

1. Restate the cause: the lock covers the push and not fetch→reapply→commit→push (`plot-push-main.sh:109`, `ladder.ts:166-211`). Add "widen the lock to the whole booking" as candidate 0 and recommend it.
2. Correct the numbers (35 of 53 accounted for) or cite where they come from. Record that the first-pass logs were overwritten by the re-run (`release.ts:166-167`).
3. Add per-slug deduplication for `POST /api/release`. Cite the NUL-padded log as the evidence that two jobs ran for one slug.
4. If a board queue stays, require it to survive or report a board restart, and add `queued` as a domain-derived state.
5. Name the writers outside the board: no-board CLI, a second board, approve, fleet bookings, sprint `git push`. State which of them the fix covers.
6. Add the stale sibling read (`deliver.ts:908`) as its own slice or bug.
7. Answer open point 4 with the measured figure of about 5 s per write: 120 s covers about 24 writers.
8. Keep "re-decide on the fresh base" as an invariant any candidate must preserve, and add a test that no slug gets two release commits.
