## Implementation brief — a-post-merge-commit-is-not-merged-work

- **Plan (canonical):** `docs/plans/2026-09-28-a-post-merge-commit-is-not-merged-work.md` on `main`
- **Approved:** 2026-09-28, jwloka, in-session after panel (round 1)
- **Branch:** `bug/a-post-merge-commit-is-not-merged-work` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — PR review, CI green
- **Issue:** #1038

Single-slice plan: nothing waits on this branch and it waits on nothing.

### What to build

A desk whose merged head it does not hold — a squash merge, or a host answer carrying none — answers empty for unpushed commits, so a commit made *after* the merge is reaped with the checkout. Reproduced by the panel against the real `plot-reap.sh`: the desk was removed under `--yes` and the commit went with it.

**Read `git cherry <base> <desk-branch>`.** It compares by **patch-id** — the content of the change — not by sha, ancestry or timestamp. A `-` prefix means the patch is already upstream; a `+` means it is not. Keep the desk on any `+`.

The plan is canonical; this brief is orientation.

### Decisions the plan settles — do not re-derive them

**DO NOT COMPARE DATES. The panel measured both fields failing, in opposite directions:**

| field | fixture | outcome |
|---|---|---|
| `%cI` (committer) | merged work, desk rebased after the merge | **kept forever** — every later rebase re-stamps it; nothing clears it |
| `%aI` (author) | a commit made today from an old patch (`cherry-pick`, `git am`) | **reaped** — the work loss this plan exists to prevent |

17 of 200 recent commits on this estate have `%aI ≠ %cI`. `max(%aI, %cI)` fixes the false reap and not the false keep. The false keep is disqualifying: it is #1033's forever-hold reached by the fix rather than avoided by it.

**Patch-id passes both fixtures.** Measured 2026-09-28: the rebased merged desk gives 0 commits marked `+` (reap, correct); the old-dated live commit gives 1 (keep, correct). A rebase does not change a patch-id, and no clock is consulted.

**ONE reading site: `plot-reap.sh:653`**, the only `desk_unpushed` call in the file. An earlier draft named `:506` and `:1040`; both are wrong — `:506` is prose in a comment, `:1040` is the orphaned-claim-ref loop, which calls `sweep_is_empty_claim` and touches neither function.

**The local-branch sweep at `:919` is out of scope.** It asks `firstBranchRefusal` in `rules/sweepable.ts` — a different rule, with no worktree, no `HEAD` to read and no unpushed field. Do not widen it, and do not write a test "driving the sweep's counter": there is nothing there to drive.

**No host call.** `git cherry` is local. An earlier draft proposed a `pr_merged_at` sibling in `plot-pr-merged.sh` and claimed it was free; measured, nothing in that file caches, so it would have been a **third** `gh pr list` per desk. That approach is withdrawn — do not resurrect it.

**Do not add the function to `plot-pr-merged.sh` for co-location.** The stated reason was keeping the reaper and `plot-release-refs.sh` in step; that script has no desk and no unpushed reading, so the argument was empty.

**The rule stays in bash, and say so.** `reapProblems` (`rules/reapable.ts:100`) already takes `unpushed?: readonly string[] | 'unknown'` and is untouched — the fix narrows what the adapter puts in the array. `git cherry` makes shell acceptable where a date comparison would not: one command, and the logic is a `+`/`-` prefix test. **If you find yourself writing any conditional beyond that prefix test, stop and add a corpus entry** — that is the signal the rule has grown past what shell should hold.

**Fail toward keeping.** `git cherry` failing, an unreadable base, no upstream to compare against — all keep the desk. The cost of keeping a reapable desk is a stale checkout; the cost of reaping a held one is work that exists nowhere else.

**Out of scope:** widening the guard back to *any* merged desk (that is the defect #1033 fixed, and it holds every squash-merged desk forever); `plot-release-refs.sh`'s guards; ancestry and timestamps of every kind.

### Done when

The plan's `## Done when` list is the specification. Assertions a naive implementation passes without:

- **Both round-1 fixtures pass, by name and in one test file:** merged-work-then-rebased is **reaped**; an old-dated patch made today is **kept**. These are the two cases no date comparison satisfies together — a test with only one of them proves nothing.
- A desk whose commits are all upstream by patch-id is still reaped: #1033's fix stays fixed, asserted by the **existing** test rather than a new one.
- Every unreadable reading keeps the desk.
- **No new host call**, asserted by a test that counts `gh` invocations.
- The test suite touches `sweepable.ts` nowhere.

Plus the repo's gates: `pnpm test`, `pnpm run test:contracts`, and the reaper's own files under `test/reconcile/` (`reap-*.test.mjs`, `reaper.test.mjs`). No board source changes, so `pnpm run test:board` is not owed. A changeset with `'plot': patch` and a `plan:` line, description first.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (use `--draft` while the work still moves). Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to the slice heading in the plan's `## Slices` section on `main`.

### Scope guard

This branch owns `desk_unpushed` in `skills/plot/scripts/plot-reap.sh` (one reading site, `:653`), the reaper tests under `test/reconcile/`, and its changeset. The existing assertion *"a merged desk whose merged head this desk does not hold is reaped"* is in `test/reconcile/reap-agent-liveness.test.mjs`. It changes meaning here, so rewrite it deliberately and do not delete it.

At claim time (2026-09-28), no other remote branch touches `plot-reap.sh`, `rules/reapable.ts`, `plot-pr-merged.sh` or a reap test.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
