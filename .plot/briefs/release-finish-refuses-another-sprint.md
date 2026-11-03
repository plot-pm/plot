## Implementation brief — a-release-through-release-approve-leaves (wave 1: Release finish refuses another sprint)

- **Plan (canonical):** docs/plans/2026-11-03-a-release-through-release-approve-leaves.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3071 merged
- **Branch:** `bug/release-finish-refuses-another-sprint` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`plot/review` on the PR)

This wave is first. Wave 2 (`bug/release-approve-tells-its-tracker`) waits on its merge: the tracker step must not run for a sprint the finish refuses.

### What to build

`finishRelease` (`packages/board/src/server/entry/release-finish.ts`) reads the released version from `package.json` on the default branch and books the one active sprint's unstruck Must/Should/Could plans as `Released: <date>, <tag>`. It never checks that the sprint is the one this release belongs to. Once `follow-ups-2-30-1` is the active sprint, a re-run of `release-approve` on the merged v2.30.0 release PR finds the v2.30.0 tag and books the new sprint's Delivered plans under the old tag.

Add the refusal `release-scope-mismatch` to the domain workflow `packages/domain/src/workflows/release-finish.ts`: exactly one active sprint whose `Release:` field names a different version than the tag refuses before any write. Order: after `sprint-ambiguous`, before `plan-unbookable`. `FinishSprint` gains a `release` reading; the controller fills it with `statusField(content, ['Release'])` at the point it builds `sprints` (`release-finish.ts` around line 200). The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **A sprint with no `Release:` field does not refuse.** `skills/plot/templates/sprint.md` leaves the field commented out, so a project that never fills it in must still release. A gate that refused it would block every such project. That sprint keeps today's behaviour.
- **The comparison ignores a leading `v` and reads the field's first version token.** `- **Release:** 2.30.0` matches `v2.30.0`. A raw string compare would refuse a correct release over a one-character spelling difference.
- **An empty active index still answers `already-released`.** The new refusal applies only when exactly one sprint is active.
- **No repair through `release-approve`.** A re-run keeps answering `already-released` and writes nothing. Do not add a second path.
- **Do not import `sprint-transition.ts` into `release-finish.ts`.** It runs its own entry when bundled into `plot-ask.mjs` (see the comment at `release-finish.ts:35-36`). Use the local `statusField`.
- **The refusal is a domain rule, not a controller check.** The controller supplies the reading; `releaseFinish` decides (layering rule in CLAUDE.md). Write new functions as arrows.

### Done when

The plan's `## Done when`/Tests section is the specification. For this wave:

- A domain unit test in `packages/domain/test/workflows-release-finish.test.ts`: one active sprint with `Release:` naming another version refuses `release-scope-mismatch`; the refusal sits after `sprint-ambiguous` and before `plan-unbookable` (a fixture that triggers two reasons shows the order); `2.30.0` vs `v2.30.0` matches; a sprint with no `Release:` books as before.
- A real-repo test in `packages/board/test/unit/release-finish-real-repo.test.ts`: the finish refuses `release-scope-mismatch`, `main` does not move, and no tracker script runs. The file's `sprint()` fixture and `startSprint()` gain a `Release:` line naming the version each test releases, so existing tests keep passing.
- `release-finish-real-repo.test.ts:235` keeps its assertions, restated as "a second run writes nothing": no new commit on `main`, no tracker call.
- Each new test fails on `origin/main` before the change. Check that, not only that it passes after.

Gates: run `node <plot scripts>/board/plot-local-checks.mjs` (path from the skill directory, `skills/plot/scripts/board/`) before each push and run what it prints. CI runs the suites in the `CI suites` key; a failure there comes back as a correction. Do not run `test:e2e`. Add a changeset for `plot` with a `plot-release` bump (description first, `bumps:` block last). The CLAUDE.md `release-approve` sentence and `skills/plot-release/SKILL.md` step 5b belong to wave 2 together with the tracker step, unless the refusal alone needs a mention. If you edit CLAUDE.md, run `./scripts/check-agents-md.sh --write`. This slice touches no `.sh` file, so `check-shell-lines.sh` should not move.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Do not commit `board-server.mjs` or other generated bundles.

### Scope guard

Owned: `packages/domain/src/workflows/release-finish.ts`, `packages/domain/test/workflows-release-finish.test.ts`, `packages/board/src/server/entry/release-finish.ts` (the `release` reading only), `packages/board/test/unit/release-finish-real-repo.test.ts`, one changeset.

Not owned: `deliver.ts`, `entry/release-tracker.ts`, `main.ts`, `FinishContext.scriptDir`. Those belong to `bug/release-approve-tells-its-tracker`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
