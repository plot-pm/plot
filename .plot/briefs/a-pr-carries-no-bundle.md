## Implementation brief — a-branch-carries-no-built-bundle (slice 2: A PR carries no bundle)

- **Plan (canonical):** `docs/plans/2026-10-02-a-branch-carries-no-built-bundle.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/a-pr-carries-no-bundle` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 (`bug/main-builds-its-bundles`) merged as #1249 on 2026-10-03, so `main` now builds and pushes its own bundles. This slice stops a PR from carrying them. `bug/the-artifact-repair-is-retired` waits on this one.

### What to build

A PR's diff must carry no generated bundle, and every reader that today treats a rebuilt bundle as work must stop doing so. Today each PR commits its own build, so every merge makes every other open PR conflict. Measured 2026-10-02: after #1185 merged, all 10 open PRs read DIRTY and 9 conflicted only in bundles.

Six parts, all in the plan's Design section 2:

- **`scripts/check-no-bundle-diff.sh`** refuses a PR diff against the merge base that changes a generated path, with a fixture test beside `test/reconcile/bundle-attribute-gate.test.mjs`. The refusal prints `git checkout "$(git merge-base HEAD origin/main)" -- <each changed generated path>`, plus `git rm` for a path the merge base lacks. It never prints the directory.
- **CI builds before its first test.** Move `pnpm run build:board` ahead of `Helper contract tests` (`ci.yml:184`), `E2E choreography tests` (`:204`) and the systemd steps in `validate`, and add it to the `corpus` job (`:60`). After this slice the checkout holds `main`'s build, and three corpus tests and 14 files under `test/` load bundles.
- **A commit-time gate** refuses a staged generated path on any branch, in the shape of `plot-brief-name-gate.sh`. Register it in `hooks/hooks.json` so `plot-install-hooks.sh` installs it.
- **One sourced filter excuses the generated paths at a desk**, and every desk reader uses it (see the readers below).
- **`reset_desk` restores the generated paths** before its `git checkout --detach origin/<main>` (`plot-worker-loop.sh:1068`). Otherwise the checkout is refused once `main`'s bundles moved, and the loop leaks one desk per slice.
- **The board's automatic repair switches off.** Otherwise it commits a rebuild into a PR that this slice refuses.

Rewrite the text that says "commit the artifact": `.plot/worker-prompt.sh:186` (the clause `run pnpm build:board in THIS worktree and commit the artifact`), `CLAUDE.md` (the Testing paragraph *On a conflict in `board-server.mjs`* and the helper-table row), `docs/definition-of-done.md:27-60`, and the `.gitattributes` header. The `ci.yml` error text now lives in `scripts/main-bundles.sh` (`pr` mode), not at `ci.yml:1080`.

### Decisions the plan settles — do not re-derive them

**The generated set is `BOARD_ARTIFACT_PATHS`, never the directory.** `skills/plot/scripts/board/` holds 36 files and 34 are generated. `README.md` and `plot-monitor.mjs` are written by hand, so a gate on the directory refuses legitimate PRs and a restore on the directory deletes hand-written work. Read the set from the derivation `scripts/check-bundle-attributes.sh` and `scripts/main-bundles.sh` already share (`build.mjs`'s `shipped*` declarations). A typed list drifts: that derivation found a ninth bundle the plan that created it had missed.

**The gate does not refuse `bundles.generated.ts` or `.gitattributes`.** Two PRs that add a bundle still conflict there, and reading that conflict is the correct repair. Refusing them would block the PR that adds the next bundle.

**`main-bundles.sh pr` must stop failing a PR for a stale build.** Slice 1 left `pr` mode as an error when the build differs from `HEAD`. After this slice a PR no longer commits bundles, so a PR that changes board source always builds to something different from its checked-out `main` bundles, and that step would fail every such PR. Replace the `pr` step with the new gate, or change what `pr` means, and cover it in the test. `main`, `publish` and `release` modes stay as slice 1 left them.

**Excusing the bundles in one reader is not enough.** Uncommitted desk changes are read in four places, and the panel's round 1 found that fixing only `plot-desk-dirt.sh` left three readers calling a desk `stalled`:

- `plot_worker_dirty_filter` (`plot-worker-state.sh:539`) decides `stalled`, `desk_is_resettable`, and the `--restart` and `--release` refusals. `trees-git.ts` sources it for `Trees.dirtyPaths`, which `rules/gates.ts` and `rules/movable.ts` read.
- `desk_dirt` (`plot-desk-dirt.sh`) serves the reaper and reconcile §21.
- `bashCleanliness` (`packages/board/src/server/registry.ts`) serves the board's drop rule.
- Raw porcelain reads in the dispatch script (`:1925`, `:3541`) and `plot-fleetctl.sh:1178`. Line numbers moved after the plan was written; find them with `git grep -n 'status --porcelain'` in those files.

All of them read **one** sourced filter that excuses exactly the generated paths, path by path, as the `plot-desk-dirt.sh` header requires: a glob that matched one source file would delete that file with the worktree. The rules in `rules/gates.ts` and `rules/reapable.ts` stay unchanged. Only the reading changes.

**The commit-time gate refuses at commit, not after a 16-minute CI run.** CI is the backstop, not the only gate. Measured 2026-10-02: one `validate` run takes 16–18 minutes.

**The repair line restores from the merge base, not from `HEAD` or `origin/main`.** A restore from the wrong commit was a round 1 finding. `git checkout "$(git merge-base HEAD origin/main)" -- <paths>` is the line the refusal prints, and the test asserts it.

**The automatic repair is switched off, not removed.** Removal is slice 3. The plan names the trigger at `resolver.ts:236-237`. On current `main` that is `REPAIR_SCRIPT` (`:237`) and the guard `mayResolve` (`:81`, called at `:375`). Make `mayResolve` refuse every `artifact-conflict`, so the caller returns `false` as it does for any unrepairable state. Do not delete the script, the resolver or the `Repair` display here, and do not change `artifact-conflict`'s classification. Slice 3 rewords it.

**Rules carried over unchanged from related work:**

- A bundle that cannot answer stops the fleet scan (exit 2). Read the exit code, not the emptiness of stdout.
- A desk filter excuses a path, never a pattern. Absent is not clean: a desk with a source change beside the rebuilt bundles reads dirty.
- A decision that must be tested belongs in a script or in the domain, not in workflow YAML. Workflow YAML has no test tier here.
- Do not describe history in shipped comments. State current behaviour.
- `plot-install-prompt.sh` never overwrites an adopting project's worker prompt. Say so in the changeset.

### Done when

The plan's slice line is the specification: `scripts/check-no-bundle-diff.sh` refuses a generated path in a PR diff and prints the merge-base restore; CI builds before its first test; a commit-time gate refuses a staged generated path; one filter excuses the generated paths in every desk reader; `reset_desk` restores them; the board's automatic repair is switched off.

Assertions that exist because a naive implementation would pass without them:

- **The gate refuses a bundle and passes `README.md` and `plot-monitor.mjs`.** Change one bundle, then change only `skills/plot/scripts/board/README.md`. The first diff fails, the second passes. This catches a directory-wide match.
- **The gate passes a diff that changes `bundles.generated.ts` or `.gitattributes`.** This catches a gate that reads the whole board surface.
- **The printed repair line, run in a fixture, clears the gate.** Run the command the refusal prints and re-run the gate. It passes, including for a path the merge base lacks (`git rm`). This catches wrong paths and a restore from the wrong commit.
- **A PR that changes board source passes `validate`'s freshness step.** The test runs `pr` mode against a tree whose build differs from `HEAD` and expects the new behaviour, not an error. This catches the slice 1 leftover.
- **A desk holding only rebuilt bundles reads clean in each of the four readers, and a desk with a source change beside them reads dirty in each.** One test per reader, over the same fixture. This catches a fix applied to one reader.
- **`reset_desk` completes on a desk whose bundles differ from the new `origin/main`.** This catches the `git checkout --detach` refusal. Assert that a hand-written file beside the bundles survives the reset or is reported, and is not silently discarded.
- **The commit-time gate refuses a staged bundle and accepts a staged `README.md` in the same directory.**
- **`mayResolve` refuses an `artifact-conflict`.** A unit test in `packages/board`. This catches a repair that still commits a rebuild into a PR the new gate refuses.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. List no full suite. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction.
- A new script in `scripts/` needs a name that passes `./scripts/check-script-names.sh`, and temp paths through `plot-tmp.sh` (`./scripts/check-temp-paths.sh`). A new row in `skills/plot/scripts/README.md` is needed for any new script under `skills/plot/scripts/` (`scripts/check-helper-table.sh`).
- Add a changeset. Package `plot`, level `patch`, with the description first and the `bumps:` block last. Name the plan on a `plan:` line inside the block. Copy the format from `git log -- .changeset`, because `.changeset/` is often empty. A board source change also needs one for `@plot-pm/board`, in the package-frontmatter form with no `bumps:` block.
- **Do not run `pnpm build:board` and commit the result.** The new gate refuses it. Run it to test, then restore the generated paths with the line the gate prints. Until this PR merges, CI still compares against `main`'s build.
- Pin every new `uses:` to a commit SHA with the version in a trailing comment, as `release.yml` does.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Do not commit a `PLOT-BLOCKED.md` marker. If you must stop, write it in the worktree only.

### Scope guard

This branch owns:

- `scripts/check-no-bundle-diff.sh` and its fixture test under `test/reconcile/`;
- the commit-time gate and its entry in `hooks/hooks.json`;
- `.github/workflows/ci.yml` (step order, the `corpus` build, the freshness step) and the `pr` mode of `scripts/main-bundles.sh`;
- the desk filter and its four readers: `plot-worker-state.sh`, `plot-desk-dirt.sh`, `packages/board/src/server/registry.ts`, the dispatch script's two porcelain reads, `plot-fleetctl.sh`;
- `reset_desk` in `plot-worker-loop.sh`, and `mayResolve` in `packages/board/src/server/resolver.ts`;
- the four texts that say "commit the artifact".

Do not touch what slice 3 (`bug/the-artifact-repair-is-retired`) owns: `plot-resolve-artifact.sh`, the rest of `resolver.ts`, the `Repair` schema and display, `stuck.ts`, `artifact-conflict`'s wording, and `resolveartifact.test.mjs`. Do not touch `build-bundles.yml` or `release.yml`: slice 1 shipped them.

Other branches in flight that touch `plot-worker-loop.sh`, `plot-worker-state.sh` or `ci.yml` rebase onto yours or the reverse. Check `git diff origin/main...origin/<branch> --stat` for each open remote branch before you push, and report an overlap rather than resolving it by guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
