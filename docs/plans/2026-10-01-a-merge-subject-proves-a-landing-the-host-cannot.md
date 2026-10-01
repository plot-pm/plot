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

- On Bitbucket, the fleet scan and the supervisor read a `Merged in <branch> (pull request #N)` commit on the default branch as proof that a branch without a ref merged. A merged slice no longer needs the host to answer before the next slice can be offered; under a refused host the next slice still needs one host answer about itself.
- On GitHub, a merge subject counts only when it names the repository's own owner, compared without case. Where the owner cannot be read, as for a local-path origin, any owner counts, as today.
- A merge subject older than the plan that names the branch proves nothing for that plan, so a reused branch name does not settle a slice nobody started.

## Motivation

Measured 2026-10-01 on a Bitbucket repository (`ewz-kus-portal`, Plot 2.22.1, `bb` 1.9.0), reported in #1139:

- PR #3644 merged and deleted `feature/ewzkus-3845-contractaccount-bykey-tracer`. `develop` carries `Merged in feature/ewzkus-3845-contractaccount-bykey-tracer (pull request #3644)`.
- The supervisor tick reported `held on merge-unknown (1)` for that branch, which is the plan's first slice. `plot-host.sh pr-merged` returned HTTP 429, then `unknown`.
- The plan's only unmerged slice was held `not-claimable` while a free agent waited, and a person started it by hand.

The same repository, counted read-only on 2026-10-01: `git log origin/develop --merges --grep='^Merged in '` returns **1723**, and the same query with `--no-merges` returns **0**. Every `Merged in` subject is a two-parent merge, so `--merges` loses none. `develop` holds 2289 merges in all; the other 566 include 13 backward `Merge remote-tracking branch 'origin/develop'` merges and older `Pull request #N: <title>` merges from before 2024-01-23, when the repository moved from Bitbucket Data Center to Bitbucket Cloud. All 1723 `Merged in` subjects fall inside the scan's 2000-merge cap.

Three readers decide whether a refless branch landed, and none reads the Bitbucket subject. Verified against `origin/main` at `63893100`:

| Reader | Where | Reads a merge subject |
|---|---|---|
| Fleet scan, per branch | `plot-fleet-scan.sh:2183` `merged_by_subject` → `rules/branch-state.ts:189` | GitHub form only: `^Merge pull request #N from [^/]+/<branch>$` |
| Fleet scan footer | `plot-fleet-scan.sh:492` `MERGE_DETECT` | GitHub form only, so a Bitbucket estate reports `merge_detect=none` |
| Supervisor queue | `packages/board/src/server/queue-reading.ts:237` `world.mergedBranches()` → `landedWithoutListing` → `queueOfPlan(plan, claimed, merged)` | None. The host's listing, then #1143's index rows and `pr-state <n>` |
| Worker loop, offline | `plot-worker-loop.sh:2213` `plot-fleet-scan.sh --offline --why-nothing` (`:594` documents the former `--offline --next`) | Through the scan. Offline, a refless Bitbucket branch reads `open` today |

The measured hold is the supervisor's. A fix in the scan alone leaves it in place: `queueOfPlan` takes its `merged` set from the host and from nothing else.

**What remains held after this plan.** Two panel jurors reproduced the fix in round 1 with the listing and the per-branch question both refused. The merged predecessor is released, and the next slice is then held on `merge-unknown` about its own branch. `readQueue` asks `world.queuedHasLanded(<next>)` (`queue-reading.ts:253-256`), which is `host.prMerged`, and an unstarted branch has no index row and no PR number for `landedWithoutListing` to use. The scan asks `merged_by_host` for the same branch and reads `unknown` under 429, and `--next` and `--list-eligible` offer only `open` (`eligible.ts:139-170`). The gain is that one per-branch host answer now releases the next slice, where the whole listing was needed before. No host-free answer for an unstarted branch exists: the PR index never says no, and a refless branch with no subject may be a squash merge whose ref was deleted. That question belongs to #1094.

A GitHub panel juror measured the existing GitHub reading on 2026-10-01 (`.plot/panels` round on #1139): 122 of 200 merged PRs found by subject, 0 branch mismatches, 0 merge-commit mismatches against the host, 0 false positives. The 78 misses are squash or rebase merges with one parent, and each falls through to the host as it does today. It also found 22 first-parent subjects that name another owner: `eins78` ×20 (this repository's PRs #16-#19 from before its transfer) and four contributor forks. The current `[^/]+/` accepts all 22.

## Design

### Approach

**A merge subject is positive evidence for a branch with no ref, in the wave gate only.** The scan has used the GitHub form this way since 2026-08-16 (`6c66b389`). This plan adds the Bitbucket form, moves the decision into the domain, and gives the supervisor the same reading.

**The rule is vendor-free.** `rules/merge-subject.ts` exports `mergedBySubject({ subjects, branches, forms, owner })`. A form is a template with three placeholders, `<branch>`, `<number>` and `<owner>`. The rule matches each subject as a whole line: the branch as literal text, the owner as literal text compared without case, the number as one or more digits. An `owner` of `null` matches any owner. It answers the set of branches some subject names. An empty form list answers an empty set. The rule names no host.

**One owner parser.** `rules/remote-owner.ts` exports `ownerOfRemote(url)`. It answers the path segment before the repository name for `https://<host>/<owner>/<repo>[.git]`, `ssh://git@<host>/<owner>/<repo>[.git]` and `git@<alias>:<owner>/<repo>[.git]`, lowercased, and `null` for a local path or any other shape. An SSH host alias such as `github-work` changes nothing, because the owner is the segment after the colon. The scan passes the `origin` URL to the bundle and never parses it; the supervisor reads it through `refs.remoteUrl` (`ports/refs.ts:339`) and calls the same function. `null` keeps today's answer, so `test/reconcile/fleet.test.mjs:845-900`, whose origin is a bare local path, stays green.

**The forms live in the host adapter.** `adapters/host/merge-subjects.ts` maps a backend word to its forms, as data only:

| Backend | Form |
|---|---|
| `github` | `Merge pull request #<number> from <owner>/<branch>` |
| `bitbucket` | `Merged in <branch> (pull request #<number>)`, Bitbucket Cloud's default merge message |
| any other | none |

A backend with no forms proves nothing, and every branch falls through to the host as today. Bitbucket Data Center's `Pull request #N: <title>` names no branch in its subject; `plot-host.sh` drives only `bitbucket.org`, so it gets no form. The module is imported by subpath, as `entry/branch-state.ts:24-27` does for its rule, so a bundle does not pull the adapters barrel; slice 1 adds the subpath export to `packages/domain/package.json`.

**A subject older than the plan proves nothing for it.** A later plan may reuse a merged branch name; on Jira-keyed GitFlow estates a reopened ticket does this. Round 1 executed the case: an unstarted reused name read `merged` (`bug/flaky — merged`), its slice read complete, the next slice opened, and the reused slice was never offered. So the subjects for a plan come from the merges its adding commit does not contain: `git log <main> ^<added> --merges --pretty=%s --max-count=<cap>`, where `<added>` is `git log --diff-filter=A --format=%H -1 -- <plan file>`. That is one git call per plan that names a refless branch, and only for such plans. The adapter line carries `# plot-ancestry: evidence — the rule decides; a wrong "contained" answer sends the branch to the host, a wrong "not contained" answer is the reused-name case this narrows`. A plan whose adding commit cannot be read gets no subjects, and its branches go to the host.

**The scan asks through a bundle, once per scan, after it parses the plans.** A new bundle, `plot-merge-subject.mjs`, reads stdin in sections: the backend word, the `origin` URL, then one section per plan with its refless branches and its subjects. It answers the branches proven, per plan, and the detection word. The scan reads the backend from `plot-host.sh backend` (`:3216`), a local read. The call goes after plan parsing, because the plan branches and their adding commits are known only then. `merged_by_subject` becomes a set lookup in the no-ref arm (`plot-fleet-scan.sh:3353`). The shell regexes at `:2185` and `:492` are removed. **A branch the subject proved is not asked of the host**: the unconditional `merged_by_host` after `:3353` is skipped for it, which removes one host call per proven branch per scan under the throttle that caused the hold.

**`merge_detect=unaskable` stays, and it is documented.** It is the footer word when this bundle alone cannot answer; every refless branch then goes to the host, which is today's behaviour on Bitbucket. A missing `plot-branch-state.mjs` still exits 2 first (`:3531-3533`). `skills/plot-pulse/SKILL.md:176` lists the word with the others.

**The supervisor reads the same rule at a named seam.** `readQueue` reads only through `QueueWorld` (`queue-reading.ts:27-80`), and `queueWorldForRepo` (`entry/registryd-main.ts`) builds it. Slice 2 adds:

- `QueueWorld.subjectProven(plans)`: the branches the rule proves, per plan, or `null` when it cannot ask. `queue-reading.ts` receives a set of branches and never a backend word, because a vendor word there falls outside the vendor gate's root.
- Its implementation in `queueWorldForRepo` over a new refs-port op `mergeSubjects(ref, since, max)` (`git log <ref> ^<since> --merges --pretty=%s`; `commitsSync` runs `--no-merges` at `refs-git.ts:380` and cannot serve), `refs.remoteUrl`, `ownerOfRemote` and `host.backend()` (`registryd-main.ts:607`).
- The union into `merged` **before `landedWithoutListing`** (`queue-reading.ts:239-241`) as well as before `queueOfPlan`, so a proven branch spends neither an index lookup nor a `viewLanded` call.
- **The union applies only when the ref list was read.** `claimedBranches` answers `new Set(['*'])` on failure (`registryd-main.ts:556-560`), and `'*'` excludes no branch. With that sentinel, the union is skipped and the queue reads as it does today.

`queueOfPlan` settles a slice on `claimed || merged` (`queue-reading.ts:144-145`), so a ref already settles a branch, and a refless restriction on the union would change no queue. The union is therefore not restricted through `claimed`. A ref-carrying name is still excluded from the proof, so it is never reported `landed` and never skips its own host question.

**What stays as it is:**

- **The ref check stays in front in the scan.** A branch with a ref never reaches the subject arm (`branch-state.ts:170-182`).
- **Nothing is cached.** The walk is local and runs every pass (7.7 ms at cap 500, 11.8 ms uncapped at 2000 merges, `plot-fleet-scan.sh:463-464`). A cached `merged` would outlive a recreated branch.
- **`--merges` and reachability stay; first-parent stays out.** The scan's header measured a first-parent filter at 108 against 108 and recorded that it breaks GitFlow (`:439-446`).

**No destructive decision reads the subject, and a gate holds it.** Readers of the subject-derived `merged` state:

| Reader | What it does | What re-gates it |
|---|---|---|
| Wave gate, queue | offers the next slice | nothing needed; reversible |
| `auto-dispatch.ts:159` `mergedBranches(pulse)` | calls an agent free | an agent's branch has a claim ref and never reaches the subject |
| `auto-deliver.ts:254` `landedBranches`, `allSlicesMerged` | triggers a delivery | `plot-deliver.sh:179` → `plot-ask.mjs deliverable` → `controllers/deliverability.ts:86` `host.prMerged`, `unknown` counts as not merged |
| `deliver.ts:230` | the board's Deliver verdict | the same delivery re-gate |
| reap, ref deletion | removes a desk or a ref | `plot-reap.sh` and `plot-release-refs.sh:213` read `pr_merged` |

The gate is an import test in `packages/board/test/unit/`: `mergedBySubject` and `ownerOfRemote` are imported only by the bundle entry and `entry/registryd-main.ts`, and `mergeSubjects` is called only there; `rules/landed.ts`, `mayRemove`, `controllers/deliverability.ts` and `sliceHasMerged` import none of them. A second test runs the deliverability controller for a plan whose only branch is proven by subject while the host answers not merged, and asserts the delivery refuses. On a throttled Bitbucket estate the trigger still starts a delivery check for a subject-proven plan, and each check asks the host again; that cost is stated, not removed.

**The board row.** A slice the subject proved reads `merged` in the scan. `fleet.ts:5099-5106` puts it in DONE with the note `merged`, or `merged — slice still open`. Its PR column is empty, because the PR row comes from the host's listing, which the throttle refused. The plan adds no source label; slice 1's fixture asserts this row through `/api/fleet`.

**CLAUDE.md, "One Answer To 'Did This Land'", states its real scope.** Destructive decisions read the host's `mergedAt`. The wave gate also takes a host-written merge subject on the default branch, newer than the plan, as positive evidence for a branch with no ref. That has been true for GitHub since 2026-08-16 and the section does not say so.

**A Concept file, `docs/domain/merge-subject.md`,** names the term, the three placeholders, the age rule and the boundary above, in the format of `docs/domain/desk-root.md`.

**The corpus copy becomes a call.** `packages/domain/corpus/branch-state.corpus.test.ts:226-230` holds a third copy of the GitHub regex, any owner. Slice 1 replaces it with `mergedBySubject` and the adapter's forms.

### Open Points

- [ ] Bitbucket's squash strategy is not used on `ewz-kus-portal` (0 `Merged in` subjects on one-parent commits against 1723 on merges). An estate that squashes would lose the proof to `--merges` and fall through to the host. This plan does not drop `--merges`.
- [ ] Out of scope, to be filed as its own issue: `claimedBranches`' `{'*'}` sentinel is read by nothing in `packages/` (`git grep "has('\*')"` has no hit), so the comment "AN UNREADABLE REF LIST QUEUES NOTHING" at `registryd-main.ts:556` does not hold today. This plan only refuses to add its union under that sentinel.
- [ ] Out of scope: a host-free answer for an unstarted branch under 429 belongs to #1094.
- [ ] `plot-reconcile-scan.sh` §22 reads the GitHub form to find a PR number (`:2795`, `:2836`). It reports and gates nothing, so it stays out of this plan.

## Slices

### The merge subject is one rule (Branch: bug/the-merge-subject-is-one-rule)

`rules/merge-subject.ts` and `rules/remote-owner.ts` with tests at 100% branch coverage; `adapters/host/merge-subjects.ts` as data with its subpath export; the `plot-merge-subject.mjs` bundle with its `packages/board/build.mjs` entry, its `.gitattributes` line, and a CLAUDE.md Helper Scripts row; the scan's call after plan parsing, the per-plan `^<added>` walk with its ancestry declaration, the skipped `merged_by_host` for a proven branch, and the removal of both shell regexes; the `unaskable` footer word and its `skills/plot-pulse/SKILL.md` entry; the corpus copy replaced; the Concept file and the CLAUDE.md amendment. Fixture tests through the scan: both forms, a backward merge, a fork owner, an owner in other case, a prefix-sharing branch name, a local-path origin, and a reused branch name whose merge predates its plan, which reads `open`. A Bitbucket fixture with the first slice's ref deleted and every PR question refused with 429 asserts that the first slice reads `merged`, the host log holds no question about it, `--list-eligible` names nothing for the unstarted next slice, and `/api/fleet` shows the first slice in DONE with note `merged` and no PR. <!-- builds: mergedBySubject, ownerOfRemote, the merge-subject rule and its bundle -->

### The queue reads the merge subject (Branch: bug/the-queue-reads-the-merge-subject)

`mergeSubjects` on the refs port with its git and fixture adapters; `QueueWorld.subjectProven` and its `queueWorldForRepo` wiring; the union before `landedWithoutListing` and `queueOfPlan`; the skip under the `{'*'}` sentinel; the import-graph gate and the deliverability refusal test. Queue tests with the listing **and** `queuedHasLanded` refusing with 429: the proven predecessor spends no host call and no index lookup, and the next slice is held on `merge-unknown` about its own branch; with `queuedHasLanded` answering `not-landed`, the next slice is handed out. A test with `claimedBranches` answering `{'*'}` and a subject naming an in-flight branch adds nothing to `merged`. A test with a subject older than the plan adds nothing. <!-- builds: mergeSubjects, subjectProven, a refs-port reading of merge subjects -->

## Notes

Filed from a Bitbucket estate on 2026-10-01. A juror answered `amend` the same day and scoped the change to the scan; reading the code for this plan found that the measured hold is the supervisor's, which reads no subject at all, so the second slice is added. Round 1 (three jurors, unanimous amend) found that the next slice stays held on its own host question, that the reused-name and `{'*'}` cases reach the queue, that delivery reads the subject-derived state, and that a third copy of the rule lives in the corpus tier; this text carries those answers. Related: #1094, #1143 (number lookups under a refused listing), #1140.
