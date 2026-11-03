# Safety juror: plot-approve finds no plan on an open Bitbucket PR

Position: amend

## Summary

The diagnosis is correct and the core fix (emit `headSha` on the plain Bitbucket `pr-list` arm, call `bb pr edit --ready`) is safe. Two parts of the plan are not safe as written: the open question that offers a fallback to `origin/<head>` contradicts a deliberate guard in the code, and the plain arm also lacks `draft`, so the fixed lookup can reach a merge of a draft PR without the `pr-ready` step. The plan must close both before an unattended agent builds it.

## Findings

### F1. A fallback to `origin/<head>` removes a deliberate guard (HIGH)

- `packages/board/src/server/entry/approve.ts:337-339` (origin/main) states the rule the fallback breaks: "A PR from a fork, or whose head commit git cannot resolve after the fetch, is skipped: it is never read at `origin/<head>`, which may not be the commit the merge would be pinned to."
- The record that gates the approval (phase, `Review:`, slices) is read at `first.pr.headSha` (`approve.ts:457`). A read at `origin/<head>` reads a local ref that can lag or lead the PR head. The gate then judges one commit and the merge lands another.
- The merge pin does not save it: on Bitbucket, `pr-merge --match-head` compares against `pr.headSha` (`approve.ts:1081-1084`, `plot-host.sh:4445`). With no `headSha` the merge refuses "named no head SHA", so a fallback buys a gate read that the merge then refuses anyway. With a `headSha` there is no need for the fallback.
- Open question 2 hands this decision to the implementing agent. It is a safety decision and the code already answers it.

### F2. The plain arm also emits no `draft`, and `draft` defaults to false (HIGH)

- Plain Bitbucket arm, `plot-host.sh:4974-4976` region on origin/main: `{number,title,state,head,author}`. No `draft`, no `headSha`.
- `packages/domain/src/adapters/host/host-shell.ts:108`: `draft: raw.draft ?? false`.
- When `idea/<slug>` has no PR (a batch PR or a plan PR on another branch), `planPrOf` takes the `open` route and copies `first.pr.draft` (`packages/domain/src/rules/plan-pr.ts:226-233`). With the plan's change alone, that value is `false` for a draft PR. `approve.ts:1068` then skips `pr-ready` and calls `pr-merge` on a draft PR. Whether Bitbucket merges or refuses a draft is not stated in the plan; either answer is a wrong reading of the PR, not a named refusal.
- The plan fixes the one missing field the issue saw and leaves its sibling. The other Bitbucket arms emit `draft:(.draft // false)` (`plot-host.sh` rich arm), so the fix is one more field in the same jq expression.

### F3. Short hash: wrong commit is near-impossible, "none" is possible and silent (MEDIUM)

- `holdsCommit` runs `git rev-parse <sha>^{commit}` (`approve.ts:320-321`). With a 12-hex Bitbucket hash, git resolves the prefix with a commit type hint. Two commits with one 12-hex prefix make it fail; the PR is then skipped (`approve.ts:356`) and the run ends in `plan-not-found`. That is a misleading refusal, not a wrong approval.
- A wrong commit needs a local commit that shares the 12-hex prefix while the real head is absent. The fetch (`approve.ts:352`) fetches by branch name, so the real head is present after it. The risk is negligible, and one line removes it: rev-parse the short hash to the full sha after the fetch, and require the full sha to start with the host's hash. `changedFiles` and `readPlanAt` then take the full sha; the merge pin keeps the host's value, which `plot-host.sh:4445` prefix-matches both ways.
- `refs-git.ts:498-507` (`changedFiles`) passes the branch argument to `git diff origin/<main>...<sha>` unchanged, so a short sha works there. Open question 1 is answerable from the code: yes, after the fetch.

### F4. A dropped row still ends in a refusal that names the wrong cause (MEDIUM)

- `approve.ts:347` drops every row with no `headSha`, and the final message (`approve.ts:546`) says "no plan found ... on the heads of the open PRs". That message caused issue #3089 to read as a missing plan.
- After the fix, any backend row without `headSha` still vanishes the same way. The refusal must say how many open PRs it could not read and why (no head sha, head not resolvable after fetch), so the next gap is visible. This holds for `needs-design.ts:186`, which carries the same filter.

### F5. Two open PRs with one slug: guarded on the open route, not on the named route (MEDIUM, pre-existing)

- On the `open` route, `planPrOf` returns rivals and the workflow refuses `pr-ambiguous` (`packages/domain/src/workflows/approve.ts:325-333`). That is safe.
- On the `named` route (`idea/<slug>` has a PR), `rivals` is `[]` (`plan-pr.ts:207-217`). In the issue's scenario the plan is not in the checkout, so `remotePlanOf` reads the gating record from the FIRST open PR that carries the slug (`approve.ts:452-457`), in host listing order, while `choosePlanPr` merges the `idea/<slug>` PR. With two open PRs that change the same plan file, the gate can judge PR B's copy and merge PR A.
- Today Bitbucket never reaches this code because every row is dropped. The fix makes it reachable on Bitbucket. The plan must either read the record from the PR it merges, or refuse when the PR that supplied the record is not the PR chosen to merge.

### F6. `pr-ready` failure mode is already loud (INFO)

- `bb pr update 1 --ready` exits 1 with `unknown pr command: update` (run here, bb 1.12.1). `approve.ts:1069-1071` turns a non-zero exit into the named refusal "could not take PR #N out of draft. Nothing else was written". The current defect is a loud refusal, not a silent pass.
- After the change, an older `bb` that lacks `pr edit --ready` also exits non-zero and gets the same refusal. That is acceptable. The caveat at `plot-host.sh:638` still says support "depends on the bb CLI version"; the plan should name the minimum `bb` version it checked (1.12.1 here) in that caveat.

### F7. Merged-route comparison stays broken on Bitbucket (LOW, out of scope, needs a person)

- `plan-pr.ts:241` compares `pr.headSha === addition.secondParent` exactly. `secondParent` is a full sha from git; Bitbucket's `headSha` is 12 hex. On Bitbucket this route finds no plan PR for a plan already on the default branch. It fails closed (`none`), so it is not unsafe, but the plan's contract test claims "every backend's row carries the fields the lookup filters on" and this consumer is one of them.

## Amendments required

1. Close open question 2 in the plan: no fallback to `origin/<head>`. Cite `approve.ts:337-339` as the reason.
2. Add `draft:(.draft // false)` to the plain Bitbucket `pr-list` arm in the same change, and extend the contract test to assert `draft` as well as `head` and `headSha`.
3. In `openPrsOf`, after `holdsCommit`, resolve the host's hash to the full sha and require a prefix match; use the full sha for `changedFiles` and `readPlanAt`. Close open question 1 with that.
4. Make the `plan-not-found` refusal name the open PRs it could not read and the reason, for `approve.ts` and `needs-design.ts`.
5. Close the named-route gap (F5): the record that gates the approval comes from the head of the PR that merges, or the approval refuses with a named reason. Add a test with two open PRs that carry one slug, one of them on `idea/<slug>`, whose plan copies differ in `Review:`.
6. Name the test files and the stub shape: a stub `bb` that exits 1 on `pr update` and 0 on `pr edit <n> --ready`, so the `pr-ready` test fails before the change and passes after.

## Decisions for a person

- F7: fix the merged-route prefix comparison in this plan, or file it as its own issue.
- Whether a `bb` older than the version that has `pr edit --ready` is supported at all, or the caveat names a minimum version.

## Ran versus read

- Ran: `gh issue view 3089`; `git show origin/main:<file>` and `git grep` over `approve.ts`, `plan-pr.ts`, `workflows/approve.ts`, `host-shell.ts`, `refs-git.ts`, `needs-design.ts`, `plot-host.sh`; `bb --version` (1.12.1); `bb pr edit --help`; `bb pr update 1 --ready` (exit 1, `unknown pr command: update`, no host call made).
- Read only: Bitbucket's behaviour on merging a draft PR, and git's prefix disambiguation under `^{commit}`. Neither was executed against a live host or a colliding object.
