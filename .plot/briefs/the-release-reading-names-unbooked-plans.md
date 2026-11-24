## Implementation brief — a-merged-release-books-its-plans (wave 1: Reading)

- **Plan (canonical):** `docs/plans/2026-11-24-a-merged-release-books-its-plans.md` on `main`
- **Approved:** 2026-11-24, jwloka, plan-PR #3702 merged
- **Branch:** `bug/the-release-reading-names-unbooked-plans` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

This wave is first. The three other slices wait on it: `bug/a-person-books-a-merged-release` (the button, the route and the command) and `bug/reconcile-counts-unbooked-docs-plans` read `releaseUnbooked`, and `bug/the-release-finish-leaves-a-record` waits on the button slice. Keep the rule's return shape exactly as the plan states it, because three branches build on it.

### What to build

Release PR #3598 (`release: 2.36.0`) merged on 2026-11-23 and the finish booked no plan and closed no sprint. A person booked 20 plans by hand in 20 commits and closed the sprint in `1a423e708`. Nothing on the board said the release was unbooked, and reconcile section 6 missed `templates-show-named-identifiers` because it skips Type `docs` and `infra`. This branch adds the reading only: no button, no route, no file.

1. **`releaseUnbooked(readings)`** in `packages/domain/src/rules/release-unbooked.ts`. It takes the newest release tag, the sprints, the plans and the changesets the tag's merge removed, all as values. It returns `{ version, plans: slug[], sprintOpen: slug | null }`, `none` where every scope plan holds its `Released:` record and no sprint naming the version is open, and `unaskable` where a read failed. A failed read never answers `none`.
2. **One scope function, shared.** The scope is every sprint whose `Release:` names the version, active or closed, plus every plan a removed changeset names. Put it in `packages/domain/src/rules/release-scope.ts` beside `scopeSlugs` and `namedOutsideScope`, and have both `releaseUnbooked` and `releaseFinish` call it. Two functions that each compute the scope is the defect this branch removes.
3. **`releaseFinish` reads a closed sprint** (`packages/domain/src/workflows/release-finish.ts`). Its readings gain the version's sprints, active or closed. `release-scope-mismatch` keeps its meaning but applies only to an ACTIVE sprint that names another version. A closed sprint stays closed and is not closed again. `sprint-ambiguous` applies where two ACTIVE sprints name the version; an active sprint that names another version is ignored (plan Open Question `question-two-active-sprints`, recommendation as written).
4. **The board entry feeds it** (`packages/board/src/server/entry/release-finish.ts`). `finishRelease` currently reads its scope only from `docs/sprints/active/`, which is empty once a person closes the sprint by hand. Read the sprint directory itself for sprints whose `Release:` names the version. The PR entry that `release-approve` uses stays as it is; the version entry is wave 2's.
5. **fleetd computes it and books nothing.** `releaseTick` (`packages/fleet/src/shared/release-tick.ts`) asks `releaseUnbooked` each pass from local git readings and publishes the answer on the channel as `release unbooked`. `release-world.ts:93` has `finish: async () => 'none'` as a stub; do not confuse that port with this reading. It persists no file.

The plan is canonical; this is orientation.

### Decisions the plan settles — do not re-derive them

**The merge-commit test is not enough.** Reconcile section 6 asks which tag contains a plan's PR merge. A plan with no PR annotation and every `docs` or `infra` plan fall outside that test, and `templates-show-named-identifiers` is the measured case: slice #3615 is in `v2.36.0` and section 6 skips its type. The changeset and the sprint name what the release owes, whatever the type. Do not reuse section 6's loop.

**The changesets come from `git diff <tag>^1 <tag> -- .changeset`.** The tag's commit is the release merge (`d9d5e9229`, tag `v2.36.0`, 17:24:37 UTC), and the version commit deleted the changesets, so the default branch holds none. That is a local read with no host call. `shippedChangesets` in the board entry already reads them through `Refs.commitFiles` and `Refs.showFile(<merge>^1, file)`; take the same route, and do not ask the host for the release PR's merge commit, because the rule starts from a tag.

**Two sprints name `Release: 2.36.0` today:** `docs/sprints/2026-W47-triggers-and-connectors.md` (closed 2026-11-15) and `docs/sprints/2026-W47-delivery-ui-polish.md`. A rule that reads only the active index or only the open sprint misses the first. Use these two files as the fixture.

**Only a plan that reads Delivered counts as unbooked.** A plan in any other phase is named in a note and not counted, as `releaseFinish` does now. Struck sprint items stay out, as `scopeSlugs` already does.

**The rule reads the newest tag only** (plan Open Question `question-newest-tag-only`). An older release's Delivered plan stays invisible here; reconcile section 6 still reports it. Do not widen this.

**fleetd persists nothing.** "Answers, never verdicts" (`CLAUDE.md`, A Decision Reads The Index): `releaseUnbooked` is a verdict that git re-derives for free, and a persisted copy is a cache git cannot reach. The record file is wave 3's and holds a finish's outcome, which is a bought answer. Do not write `.plot/state/` from this branch.

**fleetd books nothing, and `releaseFinish` still refuses `unattended` for `fleetd`.** Do not relax the caller check to let the tick finish a release.

**No hand-off through the board in this branch.** `question-board-reads-without-fleet` (a board with no fleetd asks the rule itself) belongs to the Repair slice, where the Delivery tab consumes it. Here the rule and the tick event are the whole surface.

**`question-why-the-finish-booked-nothing` stays open.** The 2.36.0 finish output is lost (no `plot-release-approve-3598.log` on `zio`). Do not guess a cause in code or comments.

Rules carried over, unchanged:

- Absent is not false: a failed tag, changeset or sprint read answers `unaskable`, never `none` and never an empty plan list.
- `packages/domain/**` is arrow functions and factual TSDoc. Decision history goes in the commit message, not in comments.
- The layering rule: the tick calls the domain with readings as values; it spawns nothing. The git reads go through the existing `Refs` port.

### Done when

The plan's slice `<!-- tests: -->` annotation is the specification, as five tests:

- `releaseUnbooked` over the 2.36.0 fixture: two sprints name the version, and the result names the plans each owes.
- A `docs`-type plan named only by a removed changeset counts as unbooked. A naive implementation that reuses section 6's type skip, or that reads only sprint items, passes every other test and fails this one.
- A fully booked release answers `none`.
- A failed read answers `unaskable`, for each of the three reads (tag, sprints, changesets). A naive `[]` fallback answers `none` and reports a debt as cleared.
- `releaseFinish` books a closed sprint's scope, and refuses `release-scope-mismatch` only for an ACTIVE sprint that names another version. Assert that a closed sprint naming another version does not refuse, and that a second run answers `already-released`.

Add one more: `releaseFinish` and `releaseUnbooked` name the same plans for the same readings. That is the reason both call one scope function, and a test that only exercises each alone cannot catch their drift. If you write them as two implementations after all, they join `packages/domain/corpus/` and a disagreement stops the branch.

Plus the repo gates. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. Add one changeset, description first, `bumps:` last, with `plan: docs/plans/2026-11-24-a-merged-release-books-its-plans.md` in the block (`CLAUDE.md` › Versioning); the package is `@plot-pm/board`. A change under `skills/` needs a skill named in `bumps:`; this branch touches none unless you edit a script. Do not commit a rebuilt `board-server.mjs`: `scripts/check-no-bundle-diff.sh` refuses it. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` has nothing to count; if you find you must edit shell, write the rule in the domain and ask it through a bundle instead.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves). Never `gh pr create`.
- When the PR exists, write its number into this slice's line in the plan's `## Slices` section on `main`: append `→ #<number>` to the `bug/the-release-reading-names-unbooked-plans` line.
- Before a hand fix of a pull request, read `inFlight` in `.plot/state/fixer-attempts/<pr>.json`; a mark there means a fleetd fixer runs on that PR.

### Scope guard

This branch owns:

- `packages/domain/src/rules/release-unbooked.ts` (new) and `packages/domain/src/rules/release-scope.ts`
- `packages/domain/src/workflows/release-finish.ts` and its tests, `packages/domain/test/workflows-release-finish.test.ts`
- `packages/board/src/server/entry/release-finish.ts` — the scope reading only
- `packages/fleet/src/shared/release-tick.ts`, `packages/fleet/src/shared/release-world.ts` and `packages/fleet/test/unit/release-tick.test.ts` — the `release unbooked` event only
- the domain export for the new rule, one `.changeset/*.md`, and new tests

Not this branch: the `unbooked` placement and row (`delivery-placement.ts`, `delivery-row-form.ts`), `POST /api/release-finish`, `plot-ask.mjs release-finish`, the controller gate (all `bug/a-person-books-a-merged-release`); the record file (`bug/the-release-finish-leaves-a-record`); reconcile section 6 (`bug/reconcile-counts-unbooked-docs-plans`).

Other branches in flight, verified 2026-11-24 with `git ls-remote --heads origin`: none of the four slice branches of this plan exists on origin yet. Dispatched in parallel, the Repair and Reconcile slices wait on this one by their `waits:` annotation, so no collision is expected. A recent release-area change landed as `the-controller-gate-reads-every-command-segment` (v2.36.0); rebase onto `main` before you start.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
