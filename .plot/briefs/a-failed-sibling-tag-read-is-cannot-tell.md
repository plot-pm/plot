## Implementation brief — reports-name-their-cause-and-ci-selects-their-tests (wave 1: Sibling tag read)

- **Plan (canonical):** docs/plans/2026-11-21-reports-name-their-cause-and-ci-selects-their-tests.md on main
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3611 merged
- **Branch:** `bug/a-failed-sibling-tag-read-is-cannot-tell` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (plan `Review: pr`)

No slice of this plan waits on this one, and this one waits on none. The four other slices (`the-jenkins-sha-refusal-names-its-cause`, `desk-dirt-excuses-the-fleets-own-files`, `a-plan-pr-runs-the-estate-tests`, `an-entry-source-selects-its-bundle-tests`) touch other files.

### What to build

Issue #3160. `resolvePlanRelease` (`packages/board/src/server/entry/release-chain.ts`) answers a failed `tagsContaining` for the last-merged PR by returning `resolveRelease` (the `if (!lastTags.ok)` block), which prints `delivered, PR #<n> names merge commit <sha>, not in this clone → cannot resolve` plus the fetch advice. For every other (sibling) PR the loop reads `const own = tags.ok ? tags.value : [];` (line 216). A sibling whose merge commit is absent from the clone therefore reads as "no tag contains it", goes to `carriedRelease`, and `releaseTag` reports "the first tag that does: none" for a commit the scan never read. `git tag --contains <absent sha>` exits non-zero (`packages/domain/src/adapters/refs/refs-git.ts`, `tagsContaining`), so an absent sha reaches the not-ok answer — the loop discards it.

The fix: in the loop, a sibling whose `tagsContaining` answers not-ok returns `resolveRelease` with that sibling's `pr` (`String(number)`), `mergeCommit`, `mergedAt`, `base`, `head`, `defaultBranch`, `prSource` and `noFetch`, the same argument shape the last-merged PR's failed read uses. `carriedRelease` is not asked for a commit the clone could not read. For a sibling merged into the default branch the finding then reads `delivered, PR #<n> names merge commit <sha>, not in this clone → cannot resolve` followed by the fetch advice (`fetchAdvice(prSource, noFetch)` in `resolveRelease`). This also closes the issue's LOW note that the `releaseTag` path carried no fetch advice. The plan is canonical; this brief is orientation.

### The decisions the plan settles — do not re-derive them

**A failed read is a different fact from an empty answer.** `tagsContaining` answers `{ ok: false }` when git could not answer and `{ ok: true, value: [] }` when a real commit sits in no tag. Collapsing the first into the second is the defect. Do not fix it by mapping not-ok to `[]` and adding a flag; return the refusal at the point of the failed read, as the last-merged PR's branch already does. This is the repo's standing rule: absent is not false, and an empty result read as "no" has refused fully merged plans before.

**Reuse `resolveRelease`; write no new finding text.** The finding text and the fetch advice already exist and are tested for the last-merged PR. A second wording for the same fact would drift. The only new input is which PR the call names.

**The sibling's number, not the last-merged PR's, goes in the finding.** The same rule is already in the `noCommit` branch above the loop: a reader sent to verify a PR must be sent to the PR the host could not answer for. With several failed siblings, the first one in `prs` order is named; the finding does not list them all.

**Why no test caught it.** Every `tag-misses-pr` case builds the sibling's merge commit inside the clone (`test/reconcile/scan.test.mjs`, "PR #60 merged before #50 but the tag misses #60 reports tag-misses-pr", line 4921, via `git commit-tree`), so the not-ok fallback never ran. The new cases must use a sha the clone does not hold; a commit built with `commit-tree` is present and will not exercise the path.

### Done when

The plan's `## Done when` list is the specification. Lifted assertions a naive implementation passes without:

- In `packages/board/test/unit/branch-claims-prefixes.test.ts`, reuse the fake `ReleasePorts` fixture (`planFor`, line 42). It answers `tagsContaining: async () => ({ ok: false })` for every call today, so the fixture needs a per-sha answer. A plan with two merged PRs whose sibling's `tagsContaining` fails (and whose last-merged PR's succeeds) answers the finding with the sibling's number and sha, and the output never contains `none`. This fails today with "the first tag that does: none". It catches a fix that only handles the last-merged PR.
- A `noFetch: true` cell names the flag in the advice. It catches a fix that drops `prSource`/`noFetch` from the call.
- In `test/reconcile/scan.test.mjs`, a `tag-misses-pr` case whose sibling PR names a merge sha absent from the clone (use a literal 40-hex sha, not `commit-tree`) asserts the same finding in section 6 (`runSection6With`, `splitSections`). Place it beside the line-4921 test.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally. The change is a package change: add a changeset with `'@plot-pm/board': patch`, description first and the `bumps:` block last (`./scripts/check-changeset-packages.sh`). Run `pnpm build:board` only to test locally and commit no bundle (`scripts/check-no-bundle-diff.sh`). This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count. Write new helpers as arrow functions.

### Bookkeeping

Open the PR with `../plot/scripts/plot-open-pr.sh` (`--draft` while the work moves); never `gh pr create`. When it exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/board/src/server/entry/release-chain.ts`, `packages/board/test/unit/branch-claims-prefixes.test.ts`, `test/reconcile/scan.test.mjs` and one changeset. The sibling slices own `skills/plot/scripts/plot-host.sh` and `test/reconcile/host.test.mjs` (Jenkins), `plot-desk-dirt.sh`, `reap.ts`, `reapable.ts`, `sweepable.ts` (desk dirt), `local-checks.ts` and `scripts/ci-job-map.jq` (plan paths), and `packages/board/build.mjs` (entry sources). `scan.test.mjs` is a large shared file; add one case and touch no other. No sibling slice edits `release-chain.ts`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
