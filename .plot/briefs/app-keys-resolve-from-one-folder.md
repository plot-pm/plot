## Implementation brief — app-keys-resolve-from-one-folder (wave 1: Resolver)

- **Plan (canonical):** `docs/plans/2026-11-06-app-keys-resolve-from-one-folder.md` on `main`
- **Approved:** 2026-11-06, Jan Wloka, plan-PR #3202 merged
- **Branch:** `feature/app-keys-resolve-from-one-folder` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Two slices wait on this one: `feature/fleetd-names-a-missing-app-key` (the start probe) and `infra/plot-config-names-app-ids-only` (the `CLAUDE.md` lines). Neither starts before this merges, and the Config slice also waits for the operator to move the keys. This branch changes no `CLAUDE.md` line: the current `<id> <path>` form must keep working.

### What to build

On 2026-11-06 #3196 merged a `Merger app` line naming a key path that did not exist yet, and every merge through the merger app refused `host-refused` for about 30 minutes. The cause is that the config line carries the per-machine path, so a path change is a PR that must merge before the key works. The fix is that a line may name only the App id, and the key is found at a fixed per-user location.

`resolveApp(configKey, here)` in `skills/plot/scripts/plot-github-app.mjs:45` is the one reader for `Merger app` (`plot-merger-token.mjs`), `Writer app` (`plot-push-writer-app.mjs`) and `Review app` (`plot-commit-status.mjs`). Today it splits the config value into `<id> <path>` and refuses when either half is missing. After this branch the key path resolves in this order:

1. `PLOT_REVIEW_APP_KEY`, `PLOT_MERGER_APP_KEY` or `PLOT_WRITER_APP_KEY`, where set (the role follows `configKey`).
2. The path on the config line, where the line still names one. Absolute as written; relative against the repository root, as today.
3. `${XDG_CONFIG_HOME:-$HOME/.config}/plot/plot-<role>.<app-id>.private-key.pem`, with `<role>` `review`, `merger` or `writer`.

A key that none of the three resolves to a readable file refuses with today's `reason` shape and names the path from the first step that applied, so the operator sees where to put the file. The usage text `(format: <key>: <app id> <key path>)` must change to show the path as optional.

The plan's `builds:` annotation names `appKeyPath`. Write it as a pure arrow function: `(role, appId, declaredPath, env, home, root) → string`, with no filesystem access, and have `resolveApp` do the one `accessSync` on its result. The three steps then test without a sandbox.

### Decisions the plan settles — do not re-derive them

**The fixed name carries no date.** A key rotation replaces the file at the same path and needs no config change. A dated name is what made 2026-11-06 a two-step change in the wrong order. Do not add a glob or a "newest key wins" lookup.

**An old-form line keeps working.** Step 2 exists so this branch can merge before the Config slice and before the operator moves any key. Removing it makes the live `CLAUDE.md` lines refuse the moment this merges.

**`plot-bitbucket-commit-status.mjs` is out of scope.** It reads no App key.

### Two points the plan's wording hides

**1. `plot-review-writer.mjs` cannot simply call `resolveApp`.** The plan says it "calls `resolveApp` instead", but the two read different config. `resolveApp` reads through `plot-config.sh`, which reads the working tree. `plot-review-writer.mjs:12-16` reads `Review app` through `git show origin/<default>:CLAUDE.md` and never from the working tree, on purpose: a desk or a PR head must not choose the login its own `plot/review` status is judged against. Switching it to `resolveApp` would move that trust anchor to the working tree and silently weaken `checkedReview`. Keep its parse of the committed config. Replace only its own key-path resolution (`:69-76`) with a call to the shared `appKeyPath`, and let the id-only value pass (`!key` must stop being a refusal). `test/reconcile/review-writer.test.mjs` is the test that must stay green for the trust-anchor behaviour.

**2. One existing test asserts the opposite of step 1.** `test/reconcile/host-commit-status.test.mjs:149`, *"reads the App id/key from ## Plot Config, not the environment"*, sets `PLOT_REVIEW_APP_KEY=/nonexistent/path.pem` and asserts the JWT is still signed with the configured key. Step 1 makes that variable win, so this test fails by design. Do not delete it and do not make it pass by weakening the lookup. Keep its real subject, that `PLOT_REVIEW_APP_ID` is still ignored and the JWT's `iss` is the configured id, and move the key variable into a new test that asserts it overrides the config line. Say in the PR body that this test changed and why.

### Rules carried over unchanged

- **Absent is not false.** `resolveApp` returns `absent: true` only where `plot-config.sh` exited 0 and printed nothing (`test/reconcile/github-app-absent.test.mjs`, #1824/#1827). An id-only line is neither absent nor malformed, and a crashed config read still refuses by name.
- **No credential leaves the process** except in a request header. A key path is not a credential, but never log the key's contents, and never put the JWT or token in an error string.
- **`appId` becomes part of a file name.** Refuse a value containing `/` or `..` before building the path, so a config line cannot point the lookup outside `plot/`.
- **`plot-merger-token.mjs` also checks that `Writer app` and `Merger app` differ.** That check reads ids only and must keep doing so.

### Done when

The plan's `## Done when` list is the specification. If the plan has no such list, these are it: each of the three steps has a test, the refusal names the path of the step that applied, `plot-review-writer.mjs` resolves an id-only line, and `docs/review-status-rollout.md` names the fixed location and the three variables. Assertions that exist because a naive implementation would pass without them:

- **Precedence.** Set all three sources to different readable files and assert the env path wins, then unset it and assert the config-line path wins, then the folder. A lookup that tries the folder first passes each source alone and fails this one.
- **`XDG_CONFIG_HOME` set versus unset.** Both branches of `${XDG_CONFIG_HOME:-$HOME/.config}`. A hardcoded `~/.config` passes on a machine with `XDG_CONFIG_HOME` unset.
- **The refusal names the right path.** With only the id on the line and no key anywhere, the message names the folder path. With a bad path on the line, it names that path. A single hardcoded message passes only one.
- **The role in the file name follows `configKey`.** `Merger app` reads `plot-merger.<id>…`, not `plot-review.<id>…`. A test that only exercises `Review app` cannot tell.
- **The trust anchor.** A working-tree `CLAUDE.md` declaring a different `Review app` than `origin/<default>` must not change the login `plot-review-writer.mjs` prints.

Plus the repo's gates. Add a changeset for package `plot` with the description first and the `bumps:` block last (`plot: minor`, as the lookup is a new capability); run `./scripts/check-changeset-packages.sh`. Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints; the suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. List no full suite.

`scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice edits `.mjs` and `.md` files only, so the gate has nothing to count. If you find yourself touching a `.sh` file, growth is paid for in the same change: remove shell elsewhere, or write the rule in the domain and ask it through a bundle. The gate counts commands, not lines, and has no override.

`scripts/check-no-bundle-diff.sh` refuses a committed generated bundle. These scripts are not bundles, so commit them normally; run no `pnpm build:board` for this slice.

### Bookkeeping

Push the first real commit as soon as it exists. When the PR is open (`../plot/scripts/plot-open-pr.sh`, never `gh pr create`), append `→ #<number>` to this branch's line under `### Resolver` in the plan's `## Slices` section.

### Scope guard

This branch owns `skills/plot/scripts/plot-github-app.mjs`, `skills/plot/scripts/plot-review-writer.mjs`, the tests under `test/reconcile/` that name them (`github-app-absent`, `host-commit-status`, `review-writer`, `merger-token-check`, plus a new file if the lookup needs one), `docs/review-status-rollout.md`, and one changeset.

It does not own `CLAUDE.md` or `AGENTS.md` (Config slice), `packages/fleet/**` or `packages/board/**` (Probe slice), or `packages/domain/src/adapters/merger-app/merger-app-shell.ts`. The Probe slice reuses that adapter and `plot-merger-token.mjs`'s check, so keep both call shapes and exit codes unchanged. `plot-merger-token.mjs` and `plot-push-writer-app.mjs` should need no edit; if one does, report why.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
