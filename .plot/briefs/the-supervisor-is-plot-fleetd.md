## Implementation brief — the-fleet-runs-without-the-board (wave 3: The supervisor is plot-fleetd)

- **Plan (canonical):** `docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` on `main`
- **Approved:** 2026-10-09, jwloka, in-session
- **Branch:** `feature/the-supervisor-is-plot-fleetd` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR

This wave follows `feature/the-fleet-package-exists` (#1421, merged 2026-10-09 as `d8362ed74`), which created `packages/fleet` and left every bundle name unchanged on purpose. `feature/the-fleet-owns-the-scan-and-pr-index` (wave 4) edits the same supervisor entry and waits on this rename. No sibling branch of this plan is pushed (`git ls-remote` on 2026-10-09 finds none for this branch).

### What to build

The supervisor process is called `plot-registryd` in its bundle, its launchd label, its systemd unit and its docs. The operator decided on 2026-10-09 to call it `plot-fleetd`, the word the estate already teaches (`/plot-fleet`). This wave renames the artifact and what installs it, and migrates an installed unit so that it is replaced and not orphaned. Nothing about what the supervisor decides changes.

Measured 2026-10-09 on `main` at `7865973ae`, the rename touches these places:

- **The bundle:** `packages/fleet/build.mjs:15` (`registrydArtifact`, `dist/plot-registryd.mjs`), `packages/board/build.mjs:401` (`shippedRegistryd`), `.gitattributes:75`, `packages/board/src/contract/bundles.generated.ts:69` (generated, written by the build), `scripts/check-bundle-attributes.sh:8` (a comment), and the six `plot-registryd.mjs` strings in `.github/workflows/ci.yml` (`:365-374`, `:455-457`, `:886`).
- **The units:** `skills/plot/units/com.plot-pm.registryd.plist`, `skills/plot/units/plot-registryd.service` and `skills/plot/units/README.md`. The placeholder `__REGISTRYD__` appears in both templates, in `plot-fleetctl.sh:1013-1030`, in two CI steps and in `fleetctl.test.mjs`; the CI step's own comment says it is a third copy of the set, and a gate catches a placeholder that is missing from one of them.
- **The launcher:** `skills/plot/scripts/plot-fleetctl.sh`, with the variable at `:117`, the default label at `:84`, the systemd name derivation at `:93-103`, the process classifier at `:324` and `:404`, the unit paths at `:1013-1018`, and the messages.
- **Docs:** `skills/plot-fleet/SKILL.md` and `README.md`, `skills/plot/scripts/README.md`, `skills/plot/units/README.md`.
- **Tests that name the old strings:** `test/reconcile/fleetctl.test.mjs` (76 lines), `artifact.test.mjs`, `bundle-resolution-gate.test.mjs`, `sandbox-scrubs-repo-root.test.mjs`, `log-rotation.test.mjs`, `packages/board/test/unit/registryd-units.test.ts`, `packages/fleet/test/worker-loop-bundle.test.mjs`, and the tick-line assertions in `packages/fleet/test/unit/registryd-tick.test.ts` and `registryd-main.test.ts`.

In all, 358 tracked lines in 63 files name `registryd`, outside `docs/`, `.plot/`, the bundles and the changelogs. Most of them are comments and test names. They are not the work, and the first decision below says why.

### Decisions the plan settles — do not re-derive them

**Rename the artifact, the label, the unit and the tick prefix. Do not rename source files, test files, identifiers or comments.** `registryd-main.ts`, `registryd.ts`, the `registryd-*.test.ts` files and the 358 lines above keep their names. A rename of 63 files produces a diff with no behaviour change and destroys `git blame` for every touched line, which is the measurement that scoped the domain's arrow-function rule in `CLAUDE.md` (*The unit is the function, not the file*). The rename is of what the OS, the operator and the other scripts address: the bundle path, the label, the unit name and the placeholder.

**The new names.** Bundle `plot-fleetd.mjs`. Default launchd label `com.plot-pm.fleetd`. Default systemd unit `plot-fleetd`. Placeholder `__FLEETD__`. Unit templates `com.plot-pm.fleetd.plist` and `plot-fleetd.service`. The tick line prefix becomes `plot-fleetd tick`. Measured by grep on 2026-10-09: no code parses that prefix, and only the tick tests assert it, so it is safe to change. The log files keep their names, `.plot/logs/registryd.log` and `registryd.err`. Four places read the log path (`plot-fleetctl.sh:462`, `:707`, `:757`, `:1081`), `registryd-main.ts:2039-2040` opens it, and the units write to it. A renamed log would split one tick history in two across the upgrade, and `--status` would read an absent file as no tick. Wave 4 may rename the log; this wave does not.

**The old bundle path must be removed, not left.** `scripts/main-bundles.sh` stages only the paths that `build.mjs`'s `shipped*` declarations name. After the rename `skills/plot/scripts/board/plot-registryd.mjs` is in no declaration, so `main` never rebuilds it and never deletes it. A tracked file that nothing updates is a frozen daemon: a loaded unit keeps running last week's supervisor code and reports nothing wrong. A removed file is loud: launchd restarts the job every 60 s (`ThrottleInterval`) and `registryd.err` fills with `Cannot find module`. Choose loud. Remove the file in this PR with `git rm`, and run `scripts/check-no-bundle-diff.sh` to confirm it accepts the deletion, because it reads the generated set from the branch's `build.mjs` and the old path is no longer in it. If it refuses, the refusal prints the repair; follow it and do not weaken the gate.

**The migration is for the default label, and a custom label keeps its name.** Measured on this machine, 2026-10-09, there are two installed units and they need different handling:

- `com.plot-pm.registryd` runs `/Users/jwloka/Quatico/Agentic-Tools/plot/skills/plot/scripts/board/plot-registryd.mjs`, a path in the repository this wave changes. After the merge the file is gone and this unit crash-loops until it is replaced. This one is migrated.
- `com.plot-pm.registryd.ewz-kus-portal` runs `/Users/jwloka/.claude/plugins/cache/plot-marketplace/plot/2.22.2/skills/plot/scripts/board/plot-registryd.mjs`, a released plugin copy, and its pid 10931 serves `/Users/jwloka/Quatico/ewz/ewz-kus-portal`. That path is in a different install and stays valid. Renaming its label because the label starts with `com.plot-pm.registryd.` would orphan a healthy supervisor. A label an operator chose through `PLOT_FLEET_LABEL` is the operator's; the rename changes only the default.

So `plot-fleetctl.sh --start` under the default label finds an installed unit at the old default label (`~/Library/LaunchAgents/com.plot-pm.registryd.plist`, or `plot-registryd.service`), boots it out, removes its file and installs the new one, and it says so in its output. It does this only when that unit's `ProgramArguments` name a bundle inside `$repo_root`: a unit that serves another install is not this checkout's to migrate. REFUSAL 4 (`:957-985`, *the label is taken*) keeps its behaviour for every other case. The systemd derivation at `:93-103` strips `com.plot-pm.registryd.` from a custom label to form `plot-registryd-<name>`. Keep that mapping for the old prefix so that an existing custom Linux unit keeps its name, and give the new prefix `com.plot-pm.fleetd.` the same treatment with `plot-fleetd-<name>`. The systemd arm cannot be run here (`plot-fleetctl.sh:202` says no Linux machine was available); the fixture test and the CI `systemd-analyze verify` step are its only proof, so say in the PR that it is unproven on a real unit.

**The process classifier must recognise both names, and for longer than this wave.** `plot-fleetctl.sh:324` and `:404` identify a supervisor by the path suffix `/board/plot-registryd.mjs`. A classifier that knows only `plot-fleetd.mjs` makes pid 10931 above invisible to `--status`, to the *plot processes on this machine* listing and to `--stop`, while it keeps running and holding a worktree lock. That process runs the old name for as long as the plugin cache copy exists. Accept both suffixes and keep both indefinitely; removing the old one is a later decision with its own measurement.

**The fix for a stale label is in `--status`, not only in `--start`.** A unit that is loaded and whose bundle path no longer exists is a state of its own. `--status` today prints `LOADED, NOT RUNNING` for a label with no pid (`:699`), which is true and does not say why. When the unit's bundle is missing, say that, and print the one command that repairs it. Do not make `--status` repair anything: it reads, and `--start` writes.

**Rules carried over unchanged from this fleet's earlier work:**

- Read the exit code, not the emptiness of stdout. `launchctl print` answers 1 for some absences and `launchctl bootout` answers 113 for an unloaded label; a migration that treats an already-absent old unit as a failure refuses a clean machine.
- Absent is not false. A machine with no old unit migrates nothing and says nothing.
- `plot-fleetctl.sh` reads nothing from another process through a shell evaluator (`:262-267`). Do not add an `eval` or a `sh -c` for the plist path.
- A fixture test runs in a private `HOME` and clears `PLOT_REPO_ROOT`. The existing `fleetctl.test.mjs` fixtures show how; a test that loads a real launchd job on this machine takes the operator's supervisor down.

### Done when

The plan's slice line is the specification: `plot-registryd` becomes `plot-fleetd`; the bundle, `plot-fleetctl.sh`, the service label and the docs use the new name; and an installed unit under the old label is migrated, not orphaned.

Assertions that exist because a naive implementation would pass without them:

- **A sandbox with an old default-label unit migrates.** Build a fixture `HOME` holding `com.plot-pm.registryd.plist` whose `ProgramArguments` name `$repo_root/skills/plot/scripts/board/plot-registryd.mjs`, with a stub `launchctl` that records its calls. `--start` must `bootout` the old label, remove the old file, write the new plist and `bootstrap` it, in that order. A test that only checks the new plist exists passes on an implementation that leaves the old job loaded and so runs two supervisors on one repository.
- **A custom-labelled unit survives.** The same fixture with `PLOT_FLEET_LABEL=com.plot-pm.registryd.other` and a bundle path outside `$repo_root` must `bootout` nothing. This catches a prefix match on the label.
- **The classifier sees both names.** Feed `plot_process_candidates` one `node …/plot-registryd.mjs` row and one `node …/plot-fleetd.mjs` row; both must come back as `supervisor`. The existing classifier tests in `fleetctl.test.mjs` show the input shape.
- **A missing bundle is named.** A loaded label whose bundle path does not exist makes `--status` say the bundle is missing and print the repair, not only `LOADED, NOT RUNNING`.
- **The gates still see the bundle.** `BOARD_ARTIFACT_PATHS` must hold `plot-fleetd.mjs` and not `plot-registryd.mjs`, `.gitattributes` must carry `-merge` for the new path, and `test/reconcile/bundle-attribute-gate.test.mjs` and `bundle-resolution-gate.test.mjs` must pass with the new name. A rename that leaves `.gitattributes` on the old path drops the new bundle out of `-merge` and nothing fails until two PRs conflict in it.
- **The three copies of the placeholder set agree.** `plot-fleetctl.sh`, the two CI steps that fill the systemd unit and `fleetctl.test.mjs` all name `__FLEETD__`. The CI step's comment says a gate catches a drift, so run that gate and read its output.
- **The built bundle is the renamed program.** `pnpm build:board` must produce `skills/plot/scripts/board/plot-fleetd.mjs` and `node skills/plot/scripts/board/plot-fleetd.mjs --once` must start in a sandbox repository. The bundle test `packages/fleet/test/worker-loop-bundle.test.mjs` names the old file; change it and run it.

Plus the repo gates:

- Run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` config key run in CI, and a failure there comes back as a correction. Do not run `pnpm run test:e2e` locally, and do not run board tests while an operator's board is open on this machine.
- Add a changeset under `.changeset/` with package `plot`, description first and the `bumps:` block last, with `plan: docs/plans/2026-10-09-the-fleet-runs-without-the-board.md` and `skills: plot-fleet: minor`. Run `./scripts/check-changeset-packages.sh`.
- Do not commit rebuilt bundles. `main` builds them after each merge and `scripts/check-no-bundle-diff.sh` refuses a PR that carries one. The one exception is the deletion of the old `plot-registryd.mjs` described above; use `pnpm build:board` to test, then restore every other generated path from the merge base before you push.
- `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice edits `plot-fleetctl.sh` and adds a migration to it, so it grows that file. Pay for the growth in the same change: remove shell elsewhere, or write the migration decision (does this unit belong to this checkout?) as a domain rule and ask it through a bundle. The gate stores no number and has no override.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh`, with `--draft` while the work moves. Do not run `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line under `### The supervisor is plot-fleetd` in the plan's `## Slices` section.

Push the first real commit as soon as it exists, so the claim shows work.

### Scope guard

This branch owns:

- the rename sites listed under *What to build*: `packages/fleet/build.mjs`, `packages/board/build.mjs`, `.gitattributes`, the two `ci.yml` steps, `scripts/check-bundle-attributes.sh`, the two unit templates and their README, `skills/plot/scripts/plot-fleetctl.sh`, `skills/plot-fleet/`, `skills/plot/scripts/README.md`
- the tick-line prefix in `packages/fleet/src/server/entry/registryd.ts:476,484` and `registryd-main.ts:1760`, and the tests that assert it
- the deletion of `skills/plot/scripts/board/plot-registryd.mjs`
- the tests listed under *What to build*

This branch does not own, and must not edit: the log file names, any source file name, the comments that say `registryd`, or `CLAUDE.md`'s Plot Config `Local checks` line. The sibling waves hold the rest of the plan. `feature/the-fleet-owns-the-scan-and-pr-index` edits `registryd-main.ts` and `registryd.ts` for the scan clock, so keep your edits to those two files to the tick prefix and nothing else; a larger edit conflicts with a branch that has not started.

If you find something the plan did not anticipate, report it rather than improvising outside scope. In particular, a third installed unit under a label outside both families above is a finding to report, not one to migrate.
