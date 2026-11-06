## Implementation brief — who-may-approve-a-release-and (wave 4: Release finish scope)

- **Plan (canonical):** docs/plans/2026-11-03-who-may-approve-a-release-and.md on main
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3078 merged
- **Branch:** `feature/release-finish-names-unbooked-plans` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** per repo convention (`plot/review` on the PR)

Both waits have merged: `bug/release-finish-refuses-another-sprint` (#3079) and `bug/release-approve-tells-its-tracker` (#3086). This slice is free to start. It waits on nothing else, and no later wave of this plan waits on it.

### What to build

`releaseFinish` books only the sprint's scope plans. A Delivered plan outside the sprint whose changeset shipped under the tag stays Delivered, and the finish output does not name it (#2927). The scope is built in the board entry by `scopeSlugs` (`packages/board/src/server/entry/release-finish.ts:41`) and passed in at `:229`, so the domain never sees a plan outside the sprint.

Add one reading to `releaseFinish` (`packages/domain/src/workflows/release-finish.ts`): `shipped: readonly ReleaseChangeset[] | 'unaskable'`. The rule then does three things.

- It books a Delivered plan that a shipped changeset's `plan:` line names, even where the sprint does not list it.
- It names every other Delivered plan outside the sprint in the finish output, and books none of them.
- It skips and names a plan a changeset names that is not Delivered (Draft, Approved, Released, or a missing path). Such a plan is never added to `scope`, so `plan-unbookable` (`release-finish.ts:141-149`) keeps refusing only for the sprint's own plans. One bad `plan:` line must not refuse the whole release.

`'unaskable'` books the sprint scope only and names `shipped-unread` in the output.

The entry (`entry/release-finish.ts`) fills the reading. The shipped changesets are the `.changeset/*.md` paths the release merge removed. Read them with `Refs.commitFiles(<merge sha>)`, which reads `-m --first-parent`, and read each file's text at the merge's first parent with `Refs.showFile('<merge sha>^1', path)`. `.changeset/` on `origin/<default>` at finish time holds none of them, because the release PR's version commit deleted them. Exclude `README.md`, which the version step does not remove, and `config.json`. Parse each text with `parseChangeset(text).plan` and map it to a `ReleaseChangeset` (`{ file, plan }` in `rules/release-prepare.ts:68`).

Move `scopeSlugs` out of the entry into a domain rule, so the sprint/outside split is a domain decision. Reuse `groupChangesets` (`rules/release-prepare.ts:138`) for that split rather than writing a second one. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

- **The source is the release merge's removed paths, not `.changeset/` on main.** Main holds none of them after the version commit. Reading main would answer an empty list on every release and the slice would look finished.
- **`planReference` is private.** It is `const` in `rules/changeset.ts:95` and not exported. Do not export it and do not copy its regex. `parseChangeset(text).plan` is the reader, and it already applies the first-line-wins rule.
- **One `plan:` reader remains.** `planOfChangeset` in `packages/fleet/src/shared/release-world.ts:41` is a second regex (`/^plan:\s*(\S+)\s*$/m`). Replace it with `parseChangeset(...).plan`. The plan's text says `release-world.ts:40` with no directory. The file is under `packages/fleet/`, not `packages/board/`. The two regexes disagree on `# plan:` and on a trailing-space-free value, which is how a drifted copy starts.
- **A plan named by a changeset is matched through `planSlug`.** `release-prepare.ts:142` strips a date prefix and `.md` before it compares. A `plan:` line names a path (`docs/plans/2026-11-03-x.md`), and a raw compare against a slug never matches.
- **`'unaskable'` is a reading, not an error.** A failed `commitFiles` or `showFile` must not refuse the release and must not read as "no changeset shipped". The absent-is-not-false rule applies: an empty list is an answer and a failed read is `'unaskable'`. Measured 2026-08-27, an empty result read as "no PRs" refused four fully-merged plans.
- **A named plan that is not Delivered is skipped and named.** It is never added to `scope`. Refusing instead was the alternative, and it lets one wrong line in one changeset block the whole release.
- **The threat limit stays stated.** A `plan:` line that names the wrong Delivered plan books that plan Released, and only a person repairs it. The plan's threat-model table says so. Do not add a check that pretends to close it.
- **#3071's limit changes.** Its decision "Plans outside the sprint stay out of scope" now holds only for a plan no shipped changeset names. `packages/board/test/unit/shared-issue-reads-the-post-push-tree.test.ts` uses a plan C left Delivered outside the sprint to prove a shared issue stays open through the sibling read. State in that test that C's changeset carries no `plan:` line. Add a plan D that a changeset names: D is booked and no longer holds the issue open.
- **Both callers pass through one function.** `finishRelease` is called from `entry/main.ts:191` and from `server/passkey.ts:256`. Change `finishRelease` and neither caller needs an edit. Do not touch `passkey.ts`; wave 3 owns it.
- **Write every new function as an arrow**, and keep TSDoc factual: what the export does, its parameters, its return, how it fails. History goes in the commit message.
- **Do not import `sprint-transition.ts`** into the domain rule or the entry. It runs its own entry when bundled into `plot-ask.mjs` (see the comment at `entry/release-finish.ts:37-38`).

### Done when

The plan's `### Tests` section for "Release finish scope" is the specification. Each test must fail on `origin/main` before your change. Check that, not only that it passes after.

- `packages/domain/test/workflows-release-finish.test.ts`: one Delivered plan outside the sprint that a shipped changeset names is booked. A second Delivered plan outside the sprint, named by no changeset, is named in the output and not booked. A named Approved plan and a named missing path are skipped and named, and the finish still books its scope and does not refuse `plan-unbookable`. `'unaskable'` books the scope and names `shipped-unread`.
- `packages/board/test/unit/release-finish-real-repo.test.ts`: the shipped changesets are read from the release merge's removed `.changeset/*.md` paths. The fixture needs a real merge commit that deletes a changeset, because `commitFiles` on a squash or a non-merge commit answers differently. The file's `sprint()` and `startSprint()` fixtures already carry a `Release:` line since #3079; keep them.
- `packages/board/test/unit/shared-issue-reads-the-post-push-tree.test.ts`: the restated plan C and the new plan D, as above.
- A `release-world` test that `planOfChangeset`'s replacement reads a `plan:` line the way `parseChangeset` does, so the two readers cannot drift.

Naive-pass traps, and what each test catches:

- A fixture that puts the changeset on `main` instead of removing it in the merge passes against the wrong source. The real-repo test must delete the file in the release merge and leave `.changeset/` empty on main.
- A fixture whose named plan sits in the sprint scope already passes with no change. Use a plan outside the sprint.
- An assertion on `booked` alone passes if the output names nothing. Assert the named-plans text and the `shipped-unread` text too.

Plus: add a changeset for `plot` with a `plot-release` bump (description first, `bumps:` block last, `plan: docs/plans/2026-11-03-who-may-approve-a-release-and.md` inside the block). Update `skills/plot-release/SKILL.md` step 5b and its Model Guidance row: the finish names Delivered plans outside the sprint. If you edit `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`; the plan assigns the `release-approve` sentence edit to wave 3, which has merged, so check what is there before you change it.

Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `test:e2e`. This slice touches no `.sh` file, so `scripts/check-shell-lines.sh` should not move; if you add one, the growth is paid for in the same change by removing shell elsewhere or asking the domain through a bundle.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (never `gh pr create`), then append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists. Do not commit `board-server.mjs` or other generated bundles.

### Scope guard

Owned: `packages/domain/src/workflows/release-finish.ts`, the new domain rule for the sprint/outside split, `packages/domain/test/workflows-release-finish.test.ts`, `packages/board/src/server/entry/release-finish.ts`, `packages/board/test/unit/release-finish-real-repo.test.ts`, `packages/board/test/unit/shared-issue-reads-the-post-push-tree.test.ts`, the `planOfChangeset` line in `packages/fleet/src/shared/release-world.ts` and its test, `skills/plot-release/SKILL.md` step 5b, one changeset.

In flight and not owned, verified at dispatch: `feature/one-loader-reads-a-role-file` and `feature/the-reviewer-loads-its-role-file` touch `packages/fleet/src/shared/` role files and `review.ts`, not `release-world.ts` or the finish. Open PR #3105 (`bug/the-queue-hands-out-an-approved-spike`) and #3076 (idea) touch neither. `server/passkey.ts` and the release-approve workflow belong to the merged wave 3.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
