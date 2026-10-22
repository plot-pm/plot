# Jenkins: a sha lookup matches a build on its merge-base revision

> Under `CI: jenkins` with merge-before-build, `runs-for-sha` and `run-for-sha` answer for a sha the build only used as its merge base, because `jenkins_sha_runs` accepts any `lastBuiltRevision` entry. A sha-bound lookup must match the branch-head entry only.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** bitbucket-jira-and-jenkins-work-with-the-board
- **Issue:** #2229
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-21, Jan Wloka, plan-PR #2230 merged
- **Started:** 2026-10-21, Jan Wloka, `bug/a-sha-lookup-matches-a-build`
- **Delivered:** 2026-10-21
- **Released:** 2026-10-22, v2.28.0

## Changelog

- Jenkins: `runs-for-sha` and `run-for-sha` match a build only on the revision it built for its own branch, never on the merge-base entry.

Board impact: none expected. The sha-bound lookup feeds `checksSha` through `jenkins_bind_rows`; a build that no longer matches a merge-base sha binds to `unknown`, not to the wrong colour. Slice 1 confirms this by reading every caller of `jenkins_sha_runs`.

## Motivation

A merge-before-build Jenkins job records two `lastBuiltRevision` entries per build: the default branch tip first, then the branch head (plan `2026-10-20-a-sha-bound-run-reports-the`). The sha match in `jenkins_sha_runs` (`skills/plot/scripts/plot-host.sh:1809`, `any(.shas[]?; …)`) accepts either entry. A build therefore answers a sha lookup for a sha it only used as the merge base.

The defect applies to `SUCCESS` and `FAILURE` builds as much as to `NOT_BUILT` ones. A different branch's green build can bind to a head that never ran. The plain-job fallback applies no branch filter when a sha is asked, so it matches on any entry of any build.

Issue #2229 was read from the code on `main` on 2026-10-21. It was not measured on a live job: the field-test symptom on ewz-kus-portal (`runs-for-sha add-bdd 501496d013ad`) could not be resolved in the local clone. Plan `2026-10-20-a-sha-bound-run-reports-the` (issue #2214, `NOT_BUILT` half) fixes the other half.

## Design

### Approach

1. **Measure first.** Read a real build payload from ewz-kus-portal, read-only, and record which `lastBuiltRevision` entry names the branch head and which names the merge base. The fix depends on that payload, so it comes before any code.
2. **Match the branch-head entry only.** With a sha, `jenkins_sha_runs` pairs each `lastBuiltRevision.SHA1` with its `branch[].name` (the pairing the no-sha arm already uses) and matches only the entry whose branch is the asked branch. The fix stays inside the jq program of `jenkins_sha_runs`, the one place that reads `lastBuiltRevision`.
3. **Plain jobs.** A plain job with no branch filter and a sha asked matches the entry named for the job's own branch, or the last entry where no branch is named.
4. **Tests.** A fixture in `test/reconcile/host.test.mjs` with two entries per build, where the merge-base sha and the head sha differ, asserts that the head sha matches and the merge-base sha does not, for `SUCCESS`, `FAILURE` and `NOT_BUILT`.

### Open Questions

- [ ] What does a real ewz-kus-portal payload show for `branch[].name` on the merge-base entry? If it names the target branch, the pairing works; if it is empty, the match needs the last-entry rule alone.
- [ ] Plan `2026-10-19-jenkins-checks-never-bind-to-the` introduced the any-revision match so that a head sha in the second entry is found. Does any caller ask for the merge-base sha on purpose?
- [ ] Is a sha-bound lookup for a PR-merge ref (`PR-123` jobs) in scope, or only branch jobs?

## Slices

### Branch Head Only

- `bug/a-sha-lookup-matches-a-build` — `jenkins_sha_runs` matches a sha only on the branch-head entry; fixture test with differing merge-base and head shas <!-- builds: branch-head-only sha match in jenkins_sha_runs --> → #2240

## Notes

- Source: issue #2229, split from #2214.
- Same jq program as `2026-10-20-a-sha-bound-run-reports-the`; rebase onto its slices if they are still open when this one starts.
