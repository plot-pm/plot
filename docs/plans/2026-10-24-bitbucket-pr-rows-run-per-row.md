# Bitbucket PR rows run per-row git and Jenkins work with no bound

> A Bitbucket PR listing runs git and Jenkins work once per row, with no row filter, no time bound and no shared budget.

## Status

- **State:** Released
- **Type:** bug
- **Sprint:** follow-ups-2-28-3
- **Issue:** #2481
- **Story:**
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-10-24, Jan Wloka, plan-PR #2514 merged
- **Started:** 2026-10-24, jwloka, `bug/bitbucket-mergeable-fold-open-rows`
- **Started:** 2026-10-24, Jan Wloka, `bug/bitbucket-checks-lookups-bounded`
- **Started:** 2026-10-24, Jan Wloka, `bug/pr-refresh-rotation-keeps-green`
- **Started:** 2026-10-25, Jan Wloka, `bug/bitbucket-bind-coverage-and-docs`
- **Started:** 2026-10-25, Jan Wloka, `docs/one-pr-reader-plan-figures`
- **Delivered:** 2026-10-25
- **Released:** 2026-10-28, v2.29.0

## Changelog

- Bitbucket PR listing and state reads run git and Jenkins lookups only for the rows that need them, and each lookup has a bound.

<!-- Board impact: none. The plan format, template and docs/plans layout stay unchanged. The change touches `plot-host.sh` and the PR refresh in `packages/fleet`; the board reads the same `checksLookup` and `checksSha` fields. -->

## Motivation

Issue #2481 collects 28 follow-up findings from plot-review on nine merged PRs (#2051, #2072, #2073, #2159, #2163, #2203, #2208, #2359, #2404). Nine are MEDIUM, and all nine describe the same defect: work that scales with the number of rows, or with the number of states asked, and has no cap.

- `bb_fold_mergeable` (`plot-host.sh:1922`) runs `jq`, `git --version` and the node bundle for every row, including MERGED and CLOSED rows. It ignores `--repo` and runs `merge-tree` against the local clone's origin base. Its per-base `git fetch` (`:1926`) has no time bound and can stall on SSH.
- `pr-state` under `CI: jenkins` (`:1953`) runs `jenkins_build_map` and a sha lookup for callers that read only state. The merge path re-reads the head through `bb_state_row` (`:4125`), so Jenkins lookups run before a merge, and a parse failure reads as `head-moved`.
- The Bitbucket Jenkins bind (`:4604`) runs once per state with its own 5-lookup budget. One `--state all` refresh can make 15 lookups, including merged and declined PRs.
- A row named for lookup whose Jenkins ask failed keeps its branch colour unbound (`:4439`).
- `pr-refresh.ts:1121` sorts head-bound rows last, and an unnamed row is stored as skipped/unknown without its prior `checksSha`, so a stable green reading drops to unknown.

The remaining 19 LOW findings are wrong docs, missing tests and small code defects in the same files. They are listed under Slices so none is lost.

## Design

### Approach

Fix the bound first, then the tests that prove it, then the wording. Each slice is one reviewable PR.

1. **Mergeable fold.** Run `bb_fold_mergeable` only on OPEN rows, pass `--repo` through, and wrap each `git fetch` in a time bound. Keep the exit status of `bb_state_row` through the fold in `pr-state`.
2. **Checks lookups.** `pr-state` runs Jenkins lookups only when the caller reads checks. The merge re-read of the head runs none. The Bitbucket bind takes one budget per refresh, shared across states, and skips MERGED and DECLINED rows. A named row whose Jenkins ask failed reads `unknown`, with `checksLookup` set.
3. **Rotation.** An unnamed row keeps its prior `checksSha` and its stable reading. Rotation does not sort head-bound rows last.
4. **Tests and wording.** Cover the `--bound-shas` wiring from `refreshPrs` through `pr-list`, `jenkins_bind_rows` and the entry; the bind across several states; the `$wasNamed` arm with a broken ask; and a real `merge-tree` call count for MERGED rows. Correct the doc claims listed below.
5. **Plan `one-pr-reader-per-machine-and`.** Edit the Approved plan so it names one reader scope, one proposal and spender figures that add up (#2404).

The merge path in step 2 changes what a merge reads. A head read without Jenkins lookups must still answer the head sha the merge pins, so the slice must keep `head-moved` for a real head change and stop reporting it for a parse failure.

### Open Questions

- [ ] What time bound does each `git fetch` get, and is it a config key or a constant? `Checks wait` is 3600 s and is too long for one fetch.
- [ ] Does `pr-state` learn whether its caller reads checks from a flag, or from the verb it is called under?
- [ ] Is the bind budget per refresh or per machine and account? Plan `one-pr-reader-per-machine-and` chooses the scope for the second; slice 2 must not pick a different one.
- [ ] Does slice 5 wait for slice 2, or does it fix the plan text first so slice 2 reads one scope?

## Slices

### Mergeable fold

- `bug/bitbucket-mergeable-fold-open-rows` — `bb_fold_mergeable` runs for OPEN rows only, honours `--repo`, bounds each `git fetch`, and `pr-state` keeps the exit status of `bb_state_row` → #2546

### Checks lookups

- `bug/bitbucket-checks-lookups-bounded` — `pr-state` and the merge re-read run no Jenkins lookup unless the caller reads checks; one `--state all` refresh spends one bind budget; a named row with a failed ask reads unknown → #2617 `<!-- waits: bug/bitbucket-mergeable-fold-open-rows -->`

### Rotation

- `bug/pr-refresh-rotation-keeps-green` — an unnamed row keeps its prior `checksSha` and stable reading `<!-- waits: bug/bitbucket-checks-lookups-bounded -->` → #2634

### Tests and wording

- `bug/bitbucket-bind-coverage-and-docs` — tests for `--bound-shas` wiring, several states, a broken ask and a real `merge-tree` count; corrections to the LOW findings below `<!-- waits: bug/pr-refresh-rotation-keeps-green -->` → #2653
- `docs/one-pr-reader-plan-figures` — plan `one-pr-reader-per-machine-and` names one reader scope, one proposal and spender figures that add up → #2655

LOW findings carried by the last two slices:

- `packages/board/src/contract/schema.ts:358` — docs say a broken ask also yields `checksLookup` skipped; a named row with a broken lookup keeps its colour and gets none.
- `packages/board/src/server/entry/jenkins-pr-checks.ts:76` — the Bitbucket `state` and `review` verbs live in the Jenkins entry although review has nothing to do with Jenkins.
- `packages/board/src/server/entry/jenkins-pr-checks.ts:80` — the `state` verb drops empty stdin lines, so an empty colours line shifts fields and checks reads none instead of unknown.
- `packages/domain/src/entities/pr-index.ts:88` — `checksLookup` is typed as any string instead of the literal `'skipped'`.
- `packages/domain/src/rules/bitbucket-mergeable.ts:44` — the JSDoc says `merge-tree --write-tree` reads the object database only; it writes tree and blob objects.
- `packages/domain/src/rules/pr-index.ts:290` — the doc says a draft adds no request, but a draft that is the only pending or failing row starts its own `pr-list` call; the paragraph also sits after `@param held`, so TSDoc reads it as part of that parameter.
- `packages/domain/test/jenkins-pr-checks.test.ts:106` — an assertion cannot fail because `droppedBranches` is defined as the complement of `boundBranches`.
- `skills/plot/scripts/README.md:77` — the row says bind reads a head no build carries as pending; `bindChecks` answers unknown.
- `skills/plot/scripts/plot-host.sh:1898` — a failing rows bundle empties the named file and turns every ambiguous row unknown; the `jenkins_bind_rows` comment does not say so.
- `skills/plot/scripts/plot-host.sh:4607` — the `$colour`/`$ambiguous`/`$hasSha`/`$wasNamed` jq chain is copied into both arms on very long single lines.
- `skills/plot/scripts/plot-host.sh:921` — the header says `PR_LIST_BIND_FN` is set and cleared like `PR_LIST_JQ_ARGS`; `PR_LIST_JQ_ARGS` is never cleared.
- `test/reconcile/bitbucket-mergeable.test.mjs:340` — the MERGED-rows test compares git status only and cannot detect a `merge-tree` call.
- `test/reconcile/host.test.mjs:3082` — no test covers the Bitbucket Jenkins bind across several states with `--state all`, or a row named by the cap whose ask broke.

## Notes

- Source: follow-up findings from plot-review, checked against `origin/main` at `84b1638e4` on 2026-10-24. Line numbers come from that commit and may have moved.
- Unattended run: `Review` and `Impl` take the lightest answers the repo's `Plan PRs: required` allows, and the design question defaults to no. Deliverable search skipped: no slice builds a new named artifact.
