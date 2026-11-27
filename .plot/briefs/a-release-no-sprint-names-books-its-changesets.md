## Implementation brief — a-release-between-two-sprints-books-its-plans (wave 1: Shipped Scope)

- **Plan (canonical):** `docs/plans/2026-11-27-a-release-between-two-sprints-books-its-plans.md` on `main`
- **Approved:** 2026-11-27, jwloka, plan-PR #3740 merged
- **Branch:** `bug/a-release-no-sprint-names-books-its-changesets` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Wave 2, `bug/the-release-scope-reads-the-tag-range`, waits on this branch and adds the tag-range arm to the same `releaseScope`. This wave touches the changeset scope and the refusal only; it adds no range read.

### What to build

Issue #3736. `releaseFinish` refuses `release-scope-mismatch` (`packages/domain/src/workflows/release-finish.ts:146-153`) whenever no sprint names the version and an open sprint names another one. Measured 2026-11-27: the active sprint `plot-describes-itself` names `Release: 2.38.0`, the operator shipped 2.37.0 (release PR #3719, `a55df0f41`, tag `v2.37.0`) without closing it, no sprint names 2.37.0, and the finish booked nothing. A person booked 11 plans by hand in 11 commits. The release merge removed 15 changesets; 12 carry a `plan:` line naming 10 distinct plans, 3 carry none.

The change:

1. **`releaseScope`** (`packages/domain/src/rules/release-scope.ts:62`) already answers `named` (the plans the removed changesets name) with `sprints: []` when no sprint is in scope, because `namedOutsideScope(shipped, [])` treats every changeset as outside. Assert that rather than rebuild it; change `releaseScope` only if a test shows it does not hold.
2. **`releaseFinish`** drops the `release-scope-mismatch` branch and removes the refusal from `ReleaseFinishRefusal` and from the TSDoc. An open sprint that names another version, where `scope.sprints` is empty, goes into `notes` as `open sprint <slug> names <version>; left open` (use `s.link || s.file` only if the slug is not enough; the plan's wording names the slug). The note is for a sprint with a non-empty `Release:` that is not this version, active only.
3. **Booking:** the scope's owed plans book as before through `releaseOwed`; no sprint closes (`closeSprint: null`). A fully booked re-run answers `already-released`.
4. **Callers.** `git grep release-scope-mismatch` on `main` lists the sources to change: the workflow, `packages/domain/test/workflows-release-finish.test.ts` (lines 138, 162, 187, 316) and `packages/board/test/unit/release-finish-real-repo.test.ts:257`. Check the board's release-finish wording and route (`packages/board/src/server/release-finish-route.ts`, `src/app/lib/release-finish.ts`, `test/unit/release-finish-wording.test.ts`) for the refusal name. The `.plot/briefs/` files that mention it are history; do not edit them.

### Decisions the plan settles — do not re-derive them

**The refusal goes, it is not narrowed.** The alternative was to keep `release-scope-mismatch` and let the operator fix the sprint's `Release:` first. Measured: the operator had deliberately moved the sprint to 2.38.0 to ship 2.37.0 with the sprint open, and the refusal left the release unbooked while the changeset scope was fully readable. The shipped changesets are the evidence for a release; a sprint that names another version is not.

**The finish closes a sprint only where its `Release:` names the version.** An open sprint naming another version stays open and is named in `notes`. This is Open Question `[question-sprint-close]`'s recommendation, unchanged from today.

**The existing unnamed-sprint fallback stays.** `releaseScope` still takes an open sprint with an empty `Release:` and a `Start:` no later than the tag date as the release's sprint. Only a sprint with a non-empty, different `Release:` is the one that no longer refuses. Do not remove the fallback.

**Delivered only.** A named plan that is not Delivered, or has no file, keeps the existing `named by a shipped changeset and not booked` note. Do not book an Approved plan.

**One scope function, two callers.** `releaseUnbooked` (`rules/release-unbooked.ts:59`) calls the same `releaseScope`, so the Delivery tab's `unbooked` item follows without a second edit. Add one test there: with the fixture below it names the 10 plans and `sprintOpen: null`.

Carried over unchanged: absent is not false. `shipped === 'unaskable'` still books the sprint scope only and adds `shipped-unread`; with no sprint in scope that leaves nothing to book and the answer is `already-released`, which is wrong for an unread release. Make that case refuse or note by name instead of answering `already-released` — read the existing `already-released` arm and decide the smaller change; report the choice in the PR.

### Done when

The plan's `## Done when` list is the specification; for this wave its test line reads: the 2.37.0 fixture — no sprint names 2.37.0 and an open sprint names 2.38.0 — books the 10 changeset-named plans, closes no sprint and notes `plot-describes-itself`; a fully booked re-run answers `already-released`. Assertions that exist because a naive implementation would pass without them:

- **The fixture has 15 changesets, 12 with a `plan:` line naming 10 distinct plans, 3 with none.** Assert `booked` has 10 slugs, in changeset order. It catches an implementation that books per changeset or counts the 3 plan-less ones.
- **`closeSprint` is `null` and the commit's `paths` hold no sprint file.** It catches a finish that closes the sprint it just noted.
- **The note names the sprint and its version.** It catches a silent ignore.
- **The re-run, with every plan holding `Released:`, answers `already-released`.** It catches a finish that writes an empty commit.
- **The real-repo test** (`release-finish-real-repo.test.ts:257`): after the first finish, a later sprint active for `2.30.1` no longer produces `release-scope-mismatch`; the second finish writes nothing (`originMain` unchanged) and answers `already-released`. Rewrite that test, do not delete it.
- **A sprint-free release with a plan-less changeset set** books nothing and answers `already-released`; it catches a crash on an empty scope.

Plus: a changeset in `.changeset/` for `plot` or `@plot-pm/board` as the files you touch require (description first, `bumps:` last; run `./scripts/check-changeset-packages.sh`). Name the local checks command, `node skills/plot/scripts/board/plot-local-checks.mjs`: run it before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Run no full suite and no `test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` does not bind it; if that changes, growth is paid for in the same change. Do not commit a rebuilt board bundle.

TSDoc states current behaviour only: no history of the refusal in comments. Arrow functions for anything you write.

### Bookkeeping

When the PR is created, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Open the PR with `skills/plot/scripts/plot-open-pr.sh` and never `gh pr create`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns `packages/domain/src/workflows/release-finish.ts`, `packages/domain/src/rules/release-scope.ts` (only if a test forces it), their tests in `packages/domain/test/`, `packages/board/test/unit/release-finish-real-repo.test.ts`, the board's release-finish wording if it names the refusal, and one changeset. It does not own the tag-range read, the previous-tag lookup, the `check-ancestry-decisions.sh` declaration or any `git` call: those belong to `bug/the-release-scope-reads-the-tag-range`, which waits on this branch. It does not change `FinishSprint`'s shape.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
