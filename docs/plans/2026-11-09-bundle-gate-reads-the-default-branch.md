# The bundle gate reads the default branch

> CI's bundle gate compares every pull request with its merge base against `origin/main`, the base the commit-time gate already uses, so a merge of `main` into a sprint branch with `main`'s bundles passes both gates, and so does the sprint PR into `main` after it.

## Status

- **State:** Approved
- **Type:** bug
- **Issue:** #3344
- **Review:** pr
- **Impl:** own branches
- **Approved:** 2026-11-09, jwloka, plan-PR #3345 merged

## Changelog

- A pull request from `main` into a sprint branch passes the bundle gate when it carries `main`'s bundles. CI's `A PR carries no bundle` step compares every pull request with its merge base against `origin/main` again, as the commit-time gate does; the shell-line, decision-count and sprint-member gates keep comparing a pull request with the branch it targets.

Board impact: none on the plan format, the template, the helper scripts' interfaces or the `docs/plans` layout.

## Motivation

Issue #3344 records the defect. On 2026-11-09 PR #3342 (`infra/sprint-takes-main-2026-11-09` into `sprint/desk-probes-and-liveness`) merged `main` at `84982b289`, 69 commits with no content conflict, to bring in #3336. CI's `gates` job refused it with 38 bundle paths. Amending the merge to restore the sprint's copies was refused by the commit hook. #3342 was closed, and #3343 cherry-picks #3336 instead.

The two gates read two different bases for the same commit:

| Gate | Where | Base it compares with | On the merge of `main` into the sprint |
|---|---|---|---|
| CI, `A PR carries no bundle` | `.github/workflows/ci.yml:1383` on `sprint/desk-probes-and-liveness` | `git merge-base HEAD origin/$GITHUB_BASE_REF`, through `scripts/check-no-bundle-diff.sh:61` and `:80` | the sprint tip, so every bundle `main` rebuilt since the fork counts as the PR's change |
| Commit hook, `bundle-commit` | `packages/board/src/server/entry/gate.ts:171`, decided by `bundleCommitRefusal` (`packages/domain/src/rules/bundle-commit.ts:166`) | `git merge-base origin/main HEAD <each MERGE_HEAD>` (`bundle-commit.ts:66-72`) | `origin/main` itself, so only `main`'s copies pass |

`main` has no such disagreement: `main`'s `ci.yml:1383` calls `./scripts/check-no-bundle-diff.sh` with no argument, which defaults to `origin/main`. The third argument came with the *Gate base* slice of `sprint-prs-run-ci` (#3312, merged into the sprint branch on 2026-11-09), together with the same change for three other gates. `test/reconcile/ci-tiers.test.mjs:77` and `:181-193` now refuse a bundle-gate call in `ci.yml` that names `origin/main`.

Replayed on 2026-11-09 against `origin/sprint/desk-probes-and-liveness` at `58e1608d0` and `origin/main` at `55cdfa715` (90 commits ahead of their merge base `429ede68c`), with a plain `git merge origin/main` that took `main`'s bundles with no conflict:

| The merge commit carries | `check-no-bundle-diff.sh . HEAD origin/sprint/…` (CI today) | `check-no-bundle-diff.sh . HEAD origin/main` (commit hook, and the sprint PR into `main`) |
|---|---|---|
| `main`'s bundles | refused, 38 paths | clean |
| the sprint's bundles, restored | clean | refused, 38 paths |

No commit passes both columns. The second row also shows why the sprint's copies are the wrong answer: the sprint PR into `main` runs the same gate against `origin/main`, so restoring the sprint's copies moves the 38-path refusal from the sync PR to the sprint PR.

## Design

This plan has no `Story:`. The defect exists only on `sprint/desk-probes-and-liveness`, so its one slice targets that branch and must merge before the sprint PR into `main`; otherwise `main` takes the defect with the sprint. The sprint writer decides whether to add the plan to the sprint and adds the `Sprint:` line.

It shares `ci.yml` and `ci-tiers.test.mjs` with `ci-reuses-green-runs` (this sprint), which edits the `select` job and the `if:` of the reusable jobs. The edited lines differ, so the second to merge rebases.

### Approach

**The rule: a generated path in any pull request equals `main`'s build at the last `main` commit the branch contains.** `main` builds its bundles after every push to `main` and only there (`.github/workflows/build-bundles.yml:11-13`). A sprint branch never builds its own: `ci.yml:6` runs `push` on `main` only, and every slice PR into the sprint is refused if it carries a bundle. So the only correct copy of a bundle on any branch is `main`'s copy at `git merge-base HEAD origin/main`, and that is the base the commit hook, the `Local checks` key (`CLAUDE.md:56`, no argument) and the documented conflict repair (`docs/definition-of-done.md:46-57`, `CLAUDE.md:667`) already read.

**The options:**

| Option | What changes | Result | Verdict |
|---|---|---|---|
| A. CI reads `origin/main` for every PR | `ci.yml:1383` drops its arguments; `ci-tiers.test.mjs` refuses `$GITHUB_BASE_REF` on the bundle gate instead of `origin/main` | the sync PR, a slice PR into the sprint and the sprint PR into `main` all read one base; the commit hook needs no change | **recommended** |
| B. Both gates read the PR's target base | the commit hook resolves `sprint/<slug>` (as `localChecksBase`, `packages/domain/src/rules/local-checks-base.ts:25-32`, does) and compares with it | the sync PR passes with the sprint's copies, and the sprint PR into `main` is then refused with 38 paths (second row above) | rejected |
| C. A merge from the default branch may take generated paths from either side | `check-no-bundle-diff.sh` allows a path equal to its copy at either merge base | CI passes the sync PR, the commit hook still allows only `main`'s copies, so the outcome equals A with a second base to read and test | rejected |
| D. `main` reaches a sprint only by a direct push or a cherry-pick | none | a direct push to a sprint branch starts no CI run (`ci.yml:6`), and a cherry-pick drops the merge, so the sprint PR into `main` meets the same commits again | rejected; it is the workaround #3343 uses |

**Why A loses nothing for a slice PR into a sprint.** The *Gate base* slice moved the bundle gate to the sprint base so that "a slice is refused for lines or bundles another slice added" (`sprint-prs-run-ci`, *Approach*). That holds for lines, and it does not hold for bundles: no slice PR into a sprint can add one, because the same gate refuses it. With A, `git merge-base HEAD origin/main` on a slice PR is the last `main` commit the sprint took, and the sprint's bundles equal that commit's. Measured on 2026-11-09: `./scripts/check-no-bundle-diff.sh . origin/sprint/desk-probes-and-liveness origin/main` reads clean. A slice that does carry a bundle is still refused, because its diff from that merge base contains it.

**The changes, all in one slice:**

- `ci.yml:1383` becomes `./scripts/check-no-bundle-diff.sh`, as on `main`. The comment above it (`ci.yml:1374-1380`) states that this gate's base is `origin/main` for a pull request into any branch, and why: a branch carries `main`'s build, and the commit hook reads the same base.
- `test/reconcile/ci-tiers.test.mjs`: `BASE_GATES` (`:77`) drops `check-no-bundle-diff.sh`, and a new row refuses a bundle-gate call in `ci.yml` that passes `origin/$GITHUB_BASE_REF`. The three other gates keep their rows.
- `scripts/check-no-bundle-diff.sh:33-41`: the comment names the sprint case. The script keeps its optional base argument (`:61`), and its fixture rows in `no-bundle-diff-gate.test.mjs:211-235` stay, because they test the script and not CI's call.
- `test/reconcile/bundle-commit-gate.test.mjs`: one agreement row beside `:226-255`. A sprint branch cut from `main`, `main` moves on by one bundle, `git merge origin/main` into the sprint: the commit hook allows the merge with `main`'s copy, `check-no-bundle-diff.sh <dir> HEAD origin/main` reads it clean, and `check-no-bundle-diff.sh <dir> HEAD sprint` refuses it, which is the state CI must not read.
- `.changeset/gate-base-reads-the-pr-base.md` names the bundle-diff gate among the gates that compare with the target branch. Its sentence changes to name three gates, so the release note states what ships.

The commit hook, `bundleCommitRefusal`, its tests (`packages/domain/test/bundle-commit.test.ts`) and `plot-local-checks.mjs` do not change.

### Open Questions

- [x] **The base CI passes.** `ci.yml:1383` can call the script with no argument, which reads `origin/main` (`check-no-bundle-diff.sh:61`), or pass `origin/${{ github.event.repository.default_branch }}`. Recommendation: no argument. It is what `main`'s `ci.yml:1383` and the `Local checks` key run, and the commit hook also names `origin/main` (`gate.ts:171`), so one literal holds every caller. A person decides. **Decided 2026-11-09, jwloka: `ci.yml:1383` calls `check-no-bundle-diff.sh` with no base argument, so it reads `origin/main`.**
- [x] **The changeset of `sprint-prs-run-ci`.** `.changeset/gate-base-reads-the-pr-base.md` is not released yet and says the bundle-diff gate compares with the target branch. Recommendation: the slice edits that sentence to name three gates and adds no second changeset for the same release, so the release note states what ships. The Approved plan `sprint-prs-run-ci` keeps its text as a record, and this plan's *Notes* name the change. A person decides. **Decided 2026-11-09, jwloka: the slice edits the sentence in `.changeset/gate-base-reads-the-pr-base.md` to name the three gates that keep the PR base, and adds no second changeset.**

## Done when

| Claim | Check | Slice |
|---|---|---|
| CI's bundle gate reads `origin/main` on every pull request | `ci-tiers.test.mjs`: `ci.yml` holds the tier contract, and a copy whose bundle-gate call passes `origin/$GITHUB_BASE_REF` is refused | Bundle base |
| The other three gates still read the PR's base | `ci-tiers.test.mjs`: the existing rows for `check-shell-lines.sh pr`, `check-decision-count.sh pr` and `check-sprint-members.sh` pass unchanged | Bundle base |
| A merge of `main` into a sprint passes both gates | the new `bundle-commit-gate.test.mjs` row: the commit hook allows the merge with `main`'s copy, and `check-no-bundle-diff.sh` against `origin/main` reads it clean | Bundle base |
| The sprint's restored copy is the state CI must not read | the same row: `check-no-bundle-diff.sh` against the sprint branch refuses the merge | Bundle base |
| A slice PR into the sprint is still clean | this slice's own PR into `sprint/desk-probes-and-liveness` passes `A PR carries no bundle` | Bundle base |
| The next sync PR from `main` into the sprint passes CI | a PR that merges `origin/main` into `sprint/desk-probes-and-liveness` with `main`'s bundles passes `A PR carries no bundle` | Bundle base |

## Slices

### Bundle base

- `bug/bundle-gate-reads-the-default-branch` — `ci.yml:1383` with no base argument and its comment, the `ci-tiers.test.mjs` rows, the comment in `check-no-bundle-diff.sh`, the agreement row in `bundle-commit-gate.test.mjs`, and the changeset sentence; targets `sprint/desk-probes-and-liveness` and merges before the sprint PR into `main` <!-- builds: CI's bundle gate and the commit hook read one base -->

## Notes

- Line numbers checked in the worktree of `idea/bundle-gate-reads-the-default-branch`, cut from `origin/sprint/desk-probes-and-liveness` at `58e1608d0`, on 2026-11-09. `main`'s `ci.yml:1383` read at `origin/main` `55cdfa715` on the same day.
- The replay table in *Motivation* was measured in a scratch worktree on 2026-11-09 and removed afterwards; nothing was pushed from it.
- This plan reverses one row of `sprint-prs-run-ci`'s *Gate base* table (`check-no-bundle-diff.sh`) and keeps the other three.
- Deliverable search (`plot-deliverable-search.sh`) for "bundle gate base" found no existing deliverable.
- Definition of Done: docs/definition-of-done.md.
