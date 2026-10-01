# A merge subject proves a landing the host cannot

> On Bitbucket, a branch merged and deleted is proven merged by the `Merged in <branch> (pull request #N)` commit on the default branch. Plot reads only GitHub's merge subject, so under HTTP 429 the branch reads `unknown` and every later slice of its plan is held.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-fleet-runs-through-its-limits
- **Issue:** #1139
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- On Bitbucket, the fleet scan and the supervisor read a `Merged in <branch> (pull request #N)` commit on the default branch as proof that a branch without a ref merged, so a throttled host no longer holds the slices behind it.
- On GitHub, a merge subject counts only when it names the repository's own owner, so a fork's branch of the same name is not read as this repository's.

## Motivation

Measured 2026-10-01 on a Bitbucket repository (`ewz-kus-portal`, Plot 2.22.1, `bb` 1.9.0), reported in #1139:

- PR #3644 merged and deleted `feature/ewzkus-3845-contractaccount-bykey-tracer`. `develop` carries `Merged in feature/ewzkus-3845-contractaccount-bykey-tracer (pull request #3644)`, one of 1720 such subjects.
- The supervisor tick reported `held on merge-unknown (1)` for that branch, which is the plan's first slice. `plot-host.sh pr-merged` returned HTTP 429, then `unknown`.
- The plan's only unmerged slice was held `not-claimable` while a free agent waited, and a person started it by hand.

Two readers decide whether a refless branch landed, and neither reads the Bitbucket subject. Verified against `origin/main` at `3f916d15`:

| Reader | Where | Reads a merge subject |
|---|---|---|
| Fleet scan, per branch | `plot-fleet-scan.sh:2183` `merged_by_subject` → `rules/branch-state.ts:189` | GitHub form only: `^Merge pull request #N from [^/]+/<branch>$` |
| Fleet scan footer | `plot-fleet-scan.sh:492` `MERGE_DETECT` | GitHub form only, so a Bitbucket estate reports `merge_detect=none` |
| Supervisor queue, wave gate | `queue-reading.ts:237` `mergedBranches()` → `queueOfPlan(plan, claimed, merged)` | None. The host's listing, then #1143's index rows and `pr-state <n>` |

The measured hold is the supervisor's, in the third row. A fix in the scan alone leaves it in place: `queueOfPlan` takes its `merged` set from the host and from nothing else.

A GitHub panel juror measured the existing GitHub reading on 2026-10-01 (`.plot/panels` round on #1139): 122 of 200 merged PRs found by subject, 0 branch mismatches, 0 merge-commit mismatches against the host, 0 false positives. The 78 misses are squash or rebase merges with one parent, and each falls through to the host as it does today. It also found 22 first-parent subjects that name a fork or a predecessor owner (`eins78` ×20 and four others), which the current `[^/]+/` accepts.

## Design

### Approach

**A merge subject is positive evidence for a branch with no ref, in the wave gate only.** The scan has used the GitHub form this way since 2026-08-16 (`6c66b389`). This plan adds the Bitbucket form, moves the decision into the domain, and gives the supervisor the same reading.

**The rule is vendor-free.** `rules/merge-subject.ts` exports `mergedBySubject({ subjects, branches, forms, owner })`. A form is a template with three placeholders, `<branch>`, `<number>` and `<owner>`. The rule matches each subject as a whole line: the branch and the owner as literal text, the number as one or more digits. It answers the set of branches some subject names. An empty form list answers an empty set. The rule names no host.

**The forms live in the host adapter.** `adapters/host/merge-subjects.ts` maps a backend word to its forms:

| Backend | Form |
|---|---|
| `github` | `Merge pull request #<number> from <owner>/<branch>` |
| `bitbucket` | `Merged in <branch> (pull request #<number>)` |
| any other | none |

`<owner>` is the repository's own owner, read from the `origin` URL by the adapter. A backend with no forms proves nothing, and every branch falls through to the host as today.

**The scan asks through a bundle, once per scan.** A new bundle, `plot-merge-subject.mjs`, takes the subjects on stdin and the backend, owner and plan branches as arguments. It answers the branches proven and the detection word (`pr-merge`, `truncated`, `none`). The scan calls it once after its existing `MERGE_SUBJECTS` walk, so the cost is one node start per scan and not per branch. `merged_by_subject` becomes a set lookup and keeps its place in the no-ref arm (`plot-fleet-scan.sh:3353`). The shell regex at `:2185` and `:492` is removed, so no second copy of the rule exists to drift. Where the bundle cannot be asked, the set is empty and the footer says `merge_detect=unaskable`; every refless branch goes to the host, which is today's behaviour on Bitbucket.

**The supervisor reads the same rule.** The refs port gains `mergeSubjects(ref, max)`, which reads `git log <ref> --merges --pretty=%s`. The existing `commitsSync` excludes merges and cannot serve. `readQueue` adds the branches `mergedBySubject` proves, restricted to branches with no ref, to the `merged` set before `queueOfPlan`. A queued branch the subject proves answers `landed` without the per-branch host question.

**What stays as it is:**

- **The ref check stays in front.** A reused branch name has a ref and never reaches the subject (`branch-state.ts:170-182`). The supervisor applies the same restriction through `claimed`.
- **Nothing is cached.** The walk is local and runs every pass (7.7 ms at cap 500, 11.8 ms uncapped at 2000 merges, `plot-fleet-scan.sh:463-464`). A cached `merged` would outlive a recreated branch.
- **`--merges` and reachability stay; first-parent stays out.** The scan's header measured a first-parent filter at 108 against 108 and recorded that it breaks GitFlow (`:439-446`).
- **No destructive decision reads the subject.** `rules/landed.ts`, `mayRemove`, `plot-pr-merged.sh`, `plot-reap.sh`, `plot-release-refs.sh` and the supervisor's `sliceHasMerged` keep the host's answer. A deleted ref cannot be re-created, so evidence the host did not give does not license one.

**CLAUDE.md, "One Answer To 'Did This Land'", states its real scope.** Destructive decisions read the host's `mergedAt`. The wave gate also takes a host-written merge subject on the default branch as positive evidence for a branch with no ref. That has been true for GitHub since 2026-08-16 and the section does not say so.

**A Concept file, `docs/domain/merge-subject.md`,** names the term, the three placeholders and the boundary above, in the format of `docs/domain/desk-root.md`.

### Open Points

- [ ] Whether Bitbucket's squash strategy writes the same subject on a one-parent commit is not measured. `--merges` excludes such a commit, so the branch falls through to the host. Measure before dropping `--merges` for Bitbucket; this plan does not drop it.
- [ ] `plot-reconcile-scan.sh` §22 reads the GitHub form to find a PR number (`:2795`, `:2836`). It reports and gates nothing, so it stays out of this plan.

## Slices

### The merge subject is one rule (Branch: bug/the-merge-subject-is-one-rule)

`rules/merge-subject.ts` and its tests at 100% branch coverage, `adapters/host/merge-subjects.ts` with the two forms and the owner read from `origin`, the `plot-merge-subject.mjs` bundle, the scan's call to it in place of the two shell regexes, the `unaskable` footer word, the Concept file, and the CLAUDE.md amendment. A fixture repository with both forms, a backward merge, a fork owner and a prefix-sharing branch name proves the scan's answers. A Bitbucket fixture with the first slice's ref deleted and the host stubbed to 429 reads that slice `merged` and the next slice `eligible`. <!-- builds: mergedBySubject, the merge-subject rule and its bundle -->

### The queue reads the merge subject (Branch: bug/the-queue-reads-the-merge-subject)

`mergeSubjects` on the refs port, its git and fixture adapters, and the `readQueue` union restricted to refless branches. A test with the listing refused by HTTP 429 and a Bitbucket subject on the default branch holds nothing on `merge-unknown`, makes the next slice claimable, and spends no host call on the proven branch. A test with a ref present for the same name keeps the slice outstanding. <!-- builds: mergeSubjects, a refs-port reading of merge subjects -->

## Notes

Filed from a Bitbucket estate on 2026-10-01. A juror answered `amend` the same day and scoped the change to the scan; reading the code for this plan found that the measured hold is the supervisor's, which reads no subject at all, so the second slice is added. Related: #1094, #1143 (number lookups under a refused listing), #1140.
