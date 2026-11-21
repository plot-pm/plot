# plot-approve finds a plan PR at any age

> For a plan the default branch holds, `plot-approve` asks the host for the PR of the adding merge's second parent in one call, so a plan PR older than the newest 100 merged PRs is found, and a slice on the plan PR's own branch is refused by name.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3608
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-approve` finds the merged plan PR of a plan on the default branch whatever its age: it asks the host for the PR of the adding merge's second parent in one call, instead of searching the newest 100 merged PRs.
- Where the host names no PR for the adding merge, `plot-approve` refuses `pr-merge-unnamed` and names the merge commit, instead of `no PR found for branch 'idea/<slug>'` with advice to push a branch that already merged.
- `plot-approve` refuses `slice-on-plan-branch` for a plan whose slice names the plan PR's own head branch, because that slice reads as complete the moment the plan PR merges.

<!-- Board impact: the approve entry composes its host through `hostReadsFor`, and the refusal list gains two reasons. No plan format, template or `docs/plans` layout change. -->

## Motivation

**The merged route reads one page of 100.** For a plan the default branch holds, `planPrOf` asks for the adding merge (`packages/domain/src/rules/plan-pr.ts:306-308`), then for the merged PRs (`:309`), and takes the one whose head is the merge's second parent (`:310`). `choosePlanPr` answers that ask with `ctx.host.prList('merged', PRS_LISTED)` (`packages/board/src/server/entry/open-prs.ts:210-216`), and `PRS_LISTED` is 100 (`open-prs.ts:5`). A plan PR older than the newest 100 merged PRs is not in the page, the rule answers `none` (`plan-pr.ts:311`), and the approve entry keeps `prBranch` at `idea/<slug>` (`packages/board/src/server/entry/approve.ts:890`, `:946`). The domain then refuses `pr-absent` with `no PR found for branch '<prBranch>'` (`packages/domain/src/workflows/approve.ts:358-362`), and the entry adds *Push the branch* (`approve.ts:512-513`), which is wrong for a branch that merged. `skills/plot-approve/SKILL.md:273` documents the limit: *"one host call, at most 100 merged PRs"*.

**Measured 2026-11-21 on `templates-show-named-identifiers`.** Its plan PR #3478 merged on 2026-11-17T10:22:29Z as merge commit `1d814d0a1`, second parent `0835e43b7`, from `docs/templates-show-named-identifiers`. 104 PRs merged after it, and `gh pr list --state merged --limit 100` starts at #3493. `POST /api/approve` refused `no PR found for branch 'idea/templates-show-named-identifiers'`, and the plan was approved in session instead (`6d11dda37`). The same day, `GET repos/plot-pm/plot/commits/0835e43b7…/pulls` and `GET …/commits/1d814d0a1…/pulls` each answered #3478, state closed, `merged_at` 2026-11-17T10:22:29Z, `merge_commit_sha` `1d814d0a1…`, in one call.

**The merged route names no branch.** `planPrOf` returns `branch: ''` on the merged route (`plan-pr.ts:322`), so `readings.pr.branch` stays `idea/<slug>` although the PR merged from another branch. Nothing then compares the plan PR's head branch with the plan's slice branches. A slice whose branch equals that head branch reads as merged the moment the plan PR merges, so the pulse never opens it and delivery counts it as landed. `templates-show-named-identifiers` hit this: its Notes record that its slice moved to `docs/templates-name-their-identifiers` for that reason (`docs/plans/2026-11-16-templates-show-named-identifiers.md:80`).

## Design

### Approach

**One host question by commit.** A new `Host` port operation, `prsOfCommit(sha)`, answers the PRs the host associates with one commit, each as `{ number, state, head, headSha, mergeCommit }`. The domain asks it with the adding merge's second parent, which is the PR's head on both hosts. The answer is one call whatever the PR's age.

**In-process, with the shell answering `unaskable`.** The two in-process connectors under `packages/domain/src/adapters/host/` implement it: GitHub asks `GET /repos/{owner}/{repo}/commits/{sha}/pulls` through `github-api.ts`, and Bitbucket asks `GET /repositories/{workspace}/{repo}/commit/{sha}/pullrequests` through `bitbucket-api.ts`. Bitbucket answers that endpoint only once its pull-request commit links are indexed; an HTTP 202 or 404 there answers `unaskable` naming the reason, and any other failure answers `failed`. The shell `Host` answers `unaskable` with no call, as `prConversation` does today (`packages/domain/src/adapters/host/host-shell.ts:649-650`). This adds no line to `plot-host.sh`, so `scripts/check-shell-lines.sh` has nothing to offset, and the HTTPS call stays where `scripts/check-host-https-callers.sh` allows it. `host-fixture.ts` gains the operation for tests. The issue names `plot-host.sh` as the route; the Open Questions ask whether the shell transport needs it too.

**The approve entry composes its host in-process.** `approve.ts:778` builds `hostShell(context)` directly, so an in-process operation would always answer `unaskable` there. The entry composes its host through `hostReadsFor`, as `packages/board/src/server/entry/merge-ports.ts:39` does, so the approve run uses the in-process transport wherever a host credential exists, and the shell otherwise.

**The rule asks by commit first, and the list is the fallback.** `planPrOf`'s merged route (`plan-pr.ts:306-327`) changes:

1. After `addition`, it asks `commit` (a new `PlanPrReadings.byCommit` field: the rows, or `'unaskable'`).
2. It takes the row whose `state` is `MERGED`, whose `headSha` matches the second parent (`shaMatches`, `plan-pr.ts:208`) and whose `mergeCommit` equals `addition.sha`. The row carries both facts the `confirm` ask reads today, so this route asks no `confirm`. The answer names the row's `head` as `branch`.
3. Where `byCommit` is `'unaskable'`, the rule asks `merged` and `confirm` as today, and `MergedPr` gains `head` so the fallback also names the branch.
4. Where no row or listed PR matches, the rule answers a new outcome `{ outcome: 'unnamed', mergeCommit }` instead of `none`. A file that arrived by squash or direct push has no second parent and still answers `none` (`plan-pr.ts:308`).

`choosePlanPr` (`open-prs.ts:161-233`) answers the `commit` ask with `ctx.host.prsOfCommit(secondParent)`; a `failed` answer throws `refuseOnHostFailure` as the `merged` ask does at `:212-214`. It passes `unnamed` through. `needs-design.ts:358` and `interrogate.ts:207` read `unnamed` as they read `undefined` today.

**A named refusal for an unnamed merge.** `ApproveReadings.pr` gains `unnamedMerge?: string`, and the workflow refuses `pr-merge-unnamed` before `pr-absent` (`workflows/approve.ts:358`): *"the merge commit `<sha>` added `<plan file>`, and the host could not name its PR."* Where the host was asked by commit, the detail says so; where the shell's `unaskable` sent the rule to the list, the detail says the host could only search the newest 100 merged PRs. The entry's `refusalText` (`approve.ts:475`) adds no push advice for this reason. `skills/plot-approve/SKILL.md:273` states the new route and the refusal.

**A slice on the plan PR's branch is refused.** The workflow refuses `slice-on-plan-branch` where `impl` is not `same-branch`, the PR state is `MERGED` or `OPEN`, `readings.pr.branch` is not empty, and a slice branch in `readings.branches` equals it. The detail names the branch and the PR: *"slice `<branch>` is the plan PR's head branch (#N); its merge reads as this slice landing — rename the slice's branch."* The check sits in `approve` because approval is the last step before dispatch and is the one step that reads the plan PR's branch on every route; `/plot-idea` names `idea/<slug>` for a plan PR under `own branches` and does not see a later merge from another branch. Under `same branch` the plan PR is the implementation PR by design, so the check does not apply.

**Tests per slice:**

- *Host:* `packages/domain/test/host-prs-of-commit.test.ts` — GitHub asks `/repos/o/r/commits/<sha>/pulls` once and maps number, state, head, head sha and merge commit; an empty array answers `[]`; an HTTP failure answers `failed`; Bitbucket asks `/repositories/w/r/commit/<sha>/pullrequests` and maps `merge_commit.hash`; a Bitbucket 202 answers `unaskable` and names the indexing. `packages/domain/test/host-shell.test.ts` — the shell answers `unaskable` and spawns nothing.
- *Approve route:* `packages/domain/test/rules-plan-pr.test.ts` — an adding merge asks `commit`; a matching MERGED row answers `found` with its branch and no `confirm` ask; a row whose merge commit differs answers `unnamed`; `unaskable` asks `merged`, and the fallback names the listed PR's branch; a squash or direct push answers `none` as today. `packages/domain/test/workflows-approve.test.ts` — `pr-merge-unnamed` names the merge commit and outranks `pr-absent`. `packages/board/test/unit/approve.test.ts` — a plan whose adding merge's PR is absent from the fake host's newest 100 merged PRs approves through `prsOfCommit`, and `prList('merged')` is never called; a plan added by a squash refuses `pr-absent` as today; a host answering `unaskable` falls back to the list and refuses `pr-merge-unnamed` naming the commit.
- *Slice branch:* `packages/domain/test/workflows-approve.test.ts` — a slice on the merged plan PR's branch refuses `slice-on-plan-branch`; the same plan under `same branch` passes; a slice on another branch passes; an open-route plan PR whose head is a slice branch refuses. `packages/board/test/unit/approve.test.ts` — the refusal text names the branch and the PR.

### Open Questions

- [ ] Does the shell transport need its own `plot-host.sh pr-of-commit` op? With this design, a machine with no host credential falls back to the newest 100 merged PRs and refuses `pr-merge-unnamed` for an older plan PR. A shell op makes that machine find it too, and `scripts/check-shell-lines.sh` then requires an equal number of shell lines removed in the same change.

## Slices

### Host

- `bug/the-host-names-the-prs-of-a-commit` — `Host.prsOfCommit(sha)` on the port, the GitHub and Bitbucket in-process implementations with Bitbucket's `unaskable` on 202 and 404, the shell's `unaskable`, the fixture, and the tests <!-- builds: Host.prsOfCommit, the PRs a host associates with one commit -->

### Approve route

- `bug/plot-approve-asks-the-pr-of-the-adding-merge` — `planPrOf`'s `commit` ask with the list fallback and the `unnamed` outcome, `choosePlanPr`'s answer, the approve entry's host through `hostReadsFor`, the `pr-merge-unnamed` refusal, `SKILL.md:273`, a changeset, and the tests <!-- builds: pr-merge-unnamed, the plan-PR lookup by commit --> <!-- waits: bug/the-host-names-the-prs-of-a-commit -->

### Slice branch

- `bug/plot-approve-refuses-a-slice-on-the-plan-branch` — the `slice-on-plan-branch` refusal in `workflows/approve.ts`, its entry text, a `SKILL.md` sentence, a changeset, and the tests <!-- builds: slice-on-plan-branch, the approve refusal for a slice on the plan PR's branch --> <!-- waits: bug/plot-approve-asks-the-pr-of-the-adding-merge -->

## Notes

- `skills/plot/scripts/plot-deliverable-search.sh` found no existing deliverable for `pr-of-commit`, `commit pulls`, `merge commit PR`, `plan PR branch slice` or `slice on plan branch`. The only hits were unrelated: `pulls/<n>` reads in `adapters/host/pr-conversation.ts`, and `plot-reconcile-scan.sh` section headings. `Host.prMergeDests` (`packages/domain/src/ports/host.ts:426`) asks by head branch, not by commit, so it does not answer a plan PR whose branch is unknown.
- The issue cites `approve.ts:925-946` as `choosePlanPr`. On `origin/main` (`d40c8dc7d`) that range is its call site (`approve.ts:932`); the function and the list call are in `open-prs.ts:161-233`.
- The issue measured the newest-100 page starting at #3490; on 2026-11-21 it started at #3493, with 104 PRs merged after #3478.
- The third slice waits on the second because the merged route names no branch until the second slice sets it from the answer's `head`.
