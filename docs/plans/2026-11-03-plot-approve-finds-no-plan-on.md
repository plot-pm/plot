# plot-approve finds no plan on an open Bitbucket PR

> `plot-approve` reports `plan-not-found` for a plan that exists only on its open Bitbucket plan PR, because the plain `pr-list` row carries no `headSha`; its draft-clearing call also uses a `bb` subcommand that does not exist.

## Status

- **State:** Released
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3089
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3091 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/plot-approve-finds-no-plan-on`
- **Delivered:** 2026-11-04
- **Released:** 2026-11-07, v2.31.0

## Changelog

- `/plot-approve` and the board's Approve button find a plan that exists only on its open plan PR on Bitbucket, and take that PR out of draft before the merge. `plot-needs-design` finds the same plan.
- On Bitbucket, the fleet agent loop takes a finished slice PR out of draft. A person no longer marks a Bitbucket slice PR ready by hand.
- When no plan is found, the `plan-not-found` refusal names the open PRs it could not read, and why.

<!-- Board impact: none to the plan format or layout. The approve and needs-design controllers change behaviour; their bundles are rebuilt by main after the merge. -->

## Motivation

Issue #3089, measured 2026-11-03 on Plot 2.30.0 with `Git host: bitbucket`: approving `mat-spiel-auf-der-404` fails with `no plan found ... on the heads of the open PRs`, although `git ls-tree origin/idea/mat-spiel-auf-der-404 docs/plans/` lists the file and `plot-host.sh pr-list` lists PR #975. A `Review: pr` plan lives only on its plan PR until approval, so on Bitbucket no such plan can be approved from the default-branch checkout. The workaround is to run the command from the plan branch.

Two defects in `skills/plot/scripts/plot-host.sh` cause it. Line numbers are on `origin/main` at `0723f9dd5`.

1. The plain Bitbucket `pr-list` arm (`plot-host.sh:4979`, no `--rich`) emits `{number,title,state,head,author}`. The no-Jenkins rich arm (`:4974`) and the Jenkins arm (`:4966`) emit `headSha:(.source.commit.hash // "")` and `draft:(.draft // false)`. `openPrsOf` in `packages/board/src/server/entry/approve.ts:347` keeps only rows with a non-empty `headSha`, so it drops every row of the plain arm. `packages/board/src/server/entry/needs-design.ts:186` holds the same filter in a copy of the same function.
2. `pr-ready` on `bb` runs `bb pr update "$num" --ready` (`plot-host.sh:4466-4467`). `bb pr update 1 --ready` answers `unknown pr command: update` on bb 1.12.1 and 1.11.2, and exits 1 on 1.12.1. `bb pr edit <id> --ready` exists in bb 1.10.1, 1.11.2, 1.12.1 and 1.13.0. Commit `8cfb641fc` (2026-08-22) introduced `pr update`.

The `pr-ready` op has a second caller: the fleet agent loop emits a `pr-ready` write for a finished slice PR (`packages/domain/src/workflows/agent-loop.ts:444`), which `packages/fleet/src/server/entry/loop-writes.ts` applies through `Host.prReady` (`packages/domain/src/adapters/host/host-shell.ts:382-383`). On Bitbucket that write fails and is only logged, so every Bitbucket slice PR stays in draft.

The plain arm also lacks `draft`. `prOf` reads an absent `draft` as `false` (`host-shell.ts:108`). Once the open-PR lookup admits Bitbucket rows, a draft plan PR found through it reads as not draft, `approve.ts:1068` skips `pr-ready`, and the controller calls `pr-merge` on a draft PR. So the fix emits `draft` with `headSha`.

## Design

### Approach

- **The plain Bitbucket `pr-list` arm emits the fields its consumers read.** `plot-host.sh:4979` adds `draft:(.draft // false)`, `url:(.links.html.href // "")`, `updatedAt:(.updated_on // "")`, `headSha:(.source.commit.hash // "")`, `mergedAt:(if .state=="MERGED" then (.updated_on // "") else "" end)` and `base:(.destination.branch.name // "")`, the expressions the no-Jenkins rich arm at `:4974` already uses. The row then carries the GitHub plain arm's fields (`:4824`) plus `base`. The values are Bitbucket's 12-hex short hash, as in the other arms.
- **The open-PR lookup keeps the full sha.** `holdsCommit` runs ``ctx.refs.resolve(`${sha}^{commit}`)`` (`approve.ts:320-321`), and `resolve` is `git rev-parse <ref>` trimmed (`packages/domain/src/adapters/refs/refs-git.ts:475-476`), so it returns the full object id of a 12-hex prefix. The lookup keeps that value and stores it as `OpenPr.headSha`. `changedFiles`, `readPlanAt`, `writeApprovalStatus` and the merge pin then all take the full sha. The merge passes it as `pr-merge --match-head <full sha>` (`approve.ts:1084`); the Bitbucket arm compares the pin and the host's head as prefixes in both directions (`plot-host.sh:4445`), so a full pin matches a 12-hex head. No new port operation and no new git call is added.
- **No fallback to `origin/<head>`.** The doc comment at `approve.ts:336-338` states that a PR whose head commit git cannot resolve "is never read at `origin/<head>`, which may not be the commit the merge would be pinned to". The merge pins to the listed head (`approve.ts:1081-1084`), and a row with no head sha cannot be merged pinned.
- **The lookup counts and names what it could not read.** A listed own-repo open row is unread when the host named no head sha, when git does not hold the head commit after the fetch, or when `changedFiles` fails. The lookup returns these rows with the PR number and the reason. When no plan is found, the `plan-not-found` refusal adds one line: how many open PRs could not be read, and each number with its reason (for example `1 open PR could not be read: #975 (the host named no head commit)`). In `approve.ts` the line goes into `refusalText`'s `plan-not-found` case (`approve.ts:546`). In `needs-design.ts` the controller appends it to the domain's `plan-not-found` detail (`packages/domain/src/workflows/needs-design.ts:120`) before it throws at `needs-design.ts:428`. A fork row (`repo !== ''`) stays skipped and is not named, as today.
- **One shared reader for both controllers.** `openPrsOf` and `holdsCommit` move out of `approve.ts:320-362` and `needs-design.ts:163-201` into one module, `packages/board/src/server/entry/open-prs.ts`, which both controllers import. The two copies are identical today, and this slice changes the function itself (full sha, unread rows). Two edited copies would drift. Both controllers already share `ladder.ts` the same way. The module takes the host, refs and trees ports and the repository root, keeps each controller's own refusal sentence for a failed `pr-list`, and is an arrow function with a factual TSDoc block.
- **The merged-PR comparison takes a prefix.** `planPrOf` compares `pr.headSha === addition.secondParent` (`packages/domain/src/rules/plan-pr.ts:241`). `secondParent` is a 40-hex oid from ``refs.resolve(`${sha}^2`)`` (`approve.ts:396-398`), and a merged Bitbucket row now carries a 12-hex hash, so the comparison never matches on Bitbucket. The rule becomes: exact match, or a case-insensitive prefix where `headSha` is at least 7 hex characters, the same bound `plot-host.sh:4445` uses. Prefix matching is chosen over resolving each merged row: the domain rule stays a function of readings with no I/O, a squash-merged PR's head need not be held locally so `resolve` can fail where the prefix answers, and the `confirm` step that follows re-asks the host and requires its `mergeCommit` to equal the addition (`plan-pr.ts:244-246`), so a prefix collision ends in `none`, never in a wrong PR.
- **`pr-ready` on `bb` runs `bb pr edit <n> --ready`.** `plot-host.sh:4467` changes in place. bb 1.10.1, 1.11.2 and 1.12.1 carry `pr edit --ready`; no minimum-version gate is added. A `bb` without it exits non-zero, and `approve.ts:1069-1071` turns that into its named refusal, as today. The same change fixes the fleet agent loop's mark-ready through `Host.prReady`.
- **The `plot-host.sh` comments name the call.** The caveat at `plot-host.sh:638` and the comment at `:4460-4463` stop saying draft support depends on the bb CLI version and name `bb pr edit <n> --ready` and `--draft` as the calls.
- **Layering.** `plot-host.sh` stays the one place that talks to the host CLI. The controllers call the domain; the shared reader reaches only ports. No new script is added, and `scripts/check-host-cli-callers.sh` is unaffected.

### Shell Ratchet

`scripts/check-shell-lines.sh` counts commands on non-comment, non-blank lines. Every `plot-host.sh` edit changes text inside an existing line: the `jq` object literal at `:4979` and the `bb` call at `:4467`. The comment edits replace comment lines with no more comment lines. The command count does not grow, and no new syntax is introduced for `scripts/check-bash32-syntax.sh`.

### Tests

Each test fails on `main` today, for the reason given.

- **`test/reconcile/host.test.mjs:1034-1042`** (`host: pr-list bitbucket flattens to number/title/state/head`): rewritten, not deleted. The fixture row gains `"source":{"branch":{"name":"feature/a"},"commit":{"hash":"0123456789ab"}}` and `"draft":true`, and the `deepEqual` asserts the full row, including `headSha: '0123456789ab'` and `draft: true`. On `main` the plain arm drops both fields.
- **A contract test in `test/reconcile/host.test.mjs`**: every `pr-list` arm on both backends (GitHub plain and rich; Bitbucket plain, rich without Jenkins, and rich with Jenkins) runs against a stub, and each row carries `head`, `headSha` and `draft`. On `main` the Bitbucket plain arm fails it.
- **A `pr-ready` argv test in `test/reconcile/host.test.mjs`**, modelled on the `pr-close` test at `:1105-1112`, with `PLOT_HOST=bitbucket` and a stub `bb` that exits 1 on `pr update` and exits 0 on `pr edit <n> --ready`. It asserts exit 0 and the argv `['pr','edit','4','--ready']`. On `main` the call exits 1.
- **An `approve.test.ts` case in the default-branch-checkout shape** (`packages/board/test/unit/approve.test.ts`, the `ctxDefaultBranch` fixture at `:285`): `prState(idea/<slug>)` answers no PR; `prList` answers one OPEN row with `head: 'idea/<slug>'`, a 12-hex `headSha` and `draft: true`; `refsFixture` resolves `<12-hex>^{commit}` to a 40-hex sha and lists the plan file in `changedFiles` and `files` under that full sha. It asserts that the plan is found, that `pr-ready` runs, and that `pr-merge` carries `--match-head <full sha>`. On `main` the lookup keeps the 12-hex value, so `changedFiles` and the pin are keyed by the short hash.
- **A `plan-not-found` refusal test in `approve.test.ts`**: `prList` answers one OPEN row with no `headSha`. It asserts that the refusal names `#<n>` and the reason `the host named no head commit`. On `main` the refusal names no PR. A matching case in `packages/board/test/unit/needs-design-route.test.ts` asserts the same line from the needs-design controller.
- **A merged-path test in `packages/domain/test/rules-plan-pr.test.ts`**: a merged row with a 12-hex `headSha` that is a prefix of `addition.secondParent` yields `ask: 'confirm'` for that PR. A 6-character prefix yields `none`. On `main` the 12-hex row yields `none`. The existing fixtures (`headSha: 'h'` against `secondParent: 'h'`) keep passing through the exact-match arm.

## Slices

### Fix

- `bug/plot-approve-finds-no-plan-on` — emit `headSha`, `draft` and the other fields on the plain Bitbucket `pr-list` arm, correct `pr-ready` to `bb pr edit --ready`, lift the open-PR lookup into `open-prs.ts` with the full sha and the named unread rows, prefix-match the merged-PR comparison, and add the tests above <!-- builds: headSha on the plain Bitbucket pr-list arm --> → #3106

Files: `skills/plot/scripts/plot-host.sh`, `packages/board/src/server/entry/approve.ts`, `packages/board/src/server/entry/needs-design.ts`, `packages/board/src/server/entry/open-prs.ts` (new), `packages/domain/src/rules/plan-pr.ts`, and the tests above. `host-shell.ts` does not change: `prOf` already copies `headSha` and `draft` when the row carries them (`host-shell.ts:108`, `:115`).

Changeset, description first and the comment block last:

```markdown
---
'plot': patch
'@plot-pm/board': patch
---

On Bitbucket, `/plot-approve` and `plot-needs-design` find a plan that exists only on its open plan PR, and `/plot-approve` takes that PR out of draft with `bb pr edit --ready` before it merges. The fleet agent loop takes a finished Bitbucket slice PR out of draft the same way. A `plan-not-found` refusal names the open PRs it could not read, and why.

<!--
plan: docs/plans/2026-11-03-plot-approve-finds-no-plan-on.md
bumps:
  skills:
    plot: patch
    plot-approve: patch
-->
```

## Notes

- Created from tracker issue #3089 by `/plot-idea`; the issue is the only link and no write went to the tracker.
- Amended after a four-juror panel (layering, safety, testability, seams; `unanimous amend`): `.plot/panels/2026-11-03-plot-approve-finds-no-plan-on/panel.md`.
- Out of scope, filed as #3093: `remotePlanOf` reads the gating record from the first open PR that changes the plan, while the approval merges the `idea/<slug>` PR. With two open PRs for one slug, the two can differ.
- The plan names `Sprint: follow-ups-2-30-1`, and `docs/sprints/2026-W45-follow-ups-2-30-1.md` holds no line for this slug on `origin/main` or on this branch.
