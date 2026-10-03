## Implementation brief — a-branch-carries-no-built-bundle (slice 3: The repair is retired)

- **Plan (canonical):** `docs/plans/2026-10-02-a-branch-carries-no-built-bundle.md` on `main`
- **Approved:** 2026-10-02, jwloka, in-session
- **Branch:** `bug/the-artifact-repair-is-retired` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

Slice 1 merged as #1249 and slice 2 as #1257 (both 2026-10-03). `main` builds its own bundles and a PR's diff carries none, so nothing produces the conflict the repair exists for. This is the last slice of the plan.

### What to build

Delete the automatic bundle repair, and keep the three things in its files that are not the repair. The repair failed and did damage: `plot-resolve-artifact.sh` runs `pnpm run test:board` before it pushes, that run fails on every local machine (#1112), and the rollback `git reset --hard HEAD~1` removed an operator's pushed commits twice on 2026-10-02 (#1187). Slice 2 already switched it off: `mayResolve` returns `false` for every input, so `startRepair` starts nothing. This slice removes the dead code.

The removal list below is the plan's, re-read against `main` at 3cd95b330. Line numbers moved; find each item with `git grep -n`.

- `skills/plot/scripts/plot-resolve-artifact.sh` and `test/reconcile/resolveartifact.test.mjs` (after the move in the second decision below).
- `packages/board/src/server/resolver.ts`, minus what the first decision keeps, and `packages/board/test/unit/resolver.test.ts`. Slice 2 left `describe.skip` blocks in that test file with the note that this slice deletes them.
- The `plot-resolve-artifact.sh` mentions in `packages/board/build.mjs` (the copy-list entry and the comments near the shipped-script lists), `packages/board/package.json` (`files`), `packages/board/.gitignore`, `scripts/check-script-names.sh`, `packages/domain/test/scripts-shell.test.ts` and `release-smoke.sh`.
- In `fleet.ts`: the `startRepair` call and the three `repair: repairFor(...)` fields. In `schema.ts`: `RepairSchema`, `Repair` and `StuckSchema`'s sibling field `repair` on the branch row. In the client: every rendering of a repair.
- The comments at `stuck.ts` and `plot-reap.sh` that name the repair, and the CLAUDE.md helper row and the `AGENTS.md` mirror.
- `PLOT_BOARD_REPAIR`, `repairEnabledFromEnv` and the `repairEnabled` option (`index.ts`, `board.ts`, `mock-fleet.ts` comment). With no repair there is nothing to switch.

### Decisions the plan settles — do not re-derive them

**`resolver.ts` is not all repair, and deleting the file whole breaks the board.** `primeAgentSettings` lives in it and `server/index.ts` imports it. `repairLogPath` is imported by `packages/board/test/unit/agent-log.test.ts`, which pins where an agent log lives. Before you delete the file, run `git grep -n "from './resolver\|resolver.js"` and move each survivor to the module that owns its subject (`agent-log.ts` is the one place that decides a log's directory). `repairLogPath` goes with the repair: delete its test case in `agent-log.test.ts` and its entry in the "decision lives in exactly one place" sweep if one names it. The plan lists `mayResolve`, `REPAIR_SCRIPT` and `spawnRepair`; it did not list `primeAgentSettings`, because the removal list was read for repair names and this one has none.

**The freshness and set-equality assertions move before the file goes.** `test/reconcile/resolveartifact.test.mjs` (the block around "THE CONTRACT DERIVES rather than lists", about lines 540-640) holds the only test that `bundles.generated.ts` is fresh and equals the set the build emits, that every derived entry is a real file, that `.gitattributes` marks every one `-merge`, and that `plot-monitor.mjs` is not in the set. Move those assertions to `test/reconcile/bundle-attribute-gate.test.mjs` (slice 2 added the sibling gate test beside it). Delete only the assertions that read `plot-resolve-artifact.sh` as text (the `packages/board/build.mjs` derivation match and `ARTIFACT_PATH=` checks), because the script is gone. A deletion without the move leaves nothing that notices a stale `bundles.generated.ts`.

**`artifact-conflict` keeps its classification and changes its meaning.** After slice 2, an artifact-only conflict means *this branch committed a bundle*. It does not mean *the board will repair it*. `stuck.ts` renders the restore command and no pending repair. Slice 2's gate prints the command: `git checkout "$(git merge-base HEAD origin/main)" -- <each changed generated path>`, plus `git rm` for a path the merge base lacks. The row names the same command and never the directory, because `README.md` and `plot-monitor.mjs` are not generated. Three comments encode the old meaning: `stuck.ts` ("while the board can auto-resolve it"), `actions.ts` ("offers nothing IN THIS SLICE. Slice 3 resolves it") and the `StuckSchema` text about the repair in flight. Rewrite them to state current behaviour. That wording is a domain property: assert it in `stuck-display.test.ts`, and once in `stuck-rows.browser.test.ts` so the browser test proves the row shows it.

**A stuck row stays stuck until the branch is fixed.** The old repair removed the state by committing a rebuild. Nothing replaces that, and nothing should: a repair line a person runs once is the replacement. Do not add a different automatic fix.

**The classification does not move.** `isArtifactOnly` and `BOARD_ARTIFACT_PATHS` stay. `bundles.generated.ts` is read by the new gate, `bashCleanliness` and the desk filter. Only the repair's reader of it goes.

Rules carried over from the other slices, so they are not re-learned by breaking them:

- The generated set is `BOARD_ARTIFACT_PATHS`, never the directory. `skills/plot/scripts/board/` holds 36 files and 34 are generated.
- A shipped bundle is `main`'s output. Do not run `pnpm build:board` and commit the result: the slice 2 gate refuses it. Run it to test, then restore the generated paths with the line the gate prints. `main` rebuilds them after the merge.
- Deleting `plot-resolve-artifact.sh` changes what `build.mjs` copies and what `package.json` `files` lists. The bundles that CI rebuilds on `main` change with it. That is expected and is the App's push, not yours.

### Done when

The plan's slice line is the specification: remove `plot-resolve-artifact.sh`, the resolver, the `Repair` display and every listed reference; move the freshness and set-equality assertions; `artifact-conflict` names the restore command.

Assertions that exist because a naive implementation would pass without them:

- **`git grep -nE "resolve-artifact|mayResolve|REPAIR_SCRIPT|spawnRepair|startRepair|repairFor|RepairSchema|PLOT_BOARD_REPAIR"` returns nothing** outside `docs/plans/`, `docs/sprints/`, `docs/notes/`, `.plot/` and the changelogs. Those are dated history and stay. This catches a half-removal that still compiles.
- **`pnpm run typecheck` and the board build pass with `resolver.ts` gone.** This catches the deleted `primeAgentSettings` and `repairLogPath` importers.
- **The moved assertions fail when `bundles.generated.ts` is stale.** Add one bundle declaration to a fixture copy of the build without regenerating, and expect the moved test to fail. This catches an assertion that moved without its teeth.
- **An `artifact-conflict` row shows the restore command and no repair state.** A unit test in `stuck-display.test.ts` over a fixture row with a bundle-only conflict set, one browser assertion that the badge shows it. This catches a row that still says the board is repairing.
- **A branch row parses without a `repair` field.** The client casts the fleet and never parses it, so assert on the server's payload shape and on the client type, not on a Zod default.
- **`scripts/check-script-names.sh`, `scripts/check-helper-table.sh` and `packages/domain/test/scripts-shell.test.ts` pass.** Each carried a row for the script. This catches a stale row that names a file that is gone.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. List no full suite. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction.
- Add two changesets, copying the format from `git log -- .changeset`. Package `plot`, level `patch`: description first, then a `<!-- plan: ... bumps: -->` block last. The description states the user-visible change: the board no longer repairs a bundle conflict and an artifact-only conflict names the restore command. Package `@plot-pm/board`, level `patch`, in the package-frontmatter form with no `bumps:` block.
- After the CLAUDE.md edit, run `./scripts/check-agents-md.sh --write`. CI refuses a mirror that differs.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh`. Do not run `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section.
- Do not commit a `PLOT-BLOCKED.md` marker. If you must stop, write it in the worktree only.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-resolve-artifact.sh` and `test/reconcile/resolveartifact.test.mjs`;
- `packages/board/src/server/resolver.ts`, its unit test, and the importers of what it exported (`index.ts`, `board.ts`, `fleet.ts`, `mock-fleet.ts`, `agent-log.test.ts`);
- `RepairSchema` and the `repair` field in `packages/board/src/contract/schema.ts`, and the client code that renders it;
- the `artifact-conflict` wording in `stuck.ts` and `actions.ts`, with `stuck-display.test.ts` and `stuck-rows.browser.test.ts`;
- the list entries in `build.mjs`, `package.json`, `.gitignore`, `scripts/check-script-names.sh`, `scripts-shell.test.ts` and `release-smoke.sh`;
- the CLAUDE.md and `AGENTS.md` mentions, and the `plot-reap.sh` comment.

Do not touch what slices 1 and 2 shipped: `check-no-bundle-diff.sh`, the desk filter and its readers, `reset_desk`, `build-bundles.yml`, `release.yml` and `scripts/main-bundles.sh`.

Open remote branches at dispatch (checked 2026-10-03): `bug/a-desk-with-no-manifest-says-so`, `bug/a-hand-over-is-checked-before-it-is-made`, `bug/the-desk-has-a-lifecycle`, `bug/the-draft-rule-reads-every-state`, `bug/the-parser-reads-every-wait` and `infra/the-shell-cannot-grow`. Several touch `fleet.ts` and `plot-worker-loop.sh`. Before you push, check `git diff origin/main...origin/<branch> --stat` for each, and report an overlap in `fleet.ts` or `schema.ts` rather than resolving it by guess.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
