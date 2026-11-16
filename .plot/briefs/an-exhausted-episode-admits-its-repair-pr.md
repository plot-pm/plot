## Implementation brief — an-exhausted-episode-admits-its-repair-pr

- **Plan (canonical):** docs/plans/2026-11-16-an-exhausted-episode-admits-its-repair-pr.md on main
- **Approved:** 2026-11-16, Jan Wloka, plan-PR #3475 merged
- **Branch:** `bug/an-exhausted-episode-admits-its-repair-pr` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** `plot/review` on the PR head, per the repo's `Review required since` config

One slice, no wave ordering: nothing waits on this branch and it waits on nothing.

### What to build

Issue #3281: on 2026-11-08 `plot-ask.mjs merge 3280 87df144d3` refused `repair-episode-closed` for a person's repair PR, because `repairEpisode` read an `exhausted` repair record as `closed`. A person merged #3280 on GitHub, outside the controller. **The rule is already fixed on main** (`779e170c1`, `packages/domain/src/rules/repair-pr.ts:100` now reads `if (record.state === 'done') return 'closed';`). This slice adds the proof that the fix holds at workflow level, plus one production clause that the plan's open question settled as option A.

Five changes, all under `packages/domain/`, plus a changeset:

1. `packages/domain/test/workflows-merge.test.ts`, in `describe('mergeAt — the repair PR on a red default branch')` (line 693): add *"merges the repair PR an exhausted record names"*. Reuse the suite's `record()` and `ports()` helpers with `record({ state: 'exhausted' })`, `repairPr: 7`, the suite's fresh red reading and red re-asked runs. Assert `merged: true` and exactly one `pr-merge` call pinned to the head SHA.
2. Same suite: add *"refuses default-branch-red for a PR an exhausted record does not name"*. Same `exhausted` record, PR 8. Assert `reason: 'default-branch-red'` and that nothing is walked (`asked` stays empty).
3. `packages/domain/test/slice-pr-next.test.ts` (merge-arm block near line 544): add *"admits the repair PR an exhausted episode names"*. The merge arm's `repairMerge` reading carries an `exhausted` record with `episode: 'open'`. Assert `{ step: 'merge' }` for the named PR.
4. `packages/domain/src/rules/repair-pr.ts`, `keepsRepairRecord` (line 206): keep an `exhausted` record where `repairPr` or `revertPr` is set. Change one clause: today `existing.state !== 'exhausted'` drops every exhausted record. Update the TSDoc above it (lines 193–204) to state the new behaviour in present tense, with no history. Add *"keeps an exhausted record that names a repair PR"* to the `describe('keepsRepairRecord')` block in `packages/domain/test/repair-pr.test.ts` (line 207). It must fail on today's code.
5. Add `.changeset/an-exhausted-episode-admits-its-repair-pr.md`: package `'plot'`, `patch`, the description FIRST (at least 20 characters), then the `<!-- plan: …  bumps: skills: plot: patch -->` block LAST. Copy the shape of `.changeset/a-deferred-slice-keeps-its-branch.md`. Run `./scripts/check-changeset-packages.sh`.

### Decisions the plan settles — do not re-derive them

**`exhausted` stops fleetd's own steps and does not close the episode.** The issue offered two shapes; the plan took the first. `redMainStep` answers `none` for `exhausted` (`rules/repair.ts:250`), `repairStartTick` returns before it asks the host (`fleet/src/shared/repair-start.ts:96`), `revertStart` answers `none` (`revert-start.ts:174`). Do not touch any of them and do not re-add `exhausted` to the closed check at `repair-pr.ts:100`.

**Option A for the open question, decided 2026-11-16 by Jan Wloka.** The write path `writeRepairRecord` (`fleet/src/shared/default-branch-refresh.ts:203`) replaces an `exhausted` record with a fresh `idle` one that has no `repairPr`, whenever the settled reading changes from non-red to red for the same first red SHA. That needs a carried reading that is missing or unreadable (for example `.plot/state/default-branch.json` removed). Option B (keep the replacement; the person records the PR again) was rejected: the record names a person's PR, which is the one way left to end the episode, and a silent drop makes that PR refuse `default-branch-red`. Keep the change to the one clause; an `exhausted` record with neither `repairPr` nor `revertPr` is still replaced (fleetd gets its second chance), so assert that too in the test.

**Rules carried over unchanged.** Absent is not false: a missing, unparseable or other-version record or reading holds nothing. The merge admits only the PR whose head branch is `bug/main-repair-<12 hex of lastGreenSha>` or `bug/revert-<revertedPr>`, while the episode is open and the red commit's runs, re-asked immediately before the merge, still read red. Do not loosen any of these in the new tests' fixtures: the second test (PR 8) exists because a naive "exhausted admits everything" change passes the first test.

**No duplicate, no corpus row, no index read, no spawn.** The change touches only the domain rule and tests, so `scripts/check-shell-lines.sh` is untouched by design.

### Done when

The plan's `## Done when` table is the specification. The assertions that exist because a naive implementation would pass without them:

- *refuses default-branch-red for a PR an exhausted record does not name* — catches an `exhausted` record that admits any PR.
- *keeps an exhausted record that names a repair PR* — catches a `keepsRepairRecord` that still drops the record. Also assert that an `exhausted` record with no PR is not kept.
- Mutation proof, local only: revert `repair-pr.ts:100` to `if (record.state === 'done' || record.state === 'exhausted') return 'closed';`, confirm the three new workflow tests fail, then restore the line from git (`git checkout -- <file>` reverts to HEAD, so commit your work first). Report the result in the PR body.
- The existing test `packages/domain/test/repair-pr.test.ts:115` still passes.

Plus: the changeset above. Before each push, commit, then run `node skills/plot/scripts/board/plot-local-checks.mjs` and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Run no full suite, and not `test:e2e`. Root `pnpm run typecheck` skips the domain package, so also run `pnpm --filter @plot-pm/domain exec tsc --noEmit -p .`. No `.sh` file changes here.

### Bookkeeping

Push the first real commit as soon as it exists. Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while work moves), never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### Proof` in the plan's `## Slices`. Commit messages: `plot: <description>`.

### Scope guard

This branch owns `packages/domain/src/rules/repair-pr.ts`, `packages/domain/test/repair-pr.test.ts`, `packages/domain/test/workflows-merge.test.ts`, `packages/domain/test/slice-pr-next.test.ts` and one new file in `.changeset/`. It touches no file under `packages/fleet/` and no shell. Other slices of sprint `bug-fixes-2-35-0` (for example `the-unblocker-reads-a-blocked-desk`, `the-s6-census-row-counts-one-change`, `a-delivery-follows-the-merge`) hold other files; a collision in `workflows-merge.test.ts` is a merge-order matter, not a reason to edit theirs.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
