## Implementation brief — delivery-reads-the-delivered-plan-and (slice: Write queue)

- **Plan (canonical):** `docs/plans/2026-10-17-delivery-reads-the-delivered-plan-and.md` on `main`
- **Approved:** 2026-10-17, Jan Wloka, plan-PR #1971 merged
- **Branch:** `bug/default-branch-writes-take-turns` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** CI green, then squash-merge

Third of three independent fixes under #1838. The other two (`bug/deliver-ref-read-canonical-path`
→ #1989, `bug/scan-reads-plans-at-the-fetched-ref` → #2017) are already merged; this slice shares
no code with either — it is the only one of the three that touches `plot-push-main.sh`.

### What to build

#1349: `/api/release` and `/api/approve` start their scripts in the background and return
immediately, so several lifecycle writes to the default branch can start together. Measured
2026-10-07: a 4-plan `/api/release` batch ended 4 of 4 `push=rejected`; a 6-plan `/api/approve`
batch ended 3 `push=rejected`, 1 `bypassed`, 1 `micro-pr`, 1 refused. A sequential re-run of the
same batch landed all of them — the writes are individually correct, they just collide when run
concurrently.

Serialise default-branch lifecycle writes with a lock taken inside `plot-push-main.sh`
(`skills/plot/scripts/plot-push-main.sh`), so every caller is covered without each caller adding
its own lock. A second writer waits up to 120 s for the lock. A waiter whose wait exceeds the
bound refuses and names the lock holder's pid and the action it is running.

### The decisions the plan settles — do not re-derive them

**The lock lives in `plot-push-main.sh`, not in the board routes.** Decided 2026-10-17 by Jan
Wloka: a lock in the board's route handlers would leave the no-board `plot-deliver.mjs` call path
racing against the board, because that path never goes through a board route at all. Putting the
lock inside the one script every caller already runs through — `/plot-approve`'s
`plot-approve.sh`/`plot-approve.mjs`, `/plot-deliver`'s `plot-deliver.sh`/`plot-deliver.mjs`,
`/plot-release`, and the hub's phase-fix sequence — covers all of them with one lock rather than
one lock per caller that must each remember to take it.

**The wait bound is 120 s, and a waiter past it refuses by name.** Not a shorter bound (a real
push plus its retry can legitimately take some seconds under load) and not an unbounded wait (a
dead holder must not wedge every other lifecycle write forever). The refusal names the holder's
pid and the action it is running — mirroring `budget_lock_owner`'s owner line below — because a
bare "timed out" tells nobody what to do next.

**Use `mkdir` for the lock, never `flock`.** `plot-budget.sh:343` already states the reason and it
applies unchanged here: `flock` is not shipped on macOS, and this repo's workers and operators run
there. `mkdir <lockdir>` is atomic and fails exactly where the name is already taken, which is the
whole of the mutual exclusion needed. Follow `plot-budget.sh`'s existing shape:

```
skills/plot/scripts/plot-budget.sh:343   mkdir "$lock" 2>/dev/null || return 1
```

**Write an owner line into the lock directory, the way `budget_owner_line`/`budget_lock_owner`
do.** `plot-budget.sh:214` writes `pid\ttaken-at-ms` into `$lock/owner`; `plot-budget.sh:221`
reads it back. Reuse that shape (pid + action name + taken-at) so a waiter that times out can
print who holds it and a stale lock (holder's pid no longer alive) can be told apart from a live
one — `plot-budget.sh`'s own stale-lock check (`BUDGET_LOCK_STALE_MS`, `budget_lock_recover`) is
the precedent for "a dead pid's lock is not a live hold."

**This lock has no existing staleness bound of its own — decide one, and say why.** `plot-budget.sh`
uses `BUDGET_LOCK_STALE_MS=10000` because its own lock is held only for the span of a rename. A
default-branch push can legitimately take longer (git push round-trip, possible CI wait on some
remotes), so do not copy the 10 s figure verbatim — pick a bound against what `plot-push-main.sh`
itself can take, and record the measurement the way `plot-budget.sh:326` records its own.

**The lock wraps the push in `plot-push-main.sh`, not the caller's surrounding work.** Each caller
(`plot-approve.sh`, `plot-deliver.sh`, `plot-deliver.mjs`, etc.) already calls
`plot-push-main.sh "$branch" "$default"` once per write; the lock/wait/refuse behavior belongs
inside that one call, so no caller needs to change to get the serialisation. Confirm this by
grepping call sites before editing — `grep -rn "plot-push-main.sh" skills/ packages/` — and do not
add a second lock at any of them.

**Exit code contract is unchanged for the two outcomes that already exist.** `plot-push-main.sh`'s
header docblock (lines 4-30) specifies exit 0 for `clean`/`bypassed`/`unknown`, exit 1 for
`rejected`, exit 3/4 for `refused`. A lock-wait timeout is a new, fourth outcome — give it its own
exit code (do not overload 1, which callers already read as "retry against a fresh base"; a lock
timeout is not that — retrying immediately against the same base is correct once the lock frees).
Document the new code in the header comment alongside the existing five, the way the existing
block documents `refused`'s 3 vs 4 split.

### Done when

The plan's `## Done when` is implicit in its Design section — there is no explicit `## Done when`
list in this plan, so treat the Design section's three numbered items and the open questions'
decisions as the specification. Concretely:

- A reproducing test exists first: two concurrent `plot-push-main.sh` invocations against the same
  repo, one blocked on the other's lock, the second lands after the first releases.
- A waiter that exceeds 120 s refuses, and the refusal message names the holder's pid and action.
- A stale lock (holder process no longer running) does not wedge a waiter — recovered the way
  `budget_lock_recover` recovers `plot-budget.sh`'s lock.
- No existing caller of `plot-push-main.sh` is changed to add locking — the lock is transparent to
  all of them.
- The five existing classify outcomes (`clean`, `bypassed`, `unknown`, `rejected`, `refused`) are
  unchanged in meaning and exit code; only a new timeout outcome is added.

Plus the repo's gates: a changeset (package `plot`, description first, `bumps:` block last — see
root `CLAUDE.md` § Versioning), and `scripts/check-shell-lines.sh`'s ratchet — this slice adds
shell to `plot-push-main.sh`, so if the net new line count in shipped shell under `skills/` grows
against the merge base, remove an equal number of lines elsewhere in the same change, or move the
new logic into the domain and reach it through a bundle instead.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it
prints — the tests that name a changed file, the related tests and typecheck of a changed
package, and the gate tests and `scripts/check-*.sh`. The suites in the `CI suites` config key
(`pnpm run test:e2e`, `test:contracts`, `test:board`, domain coverage, `node --test
test/reconcile/*.test.mjs`) run in CI on every pull request; do not run `test:e2e` locally — it
dispatches real workers into sandbox repos and is CI's gate, not a local one (root `CLAUDE.md` §
Testing).

### Bookkeeping

Open the PR through the controller once the branch carries its first real commit:

```bash
skills/plot/scripts/plot-open-pr.sh          # current branch, ready for review
skills/plot/scripts/plot-open-pr.sh --draft  # while still moving
```

Do not run `gh pr create` directly. When the PR is created, append `→ #<number>` to this branch's
line in the plan's `## Slices` section, under the `### Write queue` heading. Push the first real
commit as soon as it exists.

### Scope guard

This branch owns `skills/plot/scripts/plot-push-main.sh` and its test file. It does not touch
`packages/board/src/server/entry/ladder.ts` (the TypeScript caller that reads
`plot-push-main.sh`'s stdout) or any of the `.mjs`/`.sh` callers listed by the grep above — those
only need the lock to be transparent, not to change.

The other two slices of this plan (#1355 ref path, #1340 scan source) are already merged and
touched `packages/board/src/server/deliver.ts` and `skills/plot/scripts/plot-reconcile-scan.sh`
respectively — disjoint from this branch's territory, so no collision is expected with either.

If you find something the plan did not anticipate, report it rather than improvising outside
scope.
