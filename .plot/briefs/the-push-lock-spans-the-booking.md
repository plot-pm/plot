## Implementation brief — bug/the-push-lock-spans-the-booking

- **Plan (canonical):** docs/plans/2026-10-28-parallel-release-calls-exhaust-their-push.md on main
- **Approved:** 2026-10-28, Jan Wloka, plan-PR #2816 merged
- **Branch:** `bug/the-push-lock-spans-the-booking` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (PR review)

This is slice 2 of a five-slice plan; it is the one that actually closes the
race the plan was opened for. Slices 1, 3 and 4 touch different files and are
not a prerequisite — if `bug/booking-branches-carry-no-upstream` (slice 1) has
not merged yet, build this slice on `main` as it stands; `--no-track` and the
lock span are independent fixes to two different collisions.

### What to build

On 2026-10-28, 53 back-to-back `POST /api/release` calls started 53 parallel
jobs, each of which commits a plan edit in its own booking worktree and pushes
to `main` through `commitAndPush` (`packages/board/src/server/entry/ladder.ts:152`).
24 jobs exhausted all 5 retry attempts with `non-fast-forward`; only 11 landed
on the first pass. The cause: the default-branch lock
(`skills/plot/scripts/plot-push-lock.mjs`, taken inside
`skills/plot/scripts/plot-push-main.sh:109`) covers only the `git push` call.
The booking fetch, reset and commit all happen *outside* the lock, both on the
first attempt (caller-side, before `commitAndPush` is even called) and on every
retry (`ladder.ts:196-211`, inside `commitAndPush` but still before the lock is
taken). So every queued writer fetches and commits against a base that goes
stale the instant any other writer's push lands — at most one writer can win
per retry round, and 5 rounds cannot clear 53 writers.

The fix: hold the lock from the fetch through the push, on every attempt
including the first, and release it only after the push outcome is known. All
seven `commitAndPush` call sites inherit the fix automatically because they
all go through this one function — no caller-side change is needed beyond
what the lock-holding changes below require of them.

### The decisions the plan settles — do not re-derive them

**The lock must wrap `commitAndPush` itself, not just be taken earlier by each caller.**
Six other call sites (`deliver.ts:499`, `approve.ts:1270`, `verify.ts:782`,
`needs-design.ts:471`, `brief-book.ts:179`, `record-pr.ts:129`) already fetch
and reset before calling `commitAndPush`, exactly like the release arm does.
Teaching each caller to take the lock separately would be six duplicated call
sites with six chances to get the ordering wrong. `commitAndPush` is the one
place all seven conversations pass through — this is why the fix lives there
and not in `deliver.ts`'s release arm alone, even though that is the arm that
failed in production.

**`plot-push-main.sh` must accept a lock its caller already holds, rather than
taking a second one.** Today `plot-push-main.sh:109` always calls
`plot-push-lock.mjs take "$$" "push $branch"` itself. Once `commitAndPush`
takes the lock before the fetch, the script it calls (via
`ctx.scripts.awaited('plot-push-main.sh', ...)`, `ladder.ts:176`) would try to
take the *same* lock again and deadlock against its own caller. The plan's
answer: the caller names the holder it already has (e.g. an environment
variable `plot-push-lock.mjs take` honours), so the nested take recognises its
own pid as the holder and returns immediately rather than waiting on itself
and exiting 6. `plot-dispatch.sh` and `plot-reconcile-scan.sh` are unaffected —
they keep taking the lock at the script level exactly as they do today; this
change only has to make the *nested* case (ladder → push-main, same process)
safe.

**Exit 6 (`locked`) must stop spending a retry attempt and must not re-cut the
branch.** `ladder.ts:188` today treats exit 3 and 4 as unretryable refusals,
but falls through to the ordinary retry path (fetch, reset, reapply, wait) for
every other non-zero code, exit 6 included. Once the lock is held for the
whole operation, a nested `plot-push-lock.mjs take` against the parent's own
held lock should never actually return 6 in practice — but the plan is
explicit that exit 6 is a separate branch, not a fifth flavor of `rejected`:
it must not consume one of the 5 `DEFAULT_ATTEMPTS`, and it must not trigger a
fetch/reset/reapply cycle (the base did not move; nothing needs re-cutting).
Add the exit-6 branch to `commitAndPush`'s attempt loop alongside the existing
exit 3/4 branch (`ladder.ts:188-191`), but have it loop back to retake the
lock rather than `return { rejected: true }` or fall into the retry block.

**The 120 s `PLOT_PUSH_LOCK_WAIT` becomes a no-progress bound, not a total
wait.** Today `plot-push-lock.mjs:81` compares `Date.now() - started` against
the fixed wait from when `take()` was first called. Under the spanned lock, a
queue of 53 writers taking ~5–6.5 s each (measured from the 2026-10-28
reflog: 52 pushes between 07:07:55 and 07:13:35) needs roughly 265–340 s to
drain — longer than 120 s even though the queue is moving and nothing is
stuck. The fix: reset the wait clock whenever the lock's *holder* changes
(compare the owner file's pid/taken-at against the last-seen value on each
poll), so a moving queue never times out on total elapsed time, while a
holder that doesn't change for 120 s still does. This is a different
mechanism from the existing stale-holder rule (`staleMs`, default 600 s,
`plot-push-lock.mjs:70`) — that rule already exists and is unaffected; the
no-progress bound is new and sits in the `for (;;)` wait loop inside `take()`
(`plot-push-lock.mjs:61-88`).

**A waiting job must print one line naming the holder, and that is the whole
UI change.** `releaseStatus` (`release.ts:89`) reads a job's last log lines
to report `running` vs `failed`; a job that is simply waiting on another
writer's lock must keep reporting `running`, with a line such as
`step: waiting for the default-branch lock held by pid N (push <branch>)` so a
person reading the log understands why nothing has happened yet. No new status
value (e.g. `queued`) is introduced — the plan explicitly rejects that, since
`running` already covers "the job exists and has not failed."

**Fetch, reset and the commit itself must run only while the lock is held, on
every attempt — the first included.** This is the actual defect fix. Before
this change, `commitAndPush`'s per-attempt body (`ladder.ts:166-212`) runs the
staged-change check, the commit, and the push without ever taking a lock
directly (the lock lives one layer down, inside `plot-push-main.sh`, and only
covers the push line). After this change, the lock must be acquired before
`ctx.trees.hasStagedChanges`/`ctx.trees.commitAs` on attempt 1 and before
`ctx.trees.fetch`/`ctx.trees.resetBranch` on every retry, and released only
after `plot-push-main.sh` returns (success or failure). Where exactly to put
the acquire/release in `commitAndPush`'s loop, and how to express "lock already
held, pass it through to the script" as the environment variable
`plot-push-main.sh` reads — these are implementation choices the plan leaves
open; the Decisions section below is binding on behavior, not on exact code
shape.

**The release arm's tracker writes (GitHub/Jira issue closes) stay outside the
lock.** They run after `cleanup()` (`deliver.ts:898`), which already happens
after the push completes — this slice does not need to move anything here,
just avoid accidentally widening the lock to cover it. A slow `gh`/Jira call
must not block other writers waiting on the default-branch lock.

**A retry re-decides on the fresh base; no slug gets two release commits.**
`bookRelease`-style writers (and this ladder in general) already write nothing
where the record exists — unaffected by this change, but worth knowing so a
retry isn't mistaken for a double-write risk.

### Done when

The plan's `## Done when` is implicit in its Tests section (there is no
separate `## Done when` heading in this plan — read the **Tests** subsection
under **Design** as the specification):

- **Deterministic concurrency test** (`packages/board/test/unit/ladder.test.ts`):
  N=6 concurrent `commitAndPush` calls over one shared fake remote (a push
  lands only when the writer's base equals the tip), driven by a lockstep
  `retryWait` barrier and a FIFO fake lock, no real timers. Today 5 of 6 land;
  after this change 6 of 6 must land. The same test file must assert that
  `fetch` and `resetBranch` run *only* while the lock is held (this is the
  assertion that actually catches a fix that holds the lock around the push
  but still fetches/resets outside it — a naive "just lock the push harder"
  fix would pass the push-landing assertion but fail this one). It must also
  assert that exit 6 consumes no attempt and does not call `resetBranch`.
- **Real-repository test** (`packages/board/test/unit/ladder-real-repo.test.ts`):
  N=3, `attempts = 2`, `retryWait` stubbed to 0, run against real git and the
  real `plot-push-main.sh`, proving the lock is taken before the fetch and that
  all N commits land on `origin/main`. The test must wait for its child
  processes to exit before asserting (see the repo's own `board-tests-that-spawn-must-wait-for-exit`
  lesson — a spawned child outliving the assertion is a known failure mode
  here).
- **Shell contract test** (`test/reconcile/pushmain.test.mjs`): with a declared
  holder (the env var `plot-push-main.sh` is taught to read), the script pushes
  at once without waiting the bound; without a declared holder, the script
  still waits and eventually exits 6 as today. For `plot-push-lock.mjs take`:
  a wait outlives `PLOT_PUSH_LOCK_WAIT` while the holder keeps changing (no
  timeout), and the call exits 6 when one holder stays past the bound without
  changing.

Plus the repo's gates: build artifacts (none expected — this is `packages/board/src`
and `skills/plot/scripts` only, no bundle committed by hand; `pnpm build:board`
is for local testing only, never committed), a changeset (`'plot': patch` or
appropriate bump under `## Versioning` in CLAUDE.md — description first, `bumps:`
block last), and the shell-line ratchet: `scripts/check-shell-lines.sh` refuses
growth in `skills/`'s shell line count against the merge base. This slice
touches `plot-push-main.sh`, so if the env-var plumbing adds lines, pay for
them by removing shell elsewhere in the same change, or by writing the new
logic in `plot-push-lock.mjs` (already JS, uncounted) rather than in the `.sh`
file. The gate counts commands, not lines — joining statements with `;`/`&&`
is not a payment.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and
run what it prints: the tests naming a changed file, related tests and
typecheck for `packages/board`, and the gate tests plus `scripts/check-*.sh`.
The CI suites (`pnpm run test:e2e`, `test:contracts`, `test:board`, domain
coverage, `node --test test/reconcile/*.test.mjs`) run in CI on every PR —
do not run `test:e2e` locally (see CLAUDE.md's Testing section: it dispatches
real workers into sandbox repos and is CI's gate, not a local one).

### Bookkeeping

Open the PR through the controller once there is a real commit on the branch:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly — it takes the PR title from the last
commit subject and the controller route is what names it from the plan's wave
heading instead. When the PR is created, append `→ #<number>` to this branch's
line under `## Slices` → `### Default-branch lock` in the plan file (push the
first real commit as soon as it exists, so the claim is visible early).

### Scope guard

This branch owns:
- `packages/board/src/server/entry/ladder.ts` (the lock span, exit-6 handling)
- `skills/plot/scripts/plot-push-main.sh` (accept a held lock)
- `skills/plot/scripts/plot-push-lock.mjs` (no-progress wait bound)
- `packages/board/test/unit/ladder.test.ts`, `packages/board/test/unit/ladder-real-repo.test.ts`
- `test/reconcile/pushmain.test.mjs`

Other branches in this plan, not yet confirmed as claimed at dispatch time:
- `bug/booking-branches-carry-no-upstream` (slice 1) — `trees-git.ts` only
  (`addBranch`/`resetBranch` `--no-track`); no file overlap with this slice.
- `bug/one-release-job-per-plan` (slice 3) — `release.ts` only (per-job status,
  refuse a second concurrent call for one slug); no file overlap.
- `bug/shared-issue-reads-the-post-push-tree` (slice 4) — `deliver.ts`'s
  sibling-read logic (`siblingLinesOf`, lines 191-206/908); this slice does not
  touch `deliver.ts` at all, so no overlap, but re-check before merging in case
  either branch's actual diff grew beyond what the plan describes.
- `docs/release-step-5b-reads-each-outcome` (slice 5) — skill text only
  (`skills/plot-release/SKILL.md`); merges last, describes this slice's and
  slice 3's behavior.

If you find something the plan did not anticipate — in particular anything
about how `ctx.scripts.awaited` passes environment variables through to
`plot-push-main.sh`, since that's the mechanism the held-lock pass-through
depends on and it is not detailed in the plan — report it rather than
improvising outside scope.
