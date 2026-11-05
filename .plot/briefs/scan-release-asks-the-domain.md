## Implementation brief — release-resolution-reads-a-cross-repo (wave 3: Scan asks the release rule)

- **Plan (canonical):** docs/plans/2026-11-03-release-resolution-reads-a-cross-repo.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3082 merged
- **Branch:** `bug/scan-release-asks-the-domain` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan-PR review; `plot-review` app required on main)

This branch is the plan's third and last wave. It waits on `bug/release-tag-contains-every-local-pr` (wave 2), which itself waits on `bug/release-pr-reads-local-references` (wave 1) — do not start this branch until wave 2 has merged into `main`. Nothing waits on this branch.

### What to build

Section 6 of `plot-reconcile-scan.sh` ("6. Delivered but already released") currently carries its own, undeclared copy of the release-resolution rule in shell: `last_pr="${prs##*,}"` (`:3481`) takes the highest PR number off the plan's `prs` list, asks `plot-host.sh pr-state` for that one number, and falls through to `plot-release-chain.mjs resolve` only when the merge commit is empty or missing from the clone. This is exactly the defect the rest of the plan fixes in `releasePr`/`releaseTag` (`packages/domain/src/rules/release-tag.ts`) and in `deliver.ts`'s `--release` arm: picking the *highest-numbered* PR rather than the *local, last-merged* one, with no awareness of foreign references or deferral.

By the time this branch starts, waves 1 and 2 have already fixed `releasePr`/`releaseTag` and `deliver.ts` to:
- treat an unprefixed `→ #N` as local and every `owner/repo#N` as foreign, dropping deferred branches first (`releasePr`, wave 1 — already on `main`, see `prResult.outcome` in `deliver.ts:787-860`);
- resolve the tag from the **local** PR that merged **last** (by `mergedAt`), and refuse `tag-misses-pr` when that tag does not contain every non-deferred local PR's merge commit (`releaseTag`, wave 2).

Your job: make section 6 ask the same two domain rules, through one `plot-release-chain.mjs` call per plan, instead of re-deriving `last_pr` in shell. Concretely:

1. Give `plot-release-chain.mjs` a new verb (e.g. `release`) that takes a plan's `branchClaims` rows (reference + deferred, same shape `deliver.ts` already builds) plus the version context, calls `releasePr` then `releaseTag` with the readings gathered the same way `--release` gathers them (host `prState` per local PR, `Refs.tagsContaining`), and prints one line naming the outcome: shipped in a tag, unreleased, all-foreign (with its own finding text, never `add → #N`), or a named refusal (`none`, `no-merge-commit`, `tag-misses-pr`, …).
2. Replace `plot-reconcile-scan.sh:3481-3523` with one call to that verb per delivered, non-docs/infra plan. The existing `cat-file`/`git tag --contains` direct-path shortcut and the `plot-release-chain.mjs resolve` per-PR fallback (the non-default-branch walk) both leave the shell — the new verb owns that decision end to end, the way `resolveRelease` in `release-chain.ts` already owns the walk itself.
3. The `PR_SOURCE=off` arm (`:3471-3474`, the "note: release state not resolved… pr_source=off" branch) stays in the shell exactly as it is — it calls nothing and the plan explicitly keeps it out of scope ("stays in the shell and calls nothing").

Keep the existing `resolve` verb (per-PR, called from `deliver.ts`-adjacent code paths and the non-default-branch walk) as-is; this is an additional verb, not a replacement of `resolveRelease`/`releaseChainStep`.

### Decisions already settled — do not re-derive them

**Local-vs-foreign and deferral are wave 1's decided interface, not yours to revisit.** `branchClaims` already returns `{ branch, reference: { repo, number } | null }` rows; a `repo === ''` reference is local, every `owner/repo#N` is foreign including one naming this repository, and deferral comes from `PlanRecordBranch.deferred` per branch — not a new field on `plot-plan-meta.sh`. Section 6 reads this the same way `deliver.ts:787` already does (`branchClaims(planText.value).map(...)`); it must not grow its own parsing of `prs`/`deferred_prs` in shell.

**The tag comes from the local PR that merged last, by `mergedAt` — never by PR number.** This is wave 2's rule (`releaseTag`), already proven against the regression case in the plan's Tests section (`#50` merged late, `#60` merged first, refuses `tag-misses-pr` naming `#50` when `#60`'s tag doesn't contain it). Section 6 must report that refusal by the same name section 6 and `--release` are required to agree on (plan: "Section 6 and `--release` then agree on a deferred highest PR, which they do not on origin/main").

**An all-foreign plan gets its own finding text, never `add → #N`.** Wave 1 already books this outcome as `all-prs-foreign` in `--release` with no host call and no tag lookup (see `deliver.ts:810-816`, `823-827`). Section 6's equivalent must print something like `shipped in other repositories: <repos>` with `consider: /plot-release`, and must never ask the host for a merge commit it does not need.

**The direct-path shortcut (`cat-file -e` + `git tag --contains`) is a scan-only optimisation, not a second implementation of `releaseTag`.** On origin/main it exists because asking `plot-release-chain.mjs` for every plan would cost a host call the scan can usually avoid when the merge commit is already in the local clone (`:3505-3511`). Whatever shape you give the new verb, keep that shortcut's *behavior* — a scan with the SHA already in the clone should not need a network round trip it didn't need before — but implement it inside the bundle call (or ahead of it, reading the same local readings `releaseTag` consumes), not as a second hand-rolled "first tag by version, sorted" loop in shell. The existing sort rule ("FIRST `vX.Y.Z` tag, sorted by version, never by git's own `--contains` order") is `releaseTag`'s, not something to reimplement with `sort -V | head -1`.

**No grep fallback, ever.** The comment at `:3478-3480` names why: matching commit messages for `#N` matched PRs that merely *mentioned* a number, not merged it, and reported a wrong release version nobody re-checked. Nothing in your change may reintroduce that shortcut.

**Absent is not `false`.** Several readings here (merge commit, `mergedAt`, containing tags) come back `''`/empty rather than throwing. Treat an empty reading as "cannot tell" or "cannot resolve" and name it — never as "not released yet", which silently looks identical to success. This is the whole reason section 6 exists per its own header comment, and it is also this repo's most commonly-relearned rule (see `CLAUDE.md`'s "Answers, never verdicts" and the index of shell-script memories) — read the exit code/outcome tag the bundle returns, not the absence of one.

### Done when

The plan's `## Done when` is implicit in its Tests section — lift these as the specification for this wave specifically (`test/reconcile/scan.test.mjs`, section 6, including `runSection6Bitbucket`):

- The two-repository plan (one local `#33`, one foreign `other/repo#280`): the host stub answers `#33` merged inside `v0.1.0`; section 6 prints `shipped in v0.1.0` and asks `pr-state` for `33` only — **never `280`**. This is the regression test that proves the shell copy of the rule is gone; on origin/main today this plan prints `PR #280 has no merge commit → cannot resolve`.
- On Bitbucket, where `runSection6Bitbucket` answers no merge commit: the finding names `PR #33`, never `#280`.
- An all-foreign plan prints the new finding (e.g. `shipped in other repositories: <repos>`), never `add → #N`.
- A deferred highest PR: section 6 and `--release` name the **same** PR — assert this by calling both code paths (or their shared domain call) against the same fixture plan and comparing the PR number each names.
- PR `#60` merged before `#50`, both local, tag doesn't contain `#50`: section 6 reports `tag-misses-pr` (same reason name `releaseTag` uses), not a silent "shipped".

Plus: run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints — it maps your changed paths (`plot-reconcile-scan.sh`, `plot-release-chain.mjs`/its source, `packages/domain/src/rules/release-tag.ts` if touched) to the relevant suites and gate scripts. Do not run the full `test:e2e` or `test:contracts` suites by name; let the local-checks mapping decide what runs. The CI `select` job runs the rest on the PR.

**`scripts/check-shell-lines.sh` gates this change specifically.** This slice's whole point is to *shrink* `plot-reconcile-scan.sh` (replacing the `last_pr`/`pr-state`/`cat-file`/`git tag --contains` block with one bundle call), so the gate should pass by construction — but if the new verb's plumbing needs any new shell lines elsewhere under `skills/`, they must be paid for by an equal removal in the same change. The gate counts commands, not lines: don't pay the "debt" by joining statements with `;`/`&&` or folding `fi`/`done` onto the previous line.

**Rebuild the board artifact before committing** if your change touches anything the board bundles (`plot-release-chain.mjs` is a generated bundle under `skills/plot/scripts/board/` — its source lives in `packages/board/src/server/entry/`). Run `pnpm build:board` to verify locally, but do not commit the rebuilt artifact yourself if you hit a conflict — follow `docs/definition-of-done.md`'s conflict procedure (restore from merge-base, never commit a manual rebuild, never "take ours").

### Bookkeeping

Open the PR through the controller once your first real commit exists:

```bash
skills/plot/scripts/plot-open-pr.sh          # or --draft while still moving
```

Do not run `gh pr create` — the controller reads this plan's wave heading for the PR title and refuses a branch no plan names. Once the PR exists, append `→ #<number>` to this branch's line under `## Slices` → `### Scan asks the release rule` in the plan file, in the same commit style wave 1 and wave 2 used (`→ #3087`, `→ #3108`).

### Scope guard

This branch owns `skills/plot/scripts/plot-reconcile-scan.sh` section 6 (the `== 6. Delivered but already released ==` block, roughly `:3443-3530`), `skills/plot/scripts/board/plot-release-chain.mjs` and its source (`packages/board/src/server/entry/release-chain.ts`), and `test/reconcile/scan.test.mjs`'s section-6 cases. It must not touch `packages/domain/src/rules/release-tag.ts` or `cross-repo-reference.ts` (wave 1/2's territory — by the time you start, both should already be merged and stable) beyond calling them. It must not touch `deliver.ts`'s release arm.

By the time this branch starts, waves 1 and 2 (`bug/release-pr-reads-local-references` → #3087, `bug/release-tag-contains-every-local-pr` → #3108) should both be merged into `main` — confirm with `git log main -- packages/domain/src/rules/release-tag.ts` that `releaseTag` already returns `tag-misses-pr` (not today's `no-tag`/`tag-does-not-contain`/`tag-mismatch`) before you start building against it. If it still returns the old reasons, wave 2 hasn't landed yet — stop and check `/plot-pulse` rather than building against the pre-wave-2 shape.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
