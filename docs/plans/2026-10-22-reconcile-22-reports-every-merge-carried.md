# Reconcile §22 reports every merge carried a changeset in a repository that keeps none

> In a repository with no `.changeset/` directory, §22 prints "every merge that shipped code in this window carried a changeset" over merges it never counted, because it takes shipped code from Plot's own layout and cannot read Bitbucket merge subjects.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:**
- **Issue:** #2345
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:**

## Changelog

- `plot-reconcile-scan.sh` §22 prints "(not evaluated — this repository keeps no changesets)" in a repository with no `.changeset/` directory, takes the shipped-code paths from the repository, and reads Bitbucket's `Merged in <branch> (pull request #N)` merge subject.

<!-- Board impact: none expected. The board does not parse reconcile output; no plan format, template or docs/plans layout changes. Confirm at implementation. -->

## Motivation

On ewz-kus-portal (read-only field test, round 8, main `04d336440`), §22 prints "(none — every merge that shipped code in this window carried a changeset)" over 40 merges. The repository has no `.changeset/` directory, so the statement is false: no merge could carry a changeset.

Two causes, both in `skills/plot/scripts/plot-reconcile-scan.sh`:

- **Code paths are Plot's layout.** `:2914` defines shipped code as `^(packages/[^/]+/src/|skills/)`. ewz keeps code under `backend/…/src/main/java` and `frontend/`, so no merge counts as code and every merge is skipped. The empty result then reads as a clean one.
- **The subject parser reads two host forms.** `:2878-2895` reads `Merge pull request #N from <owner>/<branch>` and git's own `Merge branch` / `Merge remote-tracking branch` subjects. It does not read Bitbucket's `Merged in <branch> (pull request #N)`, so `nc_branch` stays empty, the `idea/*` exclusion never fires, and the report names no PR number.

Issue: https://github.com/plot-pm/plot/issues/2345. Related, Delivered: `2026-09-11-a-merge-without-a-changeset-is-named` (introduced §22).

## Design

### Approach

1. **State what was not evaluated.** When the repository has no `.changeset/` directory (on `nc_ref`, not only in the working tree), §22 prints `(not evaluated — this repository keeps no changesets)` and skips the walk. This follows §18's `(not evaluated — …)` pattern: silence about a check that could not run reads as *nothing drifted*.
2. **Take code paths from the repository.** §22 reads the shipped-code pattern from the repository instead of the literal at `:2914`. `merge-subject.ts` and the other estate rules already answer repository-shape questions in the domain; the candidate sources are a `## Plot Config` key, the paths the repository's changesets name, or the complement of known non-code paths (docs, tests, fixtures). Plot's own layout stays the default so this repository's output does not change.
3. **Read the Bitbucket merge subject.** Add `Merged in <branch> (pull request #N)` to the parser at `:2878-2895`, so the `idea/*` exclusion and the PR number work on Bitbucket. `rules/merge-subject.ts` already reads this form for the wave gate, and a duplicated reading joins the corpus tier (see *A Shell Script Asks The Domain* in `CLAUDE.md`).

### Open Questions

- [ ] Where do the shipped-code paths come from? A new `Plot Config` key is explicit and costs adopters a line; deriving them from the repository's changesets fails in a repository whose first changeset is not yet written. The recommended direction is a config key with Plot's layout as the default.
- [ ] Is "keeps no changesets" the absence of `.changeset/` on `nc_ref`, or the absence of any changeset added in the window? The first is cheap and exact; the second also catches a repository that dropped the tool.
- [ ] Should the subject parser call `rules/merge-subject.ts` through a bundle, or duplicate the pattern in shell with a corpus test holding the pair? §22 runs once per operator command, which `docs/shell-and-domain.md` places on the domain side of the cost rule.

## Slices

### Honest report for repositories without changesets

- `bug/reconcile-22-reports-every-merge-carried` — §22 prints "not evaluated" when the repository keeps no changesets, takes shipped-code paths from the repository, and parses Bitbucket merge subjects <!-- builds: a repository-supplied shipped-code path pattern and a keeps-no-changesets guard for reconcile §22 -->

## Notes

- Test target: a contract test in `test/reconcile/` with a sandbox repository that has no `.changeset/` and merge commits touching `backend/` paths. The test fails on `main` with §22 printing "(none — every merge …)" and passes when it prints "not evaluated". A second case feeds a `Merged in idea/x (pull request #7)` subject and asserts the merge is excluded.
- Source: issue #2345 (https://github.com/plot-pm/plot/issues/2345). The plan writes nothing to the tracker.
- Unattended run: Review answered `pr` from `Plan PRs: required`; Impl answered `own branches`; State is Draft because the prompt gave no `Design: yes`.
