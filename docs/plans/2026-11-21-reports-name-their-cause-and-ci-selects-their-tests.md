# Reports name their cause and CI selects their tests

> Four independent defects: reconcile's stale-tally hint names a fix that clears nothing, two external reads report a different fact than the failure they met, `desk_dirt` counts three fleet files as unlanded work, and a pull request's CI selects no test for a plan file or a bundle's entry source.

## Status

- **State:** Draft
- **Type:** bug
- **Issue:** #3586, #3160, #3144, #3149
- **Review:** pr
- **Impl:** own branches

## Changelog

- `/plot-reconcile` section 13 ("Stale sprint tally") names the one fix that clears its finding: tick the item.
- The release-chain scan reports "cannot tell" with the commit and fetch advice where it cannot read a sibling PR's merge commit, not "the first tag that does: none".
- A Jenkins sha read that times out says so and names the bound, and a refusal shows the error of the path that carries it, not the generic `jen auth login` text.
- `plot-reap` and reconcile section 21 no longer keep a merged desk for `.plot-worker.limited` or `.plot-worker.log.1`, and keep one for `.plot-worker.continue.lock` only while the lock holds.
- `plot-reap` prints one row for a desk whose worker is alive, and no longer lists owned trees under `-- dirty trees nobody owns --`.
- A pull request that changes a plan file runs the tests that read every plan, and one that changes a bundle's entry source runs the tests that execute that bundle.

<!-- Board impact: slice "Sibling tag read" changes packages/board/src/server/entry/release-chain.ts; slice "Owned dirty trees" changes reap.ts; slice "Entry sources" changes packages/board/build.mjs (writes a generated, ignored manifest under dist/) and the local-checks entry. No plan format, template or docs/plans layout change. A builder runs `pnpm build:board` to test and commits no bundle (`scripts/check-no-bundle-diff.sh`). -->

## Motivation

**#3586, the stale-tally hint.** Section 13 of `skills/plot/scripts/plot-reconcile-scan.sh` matches only `^- \[ \] \[slug\]` (`:1851`), reads the plan's phase (`:1861`), and counts every unchecked item whose plan is `delivered` or `released` (`:1864-1867`). Its hint at `:1866` reads `fix: tick the item, or add an annotation explaining why it stays unchecked`. Nothing on the line after the slug is read, so an annotation leaves `stale_tally=` unchanged, as the issue's reproduction on Plot 2.35.1 shows. Moving the item to the sprint's Deferred section does not clear it either: the loop reads every line of the sprint file, not one section. Ticking the item is the only fix.

**#3160, a failed read reported as a different fact.**

- `resolvePlanRelease` in `packages/board/src/server/entry/release-chain.ts` sends a failed `tagsContaining` for the last-merged PR to `resolveRelease` (`:202-209`), but for every sibling PR it reads `const own = tags.ok ? tags.value : [];` (`:216`). A sibling whose merge commit is absent from the clone therefore reads as "no tag contains it", goes to `carriedRelease` (`:217`), and `releaseTag` reports "the first tag that does: none" for a commit the scan never read. The line came in with `31a3fb528`. Every `tag-misses-pr` test builds the sibling commit inside the clone (`test/reconcile/scan.test.mjs:4921`), so the fallback never runs in a test.
- `jen()` in `skills/plot/scripts/plot-host.sh` writes `jen api gave no answer within ${PLOT_JEN_BOUND_S} s` on exit 143 (`:3879`), while `jenkins_sha_runs` re-emits only a line matching `^error:` (`:2054`) and then prints `run \`jen auth login\`` (`:2062`). A timeout shows the auth text. The loop runs `plot_tmpfile err_tmp` once per path (`:2031`), so after the loop `err_tmp` holds the root path's stderr only; an expired SSO redirect on the branch path followed by a 404 on the root path reports the 404.
- `test/reconcile/host.test.mjs` declares `apiSleep` in `makeJenStub` (`:2706`) and no test passes `apiSleep:` (0 matches). With `apiMissing` set, the stub's `api` arm exits at `:2757`, before the `case` that follows it.

**#3144, desk dirt.** `desk_dirt` (`skills/plot/scripts/plot-desk-dirt.sh:135-141`) excuses fourteen named fleet files and leaves out `.plot-worker.limited` (read by `packages/fleet/src/server/entry/worker-loop.ts:1241` and `skills/plot/scripts/plot-fleetctl.sh:950`), `.plot-worker.continue.lock` (`continueLockPath`, `packages/fleet/src/shared/continue-lock.ts:39`) and the rotated `.plot-worker.log.1` (`plot-worker-state.sh:78`). The header comment states the omission (`plot-desk-dirt.sh:63-64`) and gives the reason for the lock: a continuation may still run. In a repository whose `.gitignore` does not name these files, a merged desk holding one of them stays kept by `plot-reap` with `uncommitted: ?? <name>`. The reaper reads `desk_dirt` through `dirtyPathsWithStatus` (`packages/domain/src/adapters/trees/trees-git.ts:381-387`). The test "the full file set of a dead worker reads clean" (`test/reconcile/desk-dirt.test.mjs:215-225`) sets no `core.excludesFile`, unlike the per-name test at `:196`, and asserts nothing about git listing the files as untracked, so a global ignore rule makes it pass with no check made. `runDirtyKind` prints the heading `-- dirty trees nobody owns --` (`packages/board/src/server/entry/reap.ts:1518`) and then a `keep … owner: <owner>` row for every owned dirty tree under it (`:1545-1553`), while the worktree kind already printed `keep … worker alive` for the same desk (`:994`).

**#3149, CI selection.** `searchTerms` (`packages/domain/src/rules/local-checks.ts:130-136`) names a changed path by its basename and, for TypeScript, its `.js` form. `ciSelection` treats a path under `corpusGlobs` as plan data and selects no other check for it (`:453-470`). Measured on origin/main `b21961602` with `node skills/plot/scripts/board/plot-local-checks.mjs --ci --files <list>`:

- `docs/plans/2026-11-21-x.md` answers `"tests":[]` and `"corpus":true`. The estate tests "plan-meta: the anchor drops no real claim across the whole estate (differential)" (`test/reconcile/parser.test.mjs:1511`) and "plan-meta: every plan in docs/plans gives the measured count — 0" (`:3013`) read every plan file and do not run. On 2026-11-04 plan PRs #3114 and #3127 passed CI and turned `main` red from `fbf670eaf`; `default-branch-red` held every slice merge for about 13 hours.
- `packages/board/src/server/entry/needs-design.ts` answers `"tests":[]`. `test/reconcile/needs-design-entry.test.mjs` names only the bundle `plot-needs-design.mjs` (`:20`), which `packages/board/build.mjs:1896-1900` builds from that source. PR #3112 changed the source, passed CI, and `main`'s next build `317b020b8` failed the test.

Building is not the gap. CI builds the bundles from the pull request's source before the selection is asked (`.github/workflows/ci.yml:191-195`) and before the `test/reconcile` suites (`:1211-1212`), since `3cd95b330`. The gap is that the selection never names the tests.

## Design

### Approach

**Slice 1, the stale-tally hint (#3586).**

- **Recommendation: reword the hint.** `:1866` reads `fix: tick the item — this section counts every unchecked item whose plan is delivered or released`. The line count stays the same, so `scripts/check-shell-lines.sh` passes with no offset.
- The alternative, reading an annotation, is Open Question 1.
- **Out of scope:** the issue's side question, whether an item that commits to the sprint's `Release:` stays correctly open while that release has not shipped. This slice does not read section 17's release answer.
- **Tests,** in the stale-tally block of `test/reconcile/scan.test.mjs` (`:1712` onward): the finding's fix line reads the new text and does not contain `annotation`; an unchecked item with an HTML comment after its description still counts in `stale_tally=`, so the hint and the count agree.

**Slice 2, the sibling tag read (#3160).**

- In `resolvePlanRelease`, a sibling whose `tagsContaining` answers not-ok returns `resolveRelease` with that sibling's number, merge commit, merge time, base, head, `prSource` and `noFetch`, as the last-merged PR's failed read does at `:202-209`. `carriedRelease` is not asked for a commit the clone could not read.
- This also threads `prSource` and `noFetch` into the finding for that path, which closes the issue's LOW note about the `releaseTag` path having no fetch advice.
- **Tests:** in `packages/board/test/unit/release-chain.test.ts`, a `resolvePlanRelease` cell where the sibling's `tagsContaining` fails answers the cannot-tell finding naming the sibling's sha and the fetch advice, and never contains `none`; a `--no-fetch` cell names the flag. In `test/reconcile/scan.test.mjs`, a `tag-misses-pr` case whose sibling PR names a merge sha absent from the clone asserts that finding.

**Slice 3, the Jenkins sha read (#3160).**

- `jen()` writes the timeout as `error: jen api gave no answer within ${PLOT_JEN_BOUND_S} s`, so the `^error:` reader at `:2054` picks it up. Where that line is a timeout, the refusal names the bound and `PLOT_JENKINS_SHA_BOUND_S`, and does not print the `jen auth login` line.
- `jenkins_sha_runs` makes one stderr file per path before the loop. The refusal shows the first `error:` line of each path that has one, labelled by path, with the branch path first.
- The added lines must be offset in the same change: `scripts/check-shell-lines.sh` refuses growth of shipped shell against the merge base.
- **Tests,** in `test/reconcile/host.test.mjs`: with `PLOT_JENKINS_SHA_BOUND_S=1` and `apiSleep: 5`, the read exits 4 within 3 s and stderr names the bound and has no `jen auth login`; an expired-SSO stderr on the branch path and a 404 on the root path show the SSO line; HTML answers with 200 and with 401 refuse as "did not answer". `makeJenStub`'s `apiMissing` selects an early branch that answers `unknown command: api`, so the `case` has no dead arm. Each new test fails when its behaviour is removed.

**Slice 4, desk dirt (#3144).**

- **Decisions per name** (recommended; Open Question 2 covers the lock):
  - `.plot-worker.limited` and `.plot-worker.log.1` are fleet records no agent reads after a merge. `desk_dirt` excuses both as whole untracked lines, inside the existing `printf` list at `:138`, so the shell line count does not grow.
  - `.plot-worker.continue.lock` is excused by `desk_dirt` too, and the reaper reads the lock separately: `plot-reap`'s worktree kind keeps a desk while `continueLockHeld` (`packages/domain/src/rules/continue-lock.ts`) answers that the lock's holder lives within `CONTINUE_LOCK_BOUND_MS` (60 000 ms, `packages/fleet/src/shared/continue-lock.ts:33`). A dead or expired holder no longer keeps the desk. The reading goes through a port in the reaper's context and the rule stays in the domain. Reconcile section 21 reports and removes nothing, so the excuse alone serves it.
  - The header comment at `:59-64` states the three decisions.
- **Owned dirty trees.** `runDirtyKind` skips a tree that an earlier kind already printed a row for, and prints an owned tree that no kind reported under its own heading `-- dirty trees with an owner --`; `-- dirty trees nobody owns --` lists `LEFTOVER` rows only. The row choice is a domain function beside `dirtyTreeOwner` (`packages/domain/src/rules/sweepable.ts:323`).
- **Tests:** in `test/reconcile/desk-dirt.test.mjs`, one test per name (a merged desk with only that file reads clean, with `core.excludesFile /dev/null`), and a nested `docs/.plot-worker.limited` still reads dirty; the full-file-set test sets `core.excludesFile /dev/null`, adds the three names, and first asserts that `git status --porcelain` lists every file as `??`. In the domain tests for `sweepable.ts`, the row cells; in `packages/board/test/unit/reap-dirty-kind.test.ts`, a desk with a live worker prints one row, and a desk with a held continue lock is kept while one with an expired lock is not.

**Slice 5, plan paths (#3149).**

- **A test declares that it reads the plan estate.** A test file holds the line `// plot-reads: <dir>`, where `<dir>` is a `corpusGlobs` directory such as `docs/plans`. `ciSelection` and `localChecks` select every such test file for a changed path under that directory. Plan data keeps selecting no test that names its basename (`local-checks.ts:440-442`), and `corpus` stays true.
- The builder adds the marker to the test files that read every plan: `test/reconcile/parser.test.mjs` (`:1511`, `:3013`, and the readers at `:2640`, `:2769`), and each other `test/reconcile` file that walks the plan directory with `readdirSync`. 22 files hold both `readdirSync` and a plan path; the builder reads each and marks only the estate readers.
- The rule reads the directory from the `Plan directory` and `Sprint directory` values it already takes, so it holds no project path.
- **Tests,** in `packages/domain/test/local-checks.test.ts`: a changed `docs/plans/x.md` selects a test with `// plot-reads: docs/plans` and not one without; a `// plot-reads: docs/sprints` test is not selected by a plan path; a plan path selects no test that only names its basename; `localChecks` selects the same files as `ciSelection`.

**Slice 6, entry sources (#3149).**

- **The build writes what it builds.** `packages/board/build.mjs` writes `dist/bundle-entries.json` (ignored by `packages/board/.gitignore:2`), one `{ entry, shipped }` pair per `entryPoints` call (73 today), with the shipped path under `skills/plot/scripts/board/`.
- **The rule takes the pairs as a value.** `ciSelection` and `localChecks` take an optional `bundles` reading. A changed path equal to an `entry` adds the shipped basename (such as `plot-needs-design.mjs`) to its search terms, so the tests that execute the bundle are selected. The local-checks entry (`packages/board/src/server/entry/local-checks.ts`) reads the file; a missing or unparseable file maps nothing and the answer says the manifest was absent. In CI the file exists, because the build step at `ci.yml:191-195` runs before "Ask the rule".
- Only the direct entry source maps. A change to a module that an entry imports is Open Question 3.
- `ci.yml`'s comment at the "Build the board bundles" step names that the selection reads the manifest it writes, which answers the issue's request to name the build step.
- **Tests,** in `packages/domain/test/local-checks.test.ts`: a changed `packages/board/src/server/entry/needs-design.ts` with the pair `{ entry: …/needs-design.ts, shipped: …/plot-needs-design.mjs }` selects a test naming `plot-needs-design.mjs`; with no pairs it selects nothing new; a path that is not an entry gains no term. One build test asserts that `dist/bundle-entries.json` holds a pair for `plot-needs-design.mjs`.

### Open Questions

- [ ] **#3586:** reword the hint (recommended, slice 1), or read a defined annotation such as `<!-- open: <reason> -->` on the item and report it as `kept open: <reason>` outside `stale_tally=`? The second needs the matching rule in one place: in shell it grows the line ratchet, and two readers (section 13 and the board's sprint tally) would each need it.
- [ ] **#3144:** is a desk with a held continue lock kept (recommended), or does the lock always count as dirt in `desk_dirt` as today?
- [ ] **#3149:** does slice 6 also map the modules an entry imports, from esbuild's metafile? It would have caught a change to `packages/domain/src/workflows/needs-design.ts` alone, and it would select every test naming `board-server.mjs` for almost any source change.

## Slices

### Stale tally hint

- `bug/the-stale-tally-hint-names-what-clears-it` — section 13's fix line names ticking the item as the one fix, with the scan tests for the line and the count <!-- builds: the stale-tally fix hint -->

### Sibling tag read

- `bug/a-failed-sibling-tag-read-is-cannot-tell` — `resolvePlanRelease` sends a sibling's failed `tagsContaining` to `resolveRelease`, with the unit cells and the absent-sha reconcile test <!-- builds: the sibling tag-read refusal in resolvePlanRelease -->

### Jenkins sha read

- `bug/the-jenkins-sha-refusal-names-its-cause` — `jen()`'s timeout as an `error:` line, one stderr file per path, a refusal naming the bound or each path's error, and the `host.test.mjs` cases with `apiSleep` and an early `apiMissing` branch <!-- builds: the Jenkins sha refusal's cause line -->

### Desk dirt

- `bug/desk-dirt-excuses-the-fleets-own-files` — `desk_dirt` excuses `.plot-worker.limited`, `.plot-worker.log.1` and `.plot-worker.continue.lock`, the reaper keeps a desk while `continueLockHeld` answers held, `runDirtyKind` prints one row per desk under a heading that names its owner status, and the tests <!-- builds: desk_dirt's three fleet-file excuses and the dirty-tree row rule -->

### Plan paths

- `bug/a-plan-pr-runs-the-estate-tests` — a `// plot-reads: <dir>` marker that `ciSelection` and `localChecks` select for a changed path under that directory, the marker on the estate tests, and the unit cells <!-- builds: the plot-reads estate-test marker in local-checks -->

### Entry sources

- `bug/an-entry-source-selects-its-bundle-tests` — `build.mjs` writes `dist/bundle-entries.json`, the selection adds a changed entry's shipped bundle name to its search terms, and the unit and build tests <!-- builds: bundle-entries.json, the entry-to-bundle map for test selection -->

## Notes

- Written 2026-11-21 from the triage of #3586, #3160, #3144 and #3149 at origin/main `b21961602`; every file:line above was re-read there. Each issue is independent and no slice waits on another. Slice 1 (#3586) comes first and stands alone, so it can join a running sprint.
- `plot-deliverable-search.sh` found nothing for any slice's deliverable: "kept open annotation" and "stale tally" matched only unrelated reconcile headings and comments; "tagsContaining" matched the existing callers in `deliver.ts`, `release-chain-walk.ts` and `release-chain.ts`; "jenkins timeout" matched only fleetd's Jenkins transport choice; "continue lock liveness" and "dirty trees" matched only `scripts/state-inventory.json` and unrelated comments; "plan estate tests", "bundle tests" and "bundle entry" found no selection mapping; "searchTerms" matched only `local-checks.ts` itself.
- **Already fixed, left out:** the stale path in `plot-desk-dirt.sh:11` (#3144), which `fc5c284b4` corrected to `packages/fleet/src/shared/registry.ts`.
- **Obsolete, left out:** #3160's note about `.changeset/jenkins-sha-runs-through-jen.md`. Release 2.31.0 (`3afdbb54e`) consumed and deleted that file.
- **Measured fact that moved:** the parser estate test the issue calls "the measured count — 2" now reads "— 0" (`parser.test.mjs:3013`).
- **Already true, not built here:** a pull request's CI builds the bundles from its own source (`ci.yml:191-195`, `:1211-1212`, `3cd95b330`). The issue's "Done when" asks for one sandbox PR per #3149 slice that fails CI; the builder records each run in the PR.
- Changesets: slices 1, 3 and 4 change shipped shell (`'plot': patch`); slices 2, 4, 5 and 6 change packages (`'@plot-pm/board'`). Description first, `bumps:` block last.
