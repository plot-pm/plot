## Implementation brief — the-refs-corpus-test-fails-when

- **Plan (canonical):** `docs/plans/2026-10-09-the-refs-corpus-test-fails-when.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-refs-corpus-test-fails-when` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This is the only slice of its plan. Nothing waits on it, and it waits on nothing. Issue #1403.

### What to build

`packages/domain/corpus/refs.corpus.test.ts:538` asserts that at least one wire branch has a non-empty `changed_paths`. It reads the live estate of the pinned clone. Main CI fails on it with `expected 0 to be greater than 0` from `588c91635` (#1391) onwards, because no open slice branch carries unmerged changes any more. Every PR on main fails the `corpus` job.

`pinClone` (`packages/domain/corpus/pin-clone.ts:86`) gains its own fixture, built in `source.git` with `git commit-tree` and `update-ref` (no working tree, no write in ROOT):

1. A **fixture plan commit** on top of ROOT's `origin/<main>`. It adds one plan file under `docs/plans/` whose `## Slices` section names the fixture branch.
2. `refs/heads/plot-corpus-pin` points at the fixture plan commit, not at `origin/<main>`.
3. A **fixture branch commit** on top of the fixture plan commit. It adds one file at a known path, for example `fixture/changed.txt`. `refs/heads/<fixture branch>` points at it.

The guard then asserts on the fixture branch by name: its `changed_paths` equals `['fixture/changed.txt']`. `PinnedClone` gains the fixture's branch name, its path, and the pin's SHA. Update the TSDoc on `pinClone` and the type: state what the function builds, not why.

### Decisions the plan settles — do not re-derive them

The plan left four questions open. Three are measured below on 2026-10-09 against a throwaway `pinClone`, running the real `plot-fleet-scan.sh --json`. Re-run the measurement in your own test rather than trusting this paragraph.

**Option (a), reusing an existing plan's branch name, does not work.** A fixture branch named `feature/the-agent-panel`, which a released plan names and no remote ref carries, did not appear in the scan's output at all. The scan skips branches of delivered and released plans. A plan that is Approved today (this one) would work now and stop working the day it is delivered — the guard would break on the estate again, through the plan list instead of the remote refs. Name the fixture plan yourself.

**Option (b), a fixture plan commit above the pin, works.** With `plot-corpus-pin` at the fixture plan commit and the fixture branch one commit above it, the scan reported the branch with `state: "wip"`, `conflicts_known: true` and `changed_paths: ["fixture/changed.txt"]`. `read_ref` was the fixture plan commit.

**The fixture plan must parse as an open plan.** Copy the shape of this plan: `State: Approved`, one wave, one branch line under `## Slices`. Give it a name that cannot collide with a real plan (a date far from the estate's, a `fixture` slug), and a branch name no real plan uses. A plan that parses as delivered returns to the failure of option (a).

**The diff is taken against the pin, so the fixture branch must sit above it.** `changed_paths_of` runs `git diff --name-only origin/$MAIN...origin/<branch>` and `$MAIN` is `plot-corpus-pin` in the clone. If the fixture branch were cut from `origin/<main>` it would also carry the fixture plan file in its diff. Cut it from the fixture plan commit.

**The pin guard changes its comparison.** `expect(pinned?.pinned.startsWith(String(raw.read_ref)))` at `:537` holds only while the pin is ROOT's `origin/<main>`. With the fixture plan commit `read_ref` is a different SHA, so compare against the new field on `PinnedClone`. A pin that reads nothing must still fail: `read_ref: unknown`, `plan_source: worktree` and an absent `origin/*` each yield `changed_paths: []` for the fixture too. **Prove this by mutation** — break the pin in three ways (the 2026-10-08 failure was a pin that was a local branch) and watch the guard fail each time, per the memory *mutation-test a gate before believing its tests*. Commit before mutating.

**Unmeasured, you measure them.** (1) Whether the scan asks the host for the fixture branch's PR, and what it costs per run. The clone has a disposable branch, so the expected answer is `none`. If a host call is made, say so in the PR. (2) Whether `summary.branches` and the `moved` floor at the end of the file still hold with one more branch; the floor is `compared > branches.length / 2`, which one extra unmoved branch cannot break. (3) That `readFleetScan` runs both the production scan and the adapter against `pinned.clone`, so both see the fixture.

**Rules carried over, not to be re-learned.** Variety is a property of the estate, not of the code (`:468` and the variety check below `:538`): the fix removes the third dependence on the estate, and adds no new one. Absent is not false: do not weaken the assertion to `>= 0`. On a disagreement between the adapter and production the branch stops; do not adjust either side to pass.

### Done when

The plan has no `## Done when` list. Its Approach and Motivation are the specification:

- The `corpus` job passes on an estate where no open branch carries unmerged changes. Prove it by running the corpus test while `origin/*` holds no branch other than `origin/main` — a throwaway ROOT, or by reading what the test sees, not by waiting for the estate to change.
- The guard asserts on the fixture branch by name, with its exact path.
- Each of the three broken pins fails the guard (see above). This assertion exists because a guard that passes on a clone reading nothing is the failure the guard was written for.
- `test/reconcile/corpus-pin-shared-repo.test.mjs` still passes. It covers `pinClone` against a shared repository, and `pinClone` writes nothing in ROOT; the fixture objects land in `source.git` only, and a test or a `git count-objects` before and after shows ROOT unchanged.

Plus: a changeset for `plot` (`patch`, description first, `bumps:` block last — see CLAUDE.md *Versioning*). The change is under `packages/domain/corpus/`, so no skill bumps are needed. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite. Use `pnpm --filter @plot-pm/domain exec vitest run corpus/refs.corpus.test.ts` to run the file you changed; `test:e2e` is CI's.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice touches no `.sh` file, so it adds none.

New and rewritten functions are arrows (`export const f = (…) => …`); the domain package's style applies to `packages/domain/corpus/` as to `src/`.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (use `--draft` while the work moves), never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. Reference `#1403` in the PR body.

### Scope guard

This branch owns `packages/domain/corpus/pin-clone.ts`, `packages/domain/corpus/refs.corpus.test.ts` and one changeset. Do not edit `plot-fleet-scan.sh`: the scan's behaviour is correct, and the measurement above shows the fixture reaches it as it is. No other slice is in flight on these files (`git log` on `packages/domain/corpus/` shows the last change as #1354).

If you find something the plan did not anticipate, report it rather than improvising outside scope.
