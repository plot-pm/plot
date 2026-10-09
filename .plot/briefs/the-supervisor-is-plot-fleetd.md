## Implementation brief — the-fleet-runs-without-the-board (wave 3: The supervisor is plot-fleetd)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-supervisor-is-plot-fleetd` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave follows `feature/the-fleet-package-exists` (#1421, merged 2026-10-09 as `d8362ed74`), which created `packages/fleet`. It runs before `feature/the-fleet-owns-the-scan-and-pr-index`, which adds the scan clock to the same entry file, so the rename lands first and that wave starts from the new name. No sibling branch of this plan is pushed, and no open PR touches `plot-fleetctl.sh`, the unit templates, `ci.yml` or either `build.mjs` (`gh pr list`, 2026-10-09).

### What to build

`plot-registryd` becomes `plot-fleetd` everywhere a machine or a person addresses it, and an installed unit under the old name is migrated to the new one instead of being left behind. Four names change:

| Old | New |
|---|---|
| bundle `skills/plot/scripts/board/plot-registryd.mjs` | `plot-fleetd.mjs` |
| default launchd label `com.plot-pm.registryd` (and `com.plot-pm.registryd.<x>`) | `com.plot-pm.fleetd` (and `com.plot-pm.fleetd.<x>`) |
| systemd unit `plot-registryd` (and `plot-registryd-<x>`) | `plot-fleetd` (and `plot-fleetd-<x>`) |
| unit templates `com.plot-pm.registryd.plist`, `plot-registryd.service` | `com.plot-pm.fleetd.plist`, `plot-fleetd.service` |

The failure this prevents, measured on 2026-10-09: this machine holds `com.plot-pm.registryd` loaded right now (`launchctl list`: pid 309). A filled plist bakes the absolute path of the bundle into `ProgramArguments` (`plot-fleetctl.sh` fills `__REGISTRYD__` with `$script_dir/board/plot-registryd.mjs`). Once this slice merges and a checkout updates, that path no longer exists. `KeepAlive` is `true` and `ThrottleInterval` is 60, so launchd restarts `node` on a missing file once a minute for as long as the label stays loaded. `--status` then prints `LOADED, NOT RUNNING`, and a person has to read the log to learn why. That is the orphan the plan names.

Measured 2026-10-09 on `main` at `d8362ed74`: outside plans, briefs, panels, changelogs and changesets, `registryd` appears on 455 lines in 82 files. The files that decide behaviour are `plot-fleetctl.sh` (30 lines), `packages/fleet/build.mjs` and `packages/board/build.mjs` (5 and 7), `.github/workflows/ci.yml` (9), the two unit templates, `.gitattributes` (line 75), `skills/plot/units/README.md` (34) and `test/reconcile/fleetctl.test.mjs` (76). The rest is tests, comments and docs.

### Decisions the plan settles — do not re-derive them

**The name is `plot-fleetd`, decided by the operator on 2026-10-09.** The plan's Open Questions record it. Do not reopen `plot-fleetd` against `plot-supervisor` or `plot-registryd`.

**`registry` the concept keeps its name.** `registry.ts`, the `Agent registry` config key, `.plot/agents` and the Registry/Machine split in `CLAUDE.md` describe identities, and the daemon is not the registry. Rename the daemon and the things named after the daemon, and nothing else. A grep-and-replace of `registry` is the mistake to avoid here.

**A label override is the operator's own string and stays valid.** `PLOT_FLEET_LABEL` accepts any string (`com.quatico.ewz.registryd` exists in the wild; `skills/plot-fleet/SKILL.md:116` documents `com.plot-pm.registryd.ewz-kus-portal`). Only the DEFAULT changes. `unit_name` (`plot-fleetctl.sh:99-104`) maps the default label to the unit name and the `com.plot-pm.registryd.` prefix to `plot-registryd-`; give it the same two mappings for the new names. A label the operator set explicitly is never renamed or rewritten.

**The migration must cover three paths, and all three are needed.** Skipping any of them leaves an old unit that no command can see:

1. `--start` finds an old-name unit that serves THIS checkout, unloads it, removes its file and fills the new one. `supervisor_checkout` (`plot-fleetctl.sh:194-250`) already answers `this`, `another` or cannot-determine. Migrate only on `this`. On `another` or unknown, leave it loaded, say so, and say that the checkout it serves migrates when it runs `--start`. This is REFUSAL 4's rule ("not yours to stop") applied to the old name, and `launchd` keys by label across the whole machine, so a wrong guess unloads another checkout's supervisor.
2. `--stop` and `--status` still find an old-name unit. Without this, an operator who updates Plot and runs `/plot-fleet --stop` reads `supervisor was not loaded` while the old daemon keeps running. That is the 2026-09-29 failure (`plot-fleetctl.sh:256-261`: a label search misses a label nobody searched for) wearing a new name.
3. The process discovery block recognises both bundle names. `plot_process_candidates` matches `/board/plot-registryd.mjs` (`:324`) and the suffix case at `:404` repeats it. A supervisor still running from the old bundle must stay visible to `--status` until it is migrated. Record in the PR the date on which the old-name arms are removed in a later release, so they do not stay forever.

**The bundle rename needs no bundle in the PR.** `scripts/check-no-bundle-diff.sh` refuses a generated path in a PR's diff, and `main-bundles.sh publish` builds and commits the generated set after every merge. Both derive the set from the `shipped* = path.join(...)` declarations in `packages/board/build.mjs` (`:401` today). Two consequences, both read from `scripts/main-bundles.sh:61-110` and `scripts/check-no-bundle-diff.sh:60-76`:

- After the rename the old path is no longer in the derived set. Neither gate sees it, `publish` stages only paths in the set, and nothing removes the tracked `plot-registryd.mjs`. **Delete it in this PR with `git rm`.** The gate does not refuse the deletion, because the old path is no longer a generated path once `build.mjs` stops declaring it. If you keep `plot-registryd.mjs` tracked, a checkout carries two supervisors' bundles and `plot-fleetctl.sh --start`'s refusal 1 (a missing artifact) never fires for the right one.
- Between the merge and the App's bundle push there is a window in which `main` holds no `plot-fleetd.mjs`, and `--start` refuses with *no supervisor artifact*. That is correct and short. Do not commit a built bundle to close it; say in the PR that the window exists.
- `.gitattributes:75` carries `-merge` for the old bundle, and `bundles.generated.ts` lists it. Change both. Neither gate refuses a change to them.

**The shipped shell may not grow, and this slice grows it.** `scripts/check-shell-lines.sh` counts non-comment, non-blank lines of every `.sh` file under `skills/` against the merge base, stores no number and has no override. `plot-fleetctl.sh` is 1,274 lines and the migration adds branches to three of its arms. Pay for it in the same change: the legacy-unit decision (which old unit serves this checkout, may it be migrated, what the refusal says) is a rule, and `CLAUDE.md` § *A Shell Script Asks The Domain* says a script that runs once per operator command asks the domain. `--start`, `--stop` and `--status` each run once per operator command. Write the rule in `packages/domain` as an arrow function and ask it through a bundle, or remove an equal number of lines elsewhere in the same change. A pure rename is line-neutral and costs nothing.

**The old log files are left on disk.** The plist writes `.plot/logs/registryd.log` and `registryd.err`; `process-log.ts`, `registryd-main.ts`, `queue.ts`, `plot-fleetctl.sh` (`:462`, `:707`, `:757`) and `log-rotation.test.mjs` (10 lines) name them. Rename the log to `fleetd.log` and `fleetd.err` so the log carries the daemon's name, change every reader in the same commit, and never delete or move the old file. A person may be reading it, and the rotation ceiling already bounds its size.

**Source files rename with `git mv`, in a commit of their own that changes no content.** `registryd-main.ts`, `registryd.ts` and the tests named after them become `fleetd-main.ts`, `fleetd.ts` and so on. Git follows a rename when the content is unchanged, so `git blame` survives; a rename mixed with edits does not. Put identifier and string changes in the next commit. The unit is the function: do not rewrite a moved `function` declaration into an arrow, and write new functions as arrows.

**Historical records keep the old name.** Do not edit `docs/plans/`, `.plot/briefs/`, `.plot/panels/`, `CHANGELOG.md` or `.changeset/` files that exist on `main`. They are dated records of what the name was. `docs/stories/the-master-agent-holds-the-fleet/DESIGN-process.md` is a living spec whose terminology is binding, so rename the 4 occurrences there.

**Rules carried over unchanged:**

- Read the exit code, not the emptiness of stdout. `launchctl print` answers 1 for some absences and 113 for others; `supervisor_loaded` already normalises it.
- A unit is filled and the fill is verified: a surviving `__PLACEHOLDER__` deletes the unit and refuses. Renaming `__REGISTRYD__` to `__FLEETD__` must change the template, the `sed` expression, `ci.yml:365` and `:455`, and `registryd-units.test.ts` together.
- The unit stops only its daemon (`KillMode=process`). Migration unloads the old supervisor and leaves every agent running, as `--stop` does for the unit.
- Absent is not false. An old unit that cannot be read is reported as cannot-determine and left alone.

### Done when

The plan's slice line is the specification: the bundle, `plot-fleetctl.sh`, the service label and the docs use the new name, and an installed unit under the old label is migrated, not orphaned.

Assertions that exist because a naive implementation would pass without them:

- **The migration runs against an old-name unit that serves this checkout and unloads it, in a sandbox.** `test/reconcile/fleetctl.test.mjs` already puts a `launchctl` and a `systemctl` stub on `PATH` (`:167-196`) and every `run()` passes through that guard. Add cases where the stub reports the old label loaded and serving the sandbox repository, and assert the stub received `bootout` for the old label and `bootstrap` for the new one, in that order. Add a case where the old unit serves another checkout and assert it received no `bootout`. A rename test that only checks the new name passes without any migration.
- **`--stop` and `--status` see an old-name unit.** One case per command, with the old label loaded and no new one. Without it, the two commands pass on a fresh install and fail on the one machine that needs them.
- **A test never reaches the operator's real init system.** `fleetctl.test.mjs:173` records that an unguarded call ran `launchctl bootout` on the operator's `com.plot-pm.registryd` three times in one morning (measured 2026-09-22). That label is loaded on this machine now. Every new case goes through the guard, and none runs `--start`, `--stop` or the migration against the real label. To see the real command work, use a spare `PLOT_FLEET_LABEL` and clean it up by the exact label you bootstrapped.
- **No bundle in the diff, and the old one is gone.** `./scripts/check-no-bundle-diff.sh` passes, `git ls-files skills/plot/scripts/board | grep registryd` prints nothing, `BOARD_ARTIFACT_PATHS` holds 34 paths with `plot-fleetd.mjs` in place of `plot-registryd.mjs`, and `.gitattributes` carries `-merge` for the new name and none for the old. Run `./scripts/check-bundle-attributes.sh` and `./scripts/check-bundle-resolution.sh`.
- **The systemd unit still verifies.** `ci.yml:365-374` fills `plot-registryd.service` and runs `systemd-analyze --user verify`; `:455` fills it again. Change both to the new file and unit name. This runs on `ubuntu-latest` only, so read the filled output with the same `sed` locally if you have no Linux machine.
- **The launchd arm cannot run on CI.** The new label in the plist is exercised only through the stub and `plutil -lint` on a Mac. Run `plutil -lint` on the filled plist and say so in the PR.
- **A grep proves the rename is complete.** After the change, `git grep -n registryd -- . ':!docs/plans' ':!.plot/briefs' ':!.plot/panels' ':!CHANGELOG.md' ':!.changeset'` prints only the lines that deliberately keep the old name: the legacy arms in `plot-fleetctl.sh` and the tests for them. State the remaining count and where each sits in the PR.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally. `test/reconcile/fleetctl.test.mjs` is a whole-file `node --test`; run it by the test names you touched.
- `scripts/check-shell-lines.sh` is described under *The shipped shell may not grow* above. Run it before you push.
- Add a changeset under `.changeset/` with package `plot`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` and `plot-fleet: minor`. The description names the new default label and says an installed unit under the old label is migrated by `/plot-fleet --start`. Run `./scripts/check-changeset-packages.sh`.
- Do not commit rebuilt bundles. Run `pnpm build:board` to test, then restore any generated path from the merge base before you push. The one exception is the `git rm` of the old bundle above.
- Update the `skills/plot/scripts/README.md` rows for `plot-fleetctl.sh` and for the bundle (`./scripts/check-helper-table.sh`), and `skills/plot-fleet/SKILL.md` and its `README.md`. Both skills carry a Model Guidance table; leave it unchanged unless a step changes tier.
- `CLAUDE.md` and `AGENTS.md`: if you touch `CLAUDE.md`, run `./scripts/check-agents-md.sh --write`.
- Do not run the board's tests while an operator's board is open on this machine, and clear `PLOT_REPO_ROOT` in any sandbox test you add.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, with `--draft` while the work moves. Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### The supervisor is plot-fleetd` in the plan's `## Slices` section.

Push the first real commit as soon as it exists, so the claim shows work. The `git mv` commit is a good first push.

### Scope guard

This branch owns:

- the bundle declaration in `packages/fleet/build.mjs` and `packages/board/build.mjs`, `.gitattributes`, `packages/board/src/contract/bundles.generated.ts`, and the `git rm` of `skills/plot/scripts/board/plot-registryd.mjs`
- `skills/plot/scripts/plot-fleetctl.sh` and the process-discovery block inside it
- `skills/plot/units/` (both templates and `README.md`)
- `packages/fleet/src/server/entry/registryd-main.ts` and `registryd.ts`, their tests, and the log-name readers in `packages/fleet/src/shared/process-log.ts` and `packages/domain/src/rules/queue.ts`
- `.github/workflows/ci.yml` lines that fill or name the unit and the bundle
- docs: `skills/plot-fleet/`, `skills/plot/scripts/README.md`, `DESIGN-process.md`, `scripts/check-bundle-attributes.sh` and `scripts/check-registry-not-leaked.mjs` (comments only)
- `test/reconcile/fleetctl.test.mjs`, `test/reconcile/log-rotation.test.mjs`, `packages/board/test/unit/registryd-units.test.ts`

This branch does not own, and must not edit:

- the scan clock, the PR index writer, auto-dispatch or auto-delivery (waves 4 and 5; `feature/the-fleet-owns-the-scan-and-pr-index` edits the same entry file after this one)
- the `registry` module, the `Agent registry` config key, `.plot/agents`, or any "registry" that names identities
- `plot-ask.mjs` and the controllers (wave 6)
- historical plans, briefs, panels, changelogs and existing changesets

Branches in flight: `feature/a-merged-pr-shows-no-ci-state`, `feature/the-brief-ask-names-its-branch` and `feature/the-reaper-becomes-a-command` are pushed. None has an open PR touching `plot-fleetctl.sh`, the units, `ci.yml` or a `build.mjs` (checked 2026-10-09). If one of them lands a `registryd` string while this branch is open, the grep assertion above catches it at rebase.

If you find something the plan did not anticipate — the stale tracked bundle and the three-path migration above are the first such finds — report it rather than improvising outside scope.
