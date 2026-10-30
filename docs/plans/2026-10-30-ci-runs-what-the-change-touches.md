# CI runs what the change touches, and a red main clears fast

> CI selects its suites from the PR's changed paths through one change-to-checks rule that `plot-local-checks.mjs` shares, runs `corpus` against the merge with the current `main` before a merge, and lets a red `main` admit its repair PR through `plot-ask.mjs merge`.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** delivery-loop
- **Story:** the-fleet-delivers-a-scope-alone
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-30, Jan Wloka, plan-PR #2944 merged
- **Started:** 2026-10-30, Jan Wloka, `feature/ci-selection-rule`
<!-- Transition records — written by the workflow commands, not by hand:
- **Approved:** <date>, <who>, <channel>
- **Started:** <date>, <who>, <branch>   (one line per started branch)
-->

## Changelog

- CI selects the TypeScript tests and the shell-script tests a pull request touches, and runs the `scripts/check-*.sh` gates and the typechecks on every pull request.
- A change to a plan, a sprint or `.plot/` always runs `corpus`.
- `corpus` runs against the pull request merged onto the current `main` before a merge.
- `validate`'s own suites start alongside `helper-contracts` and `board-integration`.
- `plot-ask.mjs merge` admits the repair PR that the repair record names while `main` is red.

Board impact: none to the plan format, the template or `docs/plans`. A new rule in `packages/domain` is read by `plot-local-checks.mjs`, so the board artifact is rebuilt. The `Local checks` config key keeps its syntax.

## Motivation

Measured 2026-10-30: `ci.yml` runs every job on every pull request and on every push to `main`, and a red `main` holds every merge and every fleet handover until a fix PR passes that same full run.

- **The full run is slow and mostly red.** The last 40 `CI` runs: 4 success, 26 failure, 5 action_required, 4 cancelled. A green run takes 17 to 20 minutes: `helper-contracts` and `board-integration` take 13 to 14 minutes, then `validate` (`needs: [helper-contracts, board-integration]`) runs its own suites for about 6 minutes.
- **Most changes touch little.** Of the last 40 merged PRs, 24 touched `packages/board/` or `skills/`, 12 touched only plans, changesets, docs or tests, 3 only `packages/domain/`, and 1 only `packages/fleet/`.
- **CI ignores a map that already exists.** `plot-local-checks.mjs` maps changed paths to checks from the `Local checks` key; CI does not read it, so the local and the CI selection can differ.
- **A merge skew turned `main` red for about 2 h 45 min.** `main` was red from about 06:55 to past 09:40 UTC. #2937 passed its own CI against an older `main`. Merged, it made `feature/role-agent-definitions` eligible, and `corpus/eligible.corpus.test.ts` failed on `main`: the scan asks the host about a `waits:` prerequisite, and CI has no GitHub token. No local check could see it. fleetd held 51 handovers on `default-branch-red`, six slice PRs waited, and the fix PR #2942 needed two 20-minute CI rounds. `plot-ask.mjs merge` refuses the fix PR itself on `default-branch-red`.

## Design

### Approach

1. **One rule, two readers.** A rule in `packages/domain/src/rules/` maps a list of changed paths and the `Local checks` entries to the checks to run. `plot-local-checks.mjs` and a CI step both call it through a bundle, so the two selections cannot drift. `rules/local-checks.ts` is the starting point; the plan does not add a second rule beside it.
2. **CI reads the selection.** A first CI job lists the PR's changed paths, calls the bundle, and writes the selected suites as outputs. Later jobs run a suite only when the output names it.
   - TypeScript tests: `vitest related --run <changed files>`, which follows the import graph.
   - Shell-script tests: a script-to-test map. A test that runs `plot-host.sh` is selected when `plot-host.sh` changes. The map is derived from the tests' own script references, and a corpus test holds the derivation.
   - Always run: the `scripts/check-*.sh` gates and the typechecks.
3. **Plan data selects `corpus`.** A change to a plan, a sprint or `.plot/` always selects `corpus`, because plan data alone can turn `main` red through it.
4. **Merge skew.** Before a merge, `corpus` (about 5 minutes) runs against the PR merged onto the current `main`.
5. **One corpus reading.** The corpus scan reads the same way locally and in CI: no host token in either. A failure that only appears without a token then shows before the push.
6. **`validate` starts with the other jobs.** Its own suites (about 6 minutes) run beside `helper-contracts` and `board-integration`; its last step still exits 1 unless both split jobs ended `success`, as today.
7. **`main` keeps the full run.** The push to `main` runs every job, and that run is the safety net for a selection miss.
8. **Repair PR admitted.** `merge()` gains the narrow exception for the PR the repair record names (the `merge()` half of #2904's `feature/merge-admits-the-repair-pr`, moved forward on its own branch `feature/ask-merge-admits-the-repair-pr`). It needs `feature/the-repair-record` (PR #2936), not fleetd's merge arm. The `slicePrNext` half stays in #2904.

### Constraints

- No gate and no CI ratchet is weakened by hand. Every gate change goes through this plan.
- A selection miss costs at most one revert: the full run on `main` stays. The plan states how a skipped suite's failure is found: the run on `main` names the suite, and a miss is recorded as a ticket against the selection rule.
- Shipped shell runs under bash 3.2, and `check-shell-lines.sh` ratchets the shell's line count. The selection and the map stay in the domain; any shell is a launcher.

### Open Questions

- [ ] The branch ruleset requires `validate` and `plot/review`. Does a skipped suite still report through `validate`, as the split jobs do today (`if: !cancelled()`)?
- [ ] Does the merge-skew `corpus` run on `pull_request` with a merge ref, or in a `merge_group` queue? The repository has no merge queue today.
- [ ] How does the script-to-test map treat a test that runs a script through another script? The first slice measures it over the 75 contract files before the rule is fixed.
- [ ] Does `vitest related` miss a test that reads a file by path instead of by import? The first slice names the files `vitest related` cannot see.
- [ ] Does `corpus` need a fixture for the host's answer instead of removing the token, so local and CI readings match?

## Slices

### Selection rule

- `feature/ci-selection-rule` — the domain rule that maps changed paths to checks; `plot-local-checks.mjs` reads it; a corpus test holds the script-to-test map <!-- builds: the change-to-checks rule shared by plot-local-checks and CI, and the script-to-test map --> → #2945

### CI selection

- `feature/ci-reads-the-selection` — a CI job calls the rule's bundle; suites run on the selected outputs; plan, sprint and `.plot/` changes select `corpus`; `validate`'s suites start with the other jobs <!-- waits: feature/ci-selection-rule --> → #2947

### Corpus reading

- `feature/corpus-reads-without-a-token` — the corpus scan reads the same with and without a host token, and `corpus` runs against the merge with the current `main` before a merge <!-- waits: feature/ci-reads-the-selection -->

### Repair merge

- `feature/ask-merge-admits-the-repair-pr` — the `merge()` exception for the PR the repair record names while `main` is red; `slicePrNext` stays in #2904 <!-- waits: feature/the-repair-record --> → #2952

## Notes

- Not in scope: the revert of a red merge stays #2904's `feature/a-red-main-is-reverted`, which needs #2903's ticket writer.
- Priority: a sprint blocker, decided by Jan Wloka on 2026-10-30. It skips the panel round and lands ahead of the other sprint plans.
- Related: `docs/plans/2026-10-29-a-red-default-branch-is-repaired.md` (#2904), which keeps the `slicePrNext` half of the repair exception.
- #2904's `feature/merge-admits-the-repair-pr` keeps only the `slicePrNext` half once `feature/ask-merge-admits-the-repair-pr` merges; each branch has one owner.
