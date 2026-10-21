## Implementation brief — a-sha-lookup-matches-a-build (wave 1: Branch Head Only)

- **Plan (canonical):** docs/plans/2026-10-21-a-sha-lookup-matches-a-build.md on main
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2230 merged
- **Branch:** `bug/a-sha-lookup-matches-a-build` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the declared review channel (`Review: pr`)

Single-wave plan. Nothing waits on this branch and it waits on nothing: the sibling plan `a-sha-bound-run-reports-the` (#2214) is Delivered, so its jq changes are already on `main`.

### What to build

`jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1771`) answers `runs-for-sha` and `run-for-sha`. With a sha asked, its jq program keeps every build where any `lastBuiltRevision.SHA1` equals or prefixes the sha (`any(.shas[]?; …)`). A merge-before-build job records two entries per build, the default-branch tip and the branch head, so a build answers for a sha it only used as the merge base. A different branch's green build can bind to a head that never ran.

The fix stays inside that one jq program. With a sha, pair each `SHA1` with its `branch[].name` (the `[.br, .shas] | transpose` pairing the no-sha arm already uses) and match only the entry whose branch is the asked branch. A plain job (`$plain` set, no branch filter) with a sha asked matches the entry named for the job's own branch, or the last entry where no branch is named. The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

- **The fix lives in the jq program only.** `jenkins_sha_runs` is the one place that reads `lastBuiltRevision`; every caller (`jenkins_bind_rows` at :1832, `run-for-sha` at :4718, `runs` at :4637) goes through it. Adding a filter in a caller leaves the others wrong.
- **The wrong match is not limited to `NOT_BUILT`.** Plan `a-sha-bound-run-reports-the` fixed the `NOT_BUILT` half. A `SUCCESS` or `FAILURE` build binds to the wrong head the same way, so the fixture must cover all three conclusions.
- **A wrong match must become `unknown`, not a wrong colour.** `jenkins_bind_rows` feeds `checksSha`; a build that stops matching leaves the branch unbound. Absent is not false: do not turn the empty result into `none` or red.
- **The any-revision match exists on purpose.** Plan `2026-10-19-jenkins-checks-never-bind-to-the` added it so a head sha in the second entry is found. The fix narrows it to the branch-head entry; it must not restore first-entry-only matching.
- **The no-sha arm stays unchanged.** `runs` with no sha keeps its `NOT_BUILT`/`ABORTED` filter and its branch filter.

### Done when

The plan's `## Done when` list does not exist; its Design Approach and Slice line are the specification: `jenkins_sha_runs` matches a sha only on the branch-head entry, and a fixture test with differing merge-base and head shas proves it.

Assertions that exist because a naive implementation would pass without them:

- **The merge-base sha must not match**, for `SUCCESS`, `FAILURE` and `NOT_BUILT`. A test asserting only that the head sha matches passes on the unfixed code.
- **The fixture needs two entries per build whose shas differ and whose `branch[].name` differ** (target branch on the merge-base entry, asked branch on the head entry). The existing fixture at `test/reconcile/host.test.mjs:2875` already builds this shape; reuse it. Same sha in both entries cannot tell the arms apart.
- **A plain job with a sha asked**: one case where the entries name branches and one where `branch[]` is empty (last-entry rule).

Open questions to settle before coding, in order:

1. Read one real build payload read-only (ewz-kus-portal, `jen`/REST) and record which entry names the branch head and what `branch[].name` holds on the merge-base entry. If it is empty, the match needs the last-entry rule alone. If you cannot reach the instance, say so in the PR and implement the pairing rule plus the last-entry fallback.
2. Grep every caller of `jenkins_sha_runs` for one that asks the merge-base sha on purpose. Record the answer in the PR.
3. Scope: branch jobs only unless the payload shows `PR-123` jobs break the same way.

Plus: add a changeset (`plot` patch, description first, `bumps:` block last, `plan:` line inside the block). Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. The jq program is inside `plot-host.sh`, so keep the edit line-neutral or remove shell elsewhere in the same change. The gate stores no number and has no override. Run `test/reconcile/host.test.mjs` by the test names you touch, not as a whole file; it can stall under load.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns the jq program in `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh`), the fixture tests in `test/reconcile/host.test.mjs`, and one changeset. No other plan is in flight on the Jenkins jq program (sibling #2214 is Delivered). `plot-jenkins-pr-checks.mjs` and the `rows` bundle are out of scope.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
