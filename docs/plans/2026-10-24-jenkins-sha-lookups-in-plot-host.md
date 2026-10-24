# Jenkins sha lookups in plot-host.sh pair branches and shas by position

> `jenkins_sha_runs` binds a build's branch and sha from separate flat lists, filters builds after the limit, and returns empty answers where it should refuse; the credential fallback reads file existence, not a credential pair.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:**
- **Issue:** #2478
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2497 merged

## Changelog

- `plot-host.sh` Jenkins sha lookups bind each sha to the branch of the same `lastBuiltRevision` action, and `runs --limit N` returns N rows when N exist.
- A missing multibranch branch and an `Instance` line with no host refuse with a message that names the cause.
- The `.env` credential fallback reads a credential pair, and resolves the main checkout with `--path-format=absolute`.

<!-- Board impact: none. The change is inside helper script `plot-host.sh` and its tests; no plan format, template or docs/plans layout changes. -->

## Motivation

Follow-up findings from plot-review on ten merged PRs (#2117, #2166, #2180, #2199, #2231, #2244, #2255, #2264, #2288, #2309), checked against `origin/main` at `84b1638e4` on 2026-10-24, are collected in issue #2478: 12 MEDIUM and 9 LOW, 20 of them in `skills/plot/scripts/plot-host.sh` (lines 1737–2818) and 3 in `test/reconcile/host.test.mjs`.

The defects fall into five groups.

- **Positional pairing.** `jenkins_sha_runs` builds `br` and `shas` as two flat lists and joins them with `[.br, .shas] | transpose`. A revision with zero or several branches shifts every later pair, so the asked branch can bind the merge-base sha. The plan an implementer reads then tells them to reuse that sha (#2231, #2244, #2180).
- **Wrong key on a plain job.** When `Default branch job` routes the default branch to a plain job, the match keys on the last segment of the job path, not on the asked branch (#2244, #2309).
- **Limit before filter.** The tree query applies `{0,$limit}` on Jenkins' side and the jq program drops `NOT_BUILT` and `ABORTED` afterwards, so `runs --limit N` can return fewer than N rows, or none (#2166, #2199).
- **Silent empties.** A missing multibranch branch answers empty with exit 0, so fleetd reads a quiet branch and no hold reason names the cause (#2288). `jenkins_resolve_host` exits 0 with empty output when the `Instance` line has no host, so the user sees a credential error instead (#2117).
- **Credential fallback.** The `.env` fallback tests file existence, so a worktree `.env` without a credential pair blocks the main checkout's `.env` (#2255). It takes the parent of `--git-common-dir`, a path outside any checkout in bare or separate-git-dir layouts (#2264), and does not pass `--path-format=absolute` (#2255).

## Design

### Approach

**Pairing.** Read the branch names and the sha from the same `lastBuiltRevision` action, one record per action, and match on the record. A build with several actions is searched record by record; a record with no branch name never matches a named branch. This removes `transpose` and the `br`/`shas` lists.

**Match key.** On a plain job the match keys on the asked branch. The job's last path segment stops being a key.

**Limit.** Apply the `NOT_BUILT` and `ABORTED` filter on the server side where the `tree` query allows it, or over-fetch and cut to `$limit` after the filter. Open choice below.

**Refusals.** A branch path that answers no `builds` and is not a container refuses with exit 4 and names the branch. `jenkins_resolve_host` returns non-zero when the `Instance` line has no host, and the caller names that cause.

**Credentials.** The loader takes a file only when it holds the whole pair, then falls through to the next file. The main checkout comes from `git rev-parse --path-format=absolute --git-common-dir`; a bare or separate-git-dir layout names no checkout and is skipped.

**Gates.** `scripts/check-shell-lines.sh` ratchets the shipped shell's line count against its merge base, so the added lines in `plot-host.sh` are paid for by removed ones in the same change. Several of the LOW findings (statements packed into chained lines to pass this gate) are the same pressure; the credential slice unpacks them and must still end net-zero or negative.

**Tests.** The tests that source `jenkins_sha_runs` run in a private `HOME` and `cwd` (the `owned-run.sh` contract), and each test title names the op it runs.

**Comments.** The doc comments of `jenkins_sha_runs`, the runs arm and the credential loaders state the filter, the match rule and the credential order as current behaviour, with no history.

### Open Questions

- [ ] Can the Jenkins `tree` query filter `result` server-side, or must `runs` over-fetch? What over-fetch factor bounds the cost against the Jenkins rate budget?
- [ ] A build whose actions hold several `lastBuiltRevision` records for the asked branch (a merge build): does the first, the last or any record bind the build's sha? The fix for #2322 assumed the entries agree.
- [ ] Is an `Instance` line with no host a refusal at `jenkins_resolve_host` or at its callers?
- [ ] Does fleetd have a hold reason for a refusal from a missing multibranch branch, or does the refusal need one added?

## Slices

### Sha binding

- `bug/jenkins-sha-runs-bind-by-action` — read branch and sha from the same `lastBuiltRevision` action; key the plain-job match on the asked branch; filter `NOT_BUILT` and `ABORTED` before the limit; rewrite the doc comments <!-- builds: a per-action branch/sha match in jenkins_sha_runs -->

### Refusals and credentials

- `bug/jenkins-refusals-and-credential-fallback` — refuse a missing multibranch branch and a host-less `Instance` line by name; make the `.env` fallback read a credential pair and resolve the main checkout absolutely; correct the loader comments and the Jira hint <!-- waits: bug/jenkins-sha-runs-bind-by-action -->

### Test hygiene

- `bug/jenkins-sha-tests-run-in-a-private-home` — run the `jenkins_sha_runs` sourcing tests in a private `HOME` and `cwd`; retitle the two `runs-for-sha` tests; add a `runs-for-sha` test on a plain job <!-- waits: bug/jenkins-refusals-and-credential-fallback -->

## Notes

- Source: tracker issue #2478. Nothing was written to the tracker.
- Slices run in sequence because all three edit `plot-host.sh` or its one test file.
- Related plans on the same code: `2026-10-21-jenkins-run-for-sha-can-answer.md`, `2026-10-21-jenkins-run-for-sha-on-the.md`, `2026-10-22-jenkins-runs-lists-every-build-twice.md`, `2026-10-19-jenkins-checks-never-bind-to-the.md`. Their titles overlap; the scope here is the findings those PRs left open.
