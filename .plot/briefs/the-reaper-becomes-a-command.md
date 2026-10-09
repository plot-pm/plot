## Implementation brief — the-shell-sheds-its-decisions (wave 4: The reaper becomes a command)

- **Plan (canonical):** `docs/plans/2026-10-09-the-shell-sheds-its-decisions.md` on main
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-reaper-becomes-a-command` (base: `main`)
- **Ends as:** one PR to main
- **Review of the code:** per repo convention

**Ordering:** this slice follows `feature/the-gate-counts-decisions` (#1405), `feature/a-declared-bundle-is-evidence` (#1414) and `feature/the-gate-counts-every-script` (#1416), all merged. `feature/approval-becomes-a-command` waits on this slice, because each slice holds one branch and both may add a write to the same ports (`trees`, `plan-store`).

### What to build

`plot-reap.sh` becomes a launcher over a JS entry. The decision stays where it already lives: `packages/domain/src/rules/reapable.ts` (`firstReapRefusal`) and `rules/sweepable.ts` (`firstBranchRefusal`, `firstClaimRefusal`, `dirtyTreeOwner`). What leaves the shell is the code around those rules: gathering the readings, the loop over desks, branches and claim refs, the `--max` bound per kind, the removal, and the report.

The failure it fixes: `plot-reap.sh` has 1,251 raw lines and 489 code lines (README kind *orchestration*, runs *once per operator command*). It holds four `node --input-type=module` heredocs (`:747`, `:986`, `:1109`, `:1192`) that import the rules from a path derived from the script's own checkout (`RULE_PATH` at `:392`, `SWEEP_RULE_PATH` at `:935`: `<checkout>/packages/domain/src/rules/*.ts`). In the published npm layout `packages/` does not exist, so every heredoc fails, the fail-safe turns the failure into "rule could not be asked", and the reaper keeps every tree. The gate from #1416 counts `plot-reap.sh` as one of the scripts that are not launchers; after this slice it counts one fewer.

Shape: an entry under `packages/board/src/server/entry/` (`reap.ts`), bundled to `skills/plot/scripts/board/plot-reap.mjs` and declared in `packages/board/build.mjs` the way `deliver.ts` and `plot-deliver.mjs` are. The entry follows `deliver.ts`: it assembles adapters (`treesGit`, `refsGit`, `hostShell`, `scriptsShell` and what the readings need), calls the domain, and prints the report. The launcher is `plot-deliver.sh`'s eight lines with `reap` for `deliver`: it resolves `$script_dir/board/plot-reap.mjs`, exits 2 with the same missing-bundle message (names the file, `update the plot plugin`, `pnpm build:board`) and `exec`s `node`.

Desk removal becomes a `trees` port write. `scripts/check-script-names.sh:141` records the gap: *"no port answers this yet. Removing a desk is a `trees` write beside `add` and `prune`."* Add the operation to `ports/trees.ts`, implement it in `adapters/trees/trees-git.ts` and `trees-fixture.ts`, and delete the `plot-reap.sh` line from that table of names once the script holds no `git worktree remove`. The plan is canonical; this brief is orientation.

### Settled decisions — do not re-derive them

**The launcher keeps the name and the arguments.** `--dry-run` (default), `--yes`, `--max N`, `--sweep-temp`, `-h|--help`, and exit 2 with `plot-reap: unknown argument: <arg>`. `scripts/owned-run.sh:77` calls `plot-reap.sh --sweep-temp`, the skills (`plot-dispatch`, `plot-reconcile`, `plot-fleet`) name the `.sh` path, and `scripts/check-temp-paths.sh:53` carries an exception keyed on it. Renaming it breaks callers that no grep in this repo finds all of.

**The report text is the contract.** Seven reconcile suites run the script and match its lines: `reaper.test.mjs`, `reap-agent-liveness.test.mjs`, `reap-detached-desk.test.mjs`, `reap-log.test.mjs`, `reap-manifest.test.mjs`, `reap-merged-pr.test.mjs`, `reap-sweep-temp.test.mjs` (2,244 lines in total). The entry prints the same table (`keep`/`reap` rows, the section headings `-- local branches --`, `-- orphaned claim refs --`, `-- dirty trees nobody owns --`, the `temp:` lines) with the same words. These suites are the specification of the port. Do not edit an expectation to make a run pass; a changed line is a finding to report in the PR.

**The rules do not move and are not rewritten.** `reapable.ts` and `sweepable.ts` stay as they are, with their unit tests. The entry calls `firstReapRefusal`, `firstBranchRefusal`, `firstClaimRefusal` and `dirtyTreeOwner` directly through the narrow path imports `deliver.ts` uses, never through the package root, which would bundle every entity and rule. A rule that cannot be asked refuses: an exception while gathering a reading keeps the tree and says `rule could not be asked — keeping`. Silence is never permission, on this path either.

**Absent is not false.** `unpushed: 'unknown'`, `merge: 'unreachable'` and an unreadable `trees.presence` stay the three values the rule already takes. A host that cannot be asked answers *not merged*, and the tree stays. `plot-pr-merged.sh` reads `mergedAt`, never `state` (a merged PR reports `CLOSED`) and never ancestry (measured 2026-09-04, `git merge-base --is-ancestor` disagreed with the host on ten of ten merged branches). Reach the host through the `host` port and `hostShell`, never through `gh`; `scripts/check-host-cli-callers.sh` refuses a second caller. Do not ask git whether a branch landed.

**`plot-pr-merged.sh`, `plot-desk-root.sh` and `plot-desk-dirt.sh` stay.** Other scripts source them (`plot-release-refs.sh`, `plot-reconcile-scan.sh`, `plot-dispatch.sh`, `plot-approve.sh`, `plot-deliver.sh` and others), so deleting them or editing their behaviour is outside this slice. The entry may use the domain's own answers for the same questions (`rules/desk-root.ts` via `deskRoot`, as `deliver.ts` does). Where the entry and a sourced script now answer one question twice, say so in the PR; a declared duplicate needs a corpus pair, an undeclared one is the defect `CLAUDE.md` (*A Shell Script Asks The Domain*) names.

**The removal is one operation, and it keeps the branch.** `plot-reap.sh` removes CHECKOUTS and not refs: branches and remote refs are untouched, so every reap is re-creatable with `git worktree add`, and `plot-release-refs.sh` owns ref deletion under its own licence. The existing `removeWithBranch` deletes the branch too, which is the booking run's cleanup and not this one. Add a separate write that removes the worktree only. Do not reuse `removeWithBranch` and do not give it a flag. The new write answers `failed` when git refuses; a refused removal is a `keep` row with its reason, never a crash and never a `--force`.

**The temp sweep is a separate mode and runs INSTEAD of the four kinds.** `--sweep-temp` removes `$TMPDIR/plot-?*` entries and `$PLOT_BUDGET_HOME/memo/<pid>` directories that this user owns and that are older than `Temp sweep after` hours (default 24). It lists each candidate and removes it by the full path it listed, never by a glob. It keeps a `plot-reg.<pid>` exit registry while its pid lives. A `TempSweep` port and a `temp-sweep` adapter already exist (`ports/temp-sweep.ts`, `rules/temp-sweep.ts`); read them before writing a second sweep. If the port's `sweep()` already runs this script, do not make the entry call the launcher that calls the entry.

**The gates this slice must satisfy are the point of it.**

- `scripts/check-decision-count.sh pr` fails when the count of non-launcher rows rises, and a row flipped to *launcher* needs its bundle in *Replaced by*. Flip the `plot-reap.sh` row to *launcher* with `board/plot-reap.mjs` named in *Replaced by*, in the same change as the bundle. #1414 made a declared bundle (declared in `packages/board/build.mjs`, entry source present) count as evidence, so one PR can do both. Expected effect: the count falls by one, and the gate prints both numbers.
- `scripts/check-shell-lines.sh` refuses a pull request whose shell under `skills/` is longer than at its merge base. This slice deletes about 1,240 lines and adds eight. The gate stores no number and has no override.
- The CI spawn ratchet *One place reaches a process* (`ci.yml`, `allowed=28`) counts `spawn`/`execFile` in `*.ts` under `packages/` outside `adapters/`. The entry reaches git, `ps` and the host through adapters, so it adds none. If you find you need a `spawn` in `entry/reap.ts`, the write belongs in an adapter.

### Done when

The plan's `## Slices` entry is the specification: `plot-reap.sh` becomes a launcher over a JS entry that asks `rules/reapable.ts`, and desk removal becomes a `trees` port write. Assertions that exist because a naive implementation would pass without them:

- **The seven reap suites pass unedited.** Catches a port that changes what an operator reads. A naive entry that prints a similar table passes a new test written beside it and fails these.
- **The launcher test: a missing bundle exits 2 and names the file and both remedies.** Model it on `test/reconcile/deliver-launcher.test.mjs`. Catches a launcher that falls back to doing the work in shell, which would keep the count where it was.
- **The launcher holds no decision.** Catches the shape the plan exists to remove. Check `plot-reap.sh` by eye against `plot-deliver.sh`: resolve, exit 2 if absent, `exec`. No `case`, no `if` over a reading, no `node --input-type`.
- **A rule that cannot be asked keeps the tree.** Make the readings step throw (a fixture host that fails) and assert a `keep` row with the reason. Catches an entry that treats a failed reading as no refusal; in the direction that deletes work.
- **`--dry-run` removes nothing, and `--yes --max 1` removes one.** Run each against a fixture with two finished desks and list the worktrees after. Catches a `--max` that bounds the report and not the removal, and a dry run that acts.
- **The new `trees` write is tested in `trees-git` and `trees-fixture`**, including the refusal path (a locked or dirty worktree). Catches a write that forces. Mutation-test it: commit first, break one arm (remove the `failed` return), confirm a test fails, restore from git and not from your own copy.
- **The bundle runs from the npm layout.** Run the built `plot-reap.mjs` from a directory with no `packages/` above it (copy the `skills/plot/scripts` tree to a temp directory) and confirm it asks the rule and removes a finished fixture desk. This is the failure that motivated the slice; a test that only runs inside the checkout cannot see it.
- **Corpus: no new duplicate.** The entry imports the rules; it does not copy them. If `desk_unpushed` or `desk_worker_pid` logic moves into the entry, the shell versions are deleted in the same change, not kept beside it.

Plus the repo's gates:

- Build with `pnpm build:board` to test locally, then restore the generated paths before you push. `main` builds its own bundles (`build-bundles.yml`) and `scripts/check-no-bundle-diff.sh` refuses a PR whose diff carries `skills/plot/scripts/board/plot-reap.mjs`. On a conflict in `board-server.mjs`, follow *Testing* in `CLAUDE.md`.
- `node skills/plot/scripts/board/plot-local-checks.mjs` before each push, then run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. List no full suite, and do not run `pnpm run test:e2e` locally.
- Any function you write is an arrow, in `.ts` and `.mjs` alike. TSDoc states what an export does and how it fails, with no history of the decision.
- Update `skills/plot/scripts/README.md`: the `plot-reap.sh` row becomes *launcher*, *Replaced by* names `board/plot-reap.mjs`, and the purpose text keeps what the script does for an operator. Add the new bundle's row if the table lists bundles. `scripts/check-helper-table.sh` is the gate.
- A changeset per `CLAUDE.md` *Versioning*: description first, a `plan:` line and the `bumps:` block last, package `plot`, `plot-dispatch`/`plot-reconcile` untouched unless their text changes. Do not edit versions by hand.
- If you edit `CLAUDE.md` for any reason, run `./scripts/check-agents-md.sh --write`.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never run `gh pr create`: three slice PRs opened that way on 2026-09-08 each took the last commit subject as their title. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-reap.sh` (to a launcher) and its README row;
- `packages/board/src/server/entry/reap.ts` and its `packages/board/build.mjs` declaration;
- the new write in `packages/domain/src/ports/trees.ts`, `adapters/trees/trees-git.ts` and `adapters/trees/trees-fixture.ts`, with their tests;
- the `plot-reap.sh` line in `scripts/check-script-names.sh`;
- a launcher test in `test/reconcile/` and, where the entry needs one, a bundle test;
- one changeset.

Do not edit `reapable.ts` or `sweepable.ts` beyond an export the entry needs. Do not edit `plot-pr-merged.sh`, `plot-desk-root.sh` or `plot-desk-dirt.sh`. Do not touch `plot-approve.sh` or `plot-transition`: `feature/approval-becomes-a-command` owns them, and it has no remote ref at dispatch (2026-10-09). Do not edit `scripts/check-decision-count.sh`; the three gate slices are merged and it is the instrument this slice is measured by. Do not edit generated bundles under `skills/plot/scripts/board/`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
