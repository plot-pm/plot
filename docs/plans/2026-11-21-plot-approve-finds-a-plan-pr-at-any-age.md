# plot-approve finds a plan PR at any age

> For a plan the default branch holds, `plot-approve` asks the host for the PR of the adding merge's second parent in one call, so a plan PR older than the newest 100 merged PRs is found, and a slice on the plan PR's own branch is refused by name.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3608
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3617 merged
- **Started:** 2026-11-21, Jan Wloka, `bug/the-host-names-the-prs-of-a-commit`
- **Started:** 2026-11-21, Jan Wloka, `bug/plot-approve-asks-the-pr-of-the-adding-merge`
- **Started:** 2026-11-23, Jan Wloka, `bug/plot-approve-refuses-a-slice-on-the-plan-branch`

## Changelog

- `plot-approve` finds the merged plan PR of a plan on the default branch whatever its age: where a host credential exists, it asks the host for the PR of the adding merge's second parent in one call, instead of searching the newest 100 merged PRs. This holds for `Impl: own branches`, for `Impl: same branch` and for a spike approval.
- Where the host names no PR for the adding merge, `plot-approve` refuses `pr-merge-unnamed`, names the merge commit and says what to do next, instead of `no PR found for branch 'idea/<slug>'` with advice to push a branch that already merged.
- `plot-approve` refuses `slice-on-plan-branch` for a plan whose slice names the plan PR's own head branch, for `Review: pr` and for `Review: in-session` plans on the default branch, because that slice reads as complete the moment the plan PR merges.

<!-- Board impact: the approve entry's host answers `prsOfCommit` in-process where a host credential exists; every other approve host call (the listings, the merge, the status write) stays on `hostShell`. The refusal list gains two reasons. No plan format, template or `docs/plans` layout change. -->

## Motivation

**The merged route reads one page of 100.** For a plan the default branch holds, `planPrOf` asks for the adding merge (`packages/domain/src/rules/plan-pr.ts:306-308`), then for the merged PRs (`:309`), and takes the one whose head is the merge's second parent (`:310`). `choosePlanPr` answers that ask with `ctx.host.prList('merged', PRS_LISTED)` (`packages/board/src/server/entry/open-prs.ts:210-216`), and `PRS_LISTED` is 100 (`open-prs.ts:5`). A plan PR older than the newest 100 merged PRs is not in the page, the rule answers `none` (`plan-pr.ts:311`), and the approve entry keeps `prBranch` at `idea/<slug>` (`packages/board/src/server/entry/approve.ts:890`, `:946`). The domain then refuses `pr-absent` with `no PR found for branch '<prBranch>'` (`packages/domain/src/workflows/approve.ts:358-362`), and the entry adds *Push the branch* (`approve.ts:512-513`), which is wrong for a branch that merged. `skills/plot-approve/SKILL.md:273` documents the limit: *"one host call, at most 100 merged PRs"*.

**Measured 2026-11-21 on `templates-show-named-identifiers`.** Its plan PR #3478 merged on 2026-11-17T10:22:29Z as merge commit `1d814d0a1`, second parent `0835e43b7`, from `docs/templates-show-named-identifiers`. 104 PRs merged after it, and `gh pr list --state merged --limit 100` starts at #3493. `POST /api/approve` refused `no PR found for branch 'idea/templates-show-named-identifiers'`, and the plan was approved in session instead (`6d11dda37`). The same day, `GET repos/plot-pm/plot/commits/0835e43b7…/pulls` and `GET …/commits/1d814d0a1…/pulls` each answered #3478, state closed, `merged_at` 2026-11-17T10:22:29Z, `merge_commit_sha` `1d814d0a1…`, in one call.

**The merged route names no branch.** `planPrOf` returns `branch: ''` on the merged route (`plan-pr.ts:322`), so `readings.pr.branch` stays `idea/<slug>` although the PR merged from another branch. Nothing then compares the plan PR's head branch with the plan's slice branches. A slice whose branch equals that head branch reads as merged the moment the plan PR merges, so the pulse never opens it and delivery counts it as landed. `templates-show-named-identifiers` hit this: its Notes record that its slice moved to `docs/templates-name-their-identifiers` for that reason (`docs/plans/2026-11-16-templates-show-named-identifiers.md:81` on `origin/main` `c26164274`).

**The same-branch route has the same gap.** The issue's first refusal was `no PR found for branch 'templates-show-named-identifiers'` under `Impl: same branch`. That route never calls `choosePlanPr`: it calls `readPlanPr(ctx, prBranch)` (`packages/board/src/server/entry/approve.ts:905-906`) with `prBranch = sameBranchOf(slug)` (`:890`). `sameBranchOf` returns the bare slug where no `<prefix>/<slug>` ref exists locally or on origin (`approve.ts:301-313`), and the plan PR's branch `docs/templates-show-named-identifiers` was deleted on merge, so the lookup asked for a branch that never had a PR.

**The spike route has the same refusal.** `approveSpike` refuses `pr-absent` with the same text in its own switch (`packages/domain/src/workflows/approve.ts:568-572`).

## Design

### Approach

**One host question by commit.** A new `Host` port operation, `prsOfCommit(sha)`, answers the PRs the host associates with one commit as `readonly Pr[]`, reusing `Pr` (`packages/domain/src/entities/pr.ts:65`). The domain asks it with the adding merge's second parent, which is the PR's head on both hosts. The answer is one call whatever the PR's age.

**The row mapping.** GitHub's `GET /repos/{owner}/{repo}/commits/{sha}/pulls` reports a merged PR as `state: "closed"`. The GitHub mapping derives `state` from `merged_at`: `closed` with a non-null `merged_at` is `MERGED` with `mergedAt` set, `closed` with `merged_at: null` is `CLOSED`, and `open` is `OPEN`. `head` is `head.ref`, `headSha` is `head.sha`, `mergeCommit` is `merge_commit_sha`, and `base`, `draft`, `url` and `author` come from the same row. The fields this endpoint does not carry take the absent values `plot-host.sh pr-list --rich-open` already emits for a terminal row (`mergeable: 'unknown'`, `checks: 'unknown'`, `review: ''`, `failingChecks: []`), which mean *not asked*. Bitbucket's `GET /repositories/{workspace}/{repo}/commit/{sha}/pullrequests` reports `MERGED` as its own state word, with `merge_commit.hash`. Bitbucket answers that endpoint only once its pull-request commit links are indexed: an HTTP 202 or 404 answers `unaskable` and names the reason, and any other failure answers `failed`.

**A reader file and a host wrapper, composed where in-process reads are composed.** A new file `packages/domain/src/adapters/host/prs-of-commit.ts` holds `githubPrsOfCommit(api)`, `bitbucketPrsOfCommit(bitbucket)` and `hostWithPrsOfCommit(host, reader)`, on the pattern of `pr-conversation.ts` (`githubPrConversation` `:39`, `bitbucketPrConversation` `:100`, `hostWithConversation` `:154`). `hostReadsFor` wraps both in-process compositions with it (`host-reads.ts:248-250` for Bitbucket, `:259` for GitHub). Without that wrapper, `hostWithListing` copies every shell member (`host-reads.ts:126-132`), and `prsOfCommit` would reach the shell on every transport. The shell `Host` answers `unaskable` with no call, as `prConversation` does (`host-shell.ts:649-650`). `host-fixture.ts` gains the operation. The change adds no shell line, so `scripts/check-shell-lines.sh` has nothing to offset, and the HTTPS calls stay under `packages/domain/src/adapters/host/`, which `scripts/check-host-https-callers.sh` allows.

**The approve entry adds only `prsOfCommit` in-process.** `approve.ts:778` builds `hostShell(context)`. The entry keeps `hostShell` for every operation and replaces only `prsOfCommit` with the one `hostReadsFor` composes. An exported builder in `approve.ts` (for example `approveHostOf`) makes that composition testable outside `perform`. `prList`, the merge and the `plot/review` status write stay on the shell, so the open route, the batch route (`test/reconcile/approve-batch.test.mjs`) and the merge behave as today.

**The rule asks by commit first, and the list is the fallback.** `planPrOf`'s merged route (`plan-pr.ts:306-327`) changes:

1. After `addition`, it asks `commit` (a new `PlanPrReadings.byCommit` field: `readonly Pr[]`, or `'unaskable'`).
2. It takes the row whose `state` is `MERGED`, whose `headSha` matches the second parent (`shaMatches`, `plan-pr.ts:208`) and whose `mergeCommit` equals `addition.sha`. The row carries both facts the `confirm` ask reads today, so this route asks no `confirm`. The answer names the row's `head` as `branch`.
3. Where `byCommit` is `'unaskable'`, the rule asks `merged` and `confirm` as today, and `MergedPr` gains `head` so the fallback also names the branch.
4. Where no row or listed PR matches, including an empty `[]` answer, the rule answers a new outcome `{ outcome: 'unnamed', mergeCommit, via: 'commit' | 'list' }` instead of `none`. A file that arrived by squash or direct push has no second parent and still answers `none` (`plan-pr.ts:308`).

`choosePlanPr` (`open-prs.ts:161-233`) answers the `commit` ask with `ctx.host.prsOfCommit(secondParent)`; a `failed` answer throws `refuseOnHostFailure` as the `merged` ask does at `:212-214`. It passes `unnamed` through. `needs-design.ts:358` and `interrogate.ts:207` read `unnamed` as they read `undefined` today.

**The same-branch route takes the merged route on the default branch.** Where `sameBranch` holds and the default branch holds the plan file, the entry calls `choosePlanPr` with `onMain: true` instead of `readPlanPr(ctx, sameBranchOf(slug))` (`approve.ts:905-906`), so a same-branch plan PR that merged from another branch, or whose branch is gone and `sameBranchOf` fell back to the bare slug (`approve.ts:301-313`), is found by its adding merge. A same-branch plan not on the default branch keeps `readPlanPr` as today. Under `same branch` the approval merges nothing, so a found MERGED PR approves with `merged=already`.

**The spike route takes the same route.** `approveSpike` (`workflows/approve.ts:568-572`) reads the same `readings.pr`, and refuses `pr-merge-unnamed` before `pr-absent` in its own switch.

**A named refusal for an unnamed merge.** `ApproveReadings.pr` gains `unnamedMerge?: { sha: string; via: 'commit' | 'list' }`, and both `approve` and `approveSpike` refuse `pr-merge-unnamed` before `pr-absent` (`workflows/approve.ts:358`, `:570`). The entry's `refusalText` (`approve.ts:476`) prints, for `via: 'commit'`:

`the merge commit <sha> added <plan file>, and the host could not name its PR.`
`  Check the merge commit on the host, or approve in session: plot-approve-command.mjs --who <handle> <slug>. Nothing was merged and the phase is unchanged.`

and for `via: 'list'`:

`the merge commit <sha> added <plan file>, and the host could only search its newest 100 merged PRs.`
`  Set a host credential so plot-approve can ask the host by commit, or approve in session: plot-approve-command.mjs --who <handle> <slug>. Nothing was merged and the phase is unchanged.`

`skills/plot-approve/SKILL.md:273` states the new route and the refusal.

**A slice on the plan PR's branch is refused.** The workflow refuses `slice-on-plan-branch` where `impl` is not `same-branch`, the plan PR is found (`MERGED` or `OPEN`), `readings.pr.branch` is not empty, and a slice branch in `readings.branches` equals it. The detail names the branch and the PR, and the entry adds the next action: *"slice `<branch>` is the plan PR's head branch (#N); its merge reads as this slice landing.
  Rename the slice's branch in the plan, then re-run. Nothing was merged and the phase is unchanged."* It returns no writes. Its position: after `pr-closed`, `pr-merge-unnamed` and `pr-absent` (it needs a found PR), and before `checkout-copy-differs`, `pr-copies-differ` and `pr-ambiguous`, so it fires before any write, including the plan PR's merge on the open route.

It also covers an in-session plan on the default branch. Under `Plan PRs: required` an in-session plan still reaches main through a plan PR, and `templates-show-named-identifiers` was one. Where `Review: in-session` holds and the default branch holds the plan file, the entry reads the adding merge and asks `prsOfCommit` once (no list fallback, no `confirm`) to name the PR's branch, and sets `readings.pr.branch` and `readings.pr.number` from a matching row. An `unaskable`, `failed` or unmatched answer leaves the branch empty, so the check does not fire and nothing is refused: an in-session plan needs no PR. For an in-session plan the check sits after the in-session checks the workflow runs today and before any write.

The check sits in `approve` because approval is the last step before dispatch and the one step that reads the plan PR's branch. `/plot-idea` names `idea/<slug>` for a plan PR under `own branches` and does not see a later merge from another branch. Under `same branch` the plan PR is the implementation PR by design, so the check does not apply.

**Tests per slice:**

- *Host:* `packages/domain/test/host-prs-of-commit.test.ts` — GitHub asks `/repos/o/r/commits/<sha>/pulls` once; `closed` with `merged_at` maps to `MERGED` with `mergedAt`, `closed` with `merged_at: null` maps to `CLOSED`, and head, head sha, merge commit and base map; an empty array answers `[]`; an HTTP failure answers `failed`; Bitbucket asks `/repositories/w/r/commit/<sha>/pullrequests` and maps `merge_commit.hash`; a Bitbucket 202 and a Bitbucket 404 each answer `unaskable` and name the reason. `packages/domain/test/host-reads.test.ts` — on an in-process GitHub composition and an in-process Bitbucket composition, `prsOfCommit` asks the client; on the shell transport (`PLOT_HOST_TRANSPORT=shell`) it answers `unaskable`. `packages/domain/test/host-shell.test.ts` — the shell answers `unaskable` and spawns nothing.
- *Approve route:* `packages/domain/test/rules-plan-pr.test.ts` — an adding merge asks `commit`; of two rows, the one that matches the second parent and the merge commit answers `found` with its branch and no `confirm` ask; `[]` answers `unnamed` with `via: 'commit'` and no `merged` ask; a row whose merge commit differs answers `unnamed`; `unaskable` asks `merged`, and the fallback names the listed PR's branch, or answers `unnamed` with `via: 'list'`; a squash or direct push answers `none` as today. `packages/domain/test/workflows-approve.test.ts` — `pr-merge-unnamed` names the merge commit and outranks `pr-absent`. `packages/domain/test/approve-spike.test.ts` — a spike approval with an unnamed merge refuses `pr-merge-unnamed`, and one whose PR the commit answer names approves the spike. `packages/board/test/unit/approve.test.ts` — a plan whose adding merge's PR is absent from the fake host's newest 100 merged PRs approves through `prsOfCommit`, and `prList('merged')` is never called; a same-branch plan on the default branch whose plan PR merged from `docs/<slug>`, with no `<prefix>/<slug>` ref left so `sameBranchOf` answers the bare slug, approves with the PR named; a same-branch plan not on the default branch with no prefixed ref still refuses `pr-absent` for the bare slug; a plan added by a squash refuses `pr-absent` as today; both `pr-merge-unnamed` texts above are asserted line by line. `packages/board/test/unit/approve-host.test.ts` — the entry's host builder answers `prsOfCommit` from the composed in-process host, and `prList`, `prMerge` and the status write from the shell host. `packages/board/test/unit/needs-design.test.ts` — a merged-route plan whose PR the host cannot name reads as no PR, as today. `packages/board/test/unit/interrogate-route.test.ts` — the pre-filled empty addition answers `none` and `prsOfCommit` is never asked.
- *Slice branch:* `packages/domain/test/workflows-approve.test.ts` — a slice on the merged plan PR's branch refuses `slice-on-plan-branch` with no writes; the same plan under `same branch` passes; a slice on another branch passes; an open-route plan PR whose head is a slice branch refuses before the `pr-merge` write; a plan with both a slice on the plan branch and a differing checkout copy refuses `slice-on-plan-branch`; an in-session plan on the default branch whose adding merge's PR names a slice branch refuses; an in-session plan whose commit answer is `unaskable` approves. `packages/board/test/unit/approve.test.ts` — the refusal text names the branch, the PR and the next action, and an in-session plan on the default branch asks `prsOfCommit` once and no list.

### Open Questions

- [x] Does the shell transport need its own `plot-host.sh pr-of-commit` op? Decided by the operator 2026-11-21: no. With no host credential the route falls back to the newest 100 merged PRs and refuses `pr-merge-unnamed` with `via: 'list'`, whose text names the credential as the repair.

## Slices

### Host

- `bug/the-host-names-the-prs-of-a-commit` — `Host.prsOfCommit(sha)` on the port answering `readonly Pr[]`, `prs-of-commit.ts` with the GitHub and Bitbucket readers and `hostWithPrsOfCommit`, the wiring in `hostReadsFor` at both backends, Bitbucket's `unaskable` on 202 and 404, the shell's `unaskable`, the fixture, and the tests <!-- builds: Host.prsOfCommit, the PRs a host associates with one commit --> → #3625

### Approve route

- `bug/plot-approve-asks-the-pr-of-the-adding-merge` — `planPrOf`'s `commit` ask with the list fallback and the `unnamed` outcome, `choosePlanPr`'s answer, the entry's `approveHostOf` with only `prsOfCommit` in-process, the same-branch route on the default branch, `pr-merge-unnamed` in `approve` and `approveSpike` with its two texts, `SKILL.md:273`, a changeset, and the tests <!-- builds: pr-merge-unnamed, the plan-PR lookup by commit --> <!-- waits: bug/the-host-names-the-prs-of-a-commit --> → #3653

### Slice branch

- `bug/plot-approve-refuses-a-slice-on-the-plan-branch` — the `slice-on-plan-branch` refusal in `workflows/approve.ts` at its stated position, the in-session read of the adding merge's PR branch, its entry text, a `SKILL.md` sentence, a changeset, and the tests <!-- builds: slice-on-plan-branch, the approve refusal for a slice on the plan PR's branch --> <!-- waits: bug/plot-approve-asks-the-pr-of-the-adding-merge -->

## Notes

- `skills/plot/scripts/plot-deliverable-search.sh` found no existing deliverable for `pr-of-commit`, `commit pulls`, `merge commit PR`, `plan PR branch slice` or `slice on plan branch`. The only hits were unrelated: `pulls/<n>` reads in `adapters/host/pr-conversation.ts`, and `plot-reconcile-scan.sh` section headings. `Host.prMergeDests` (`packages/domain/src/ports/host.ts:426`) asks by head branch, not by commit, so it does not answer a plan PR whose branch is unknown.
- The issue cites `approve.ts:925-946` as `choosePlanPr`. On `origin/main` (`d40c8dc7d`, and unchanged in these files at `c26164274`) that range is its call site (`approve.ts:932`); the function and the list call are in `open-prs.ts:161-233`.
- The issue measured the newest-100 page starting at #3490; on 2026-11-21 it started at #3493, with 104 PRs merged after #3478.
- The third slice waits on the second because the merged route names no branch until the second slice sets it from the answer's `head`.
- `needs-design` builds its own `hostShell(context)` (`needs-design.ts:299`), so its `commit` ask answers `unaskable` and it keeps the newest-100 limit; this plan changes only that it receives `unnamed` instead of `none` and reads it as no PR. `interrogate` pre-fills an empty addition (`interrogate.ts:209`) and cannot reach the merged route.
- The approve entry composes only `prsOfCommit` in-process. Moving `prList`, the merge and the status write to `hostReadsFor`, as `merge-ports.ts:35-42` does, is a separate change and is not made here.
- Panel round 1 (2026-11-21): the estate, testability and user jurors answered amend. Every finding is resolved in Design and Slices above.
