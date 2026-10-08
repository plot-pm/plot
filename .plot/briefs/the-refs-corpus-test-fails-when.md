## Implementation brief — the-refs-corpus-test-fails-when

- **Plan (canonical):** docs/plans/2026-10-09-the-refs-corpus-test-fails-when.md on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-refs-corpus-test-fails-when` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention (PR review; CI is the authority)

Single-slice plan. Nothing waits on this branch, and it waits on nothing. Issue #1403.

### What to build

Main CI fails the `corpus` job on every PR since `588c91635` (#1391) with `AssertionError: expected 0 to be greater than 0`. The failing line is `packages/domain/corpus/refs.corpus.test.ts:538`, which counts wire branches with a non-empty `changed_paths`. The #1391 merge left no open slice branch with unmerged changes on the remote, so the count is 0. The release-record PRs #1397, #1399, #1400 and #1401 all fail on it.

`pinClone` (`packages/domain/corpus/pin-clone.ts`) builds `source.git` from ROOT's `refs/remotes/origin/*` in the `creates` list before `update-ref --stdin`. Add one fixture branch to `source.git` in that step: one commit on top of the pinned SHA that touches one known path, built with `git commit-tree` so no working tree and no checkout are needed. The clone then carries `origin/<fixture>`, and the scan's `changed_paths_of` (`plot-fleet-scan.sh:2356`, `git diff --name-only origin/$MAIN...origin/$1`) returns that path. Change the guard to assert on the fixture branch by name: its `changed_paths` equals the one known path.

The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**Do not weaken the guard to `>= 0` or drop it.** It exists because on 2026-10-08 a clone whose pin was a local branch gave `read_ref: unknown`, `plan_source: worktree` and `changed_paths: []` on all 18 branches, on both sides, and every comparison passed on shared emptiness. The fixture branch keeps that power: with `read_ref: unknown` or an absent `origin/*`, the fixture's `changed_paths` is `[]` too.

**Do not condition the test on the estate** (skip when no branch has changes). The same file states the rule at `:468` and in the variety check below `:538`: *variety is a property of the estate, not of the code*. A finished estate is the success case. This floor is the third instance and the one still written against the estate.

**Do not touch ROOT.** Objects and refs of ROOT stay as they are; `pinClone` only reads it. The fixture commit goes into `source.git`, whose `objects/info/alternates` already points at ROOT's objects.

Measure these before fixing the design. The plan lists them as open questions, and the answers decide the shape:

1. **A plan on the pin must name the fixture branch.** The scan reports only branches a plan names in `## Slices`. Option (a) reuses a branch name a plan on the pin already declares whose remote ref is absent; that depends on the estate again through the plan list. Option (b) commits a fixture plan above the pin; that moves the pin, and the guard's `pinned?.pinned.startsWith(String(raw.read_ref))` check reads the pin's SHA. Run the scan against a hand-built clone and read the wire output before choosing.
2. **`conflicts_known` must be true for the fixture.** `plot-fleet-scan.sh:4908` emits `changed_paths` only there. A branch whose plan is delivered, or whose PR the host reports merged, may never reach that arm. Check whether the scan asks the host for the fixture's PR; a host call for a branch that exists only in a disposable clone should answer `none`.
3. **Other assertions count branches.** The field comparison, the `moved` floor at the end of the file and `summary.branches` all count; the fixture adds one. Read each and confirm none breaks.
4. **Both sides must see the fixture.** Confirm `production.ts`'s `readFleetScan` runs the scan against the clone for production and for the adapter alike.

Carried-over invariants: absent is not false; read the exit code, not the emptiness. A fixture assertion that passes when the field is missing proves nothing, so assert the exact path, not a non-empty list.

### Done when

The plan has no `## Done when` section. The specification is its Approach, Changelog and Slices, which come to:

- `pinClone` adds one fixture branch with one changed path to `source.git`.
- The guard at `refs.corpus.test.ts:538` asserts the fixture branch's `changed_paths` equals that path, by branch name.
- The `corpus` job passes on an estate where no open branch carries unmerged changes (the state of main today).
- The guard still fails on a broken pin. Mutation-test it: break the pin (for example, make the clone's `origin/*` empty or the pin a local branch) and show the guard fails. Commit before you mutate, and restore from git afterwards.
- All other assertions in `refs.corpus.test.ts` still pass with the extra branch.

Plus: add a changeset (description first, `bumps:` block last, package `plot` or `@plot-pm/board`; run `./scripts/check-changeset-packages.sh`). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The domain package takes arrow functions, not declarations, and TSDoc that states behaviour rather than history.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice should touch no `.sh` file; if it does, pay for the growth in the same change.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (add `--draft` while the work moves); do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The commit subject starts with `plot:` or a plain description (repo-level), per the commit conventions.

### Scope guard

This branch owns `packages/domain/corpus/` (`pin-clone.ts`, `refs.corpus.test.ts`, and any `pin-clone` test) plus the changeset. It changes no plan format, template, helper script or `docs/plans` layout. `plot-fleet-scan.sh` is read, not edited; if a fix needs the scan changed, report it rather than improvising. No other slice branch is in flight for this plan.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
