# plot-fleetctl --stop unloads another checkout's supervisor

> `plot-fleetctl.sh --stop` boots out whatever job holds the resolved label without asking which checkout the job serves, so a checkout that resolves to the default label stops another repository's supervisor and reports success.

## Status

- **State:** Delivered
- **Type:** feature
- **Sprint:** card-alignment
- **Issue:** #3060
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-03, Jan Wloka, plan-PR #3094 merged
- **Started:** 2026-11-03, Jan Wloka, `bug/plot-fleetctl-stop-unloads-another-checkout`
- **Delivered:** 2026-11-04

## Changelog

- `/plot-fleet --stop` refuses to unload a supervisor that serves another checkout, names that checkout and each supervisor that serves this one, and stops nothing.

Board impact: none. No board or package source calls `plot-fleetctl.sh --stop`, and no payload field changes. The change touches one helper script, one domain rule, the bundle that reaches it, their tests, and two skill documents.

## Motivation

Measured 2026-11-03 on Plot 2.30.0 with two checkouts on one macOS machine. `websmith` declares no `Fleet label` and runs `com.plot-pm.fleetd`. `ewz-leg` declares no `Fleet label` either, so it also resolves to `com.plot-pm.fleetd`, while its own unit is loaded as `com.plot-pm.fleetd.ewz-leg`. From inside `ewz-leg`, `plot-fleetctl.sh --stop` printed `supervisor unloaded` and booted out `websmith`'s supervisor. The `ewz-leg` job kept running. The operator found out from `launchctl list`.

All line numbers below are `skills/plot/scripts/plot-fleetctl.sh` on `origin/main` at `791be809d` unless another file is named.

`--start` reads `supervisor_checkout` (`:238-249`) before it acts and refuses a job that serves another checkout (`refuse_label`, `:1102-1106`, called at `:1107-1109`). `--status` prints `serves: ANOTHER checkout (...)` through `serves_line` (`:252-258`). The `--stop` arm (`:1252-1405`) never calls `supervisor_checkout`: it stops every agent (`plot-dispatch.sh --stop` at `:1298`), then calls `unload_supervisor` at `:1363`, whose `launchctl bootout` is at `:585`. The agents of the stopped fleet run unsupervised until someone notices, which is the case the guardrail "never signal a worker you did not name" exists to prevent.

The domain already owns the same kind of decision for the old label: `oldLabelAction` in `packages/domain/src/rules/old-label-migration.ts` maps `supervisor_checkout`'s line to an action, and `plot-fleetctl.sh` reaches it through `skills/plot/scripts/board/plot-old-label.mjs` (`old_label_action`, `:607-613`). The `this`/`another`/`unknown` mapping for the configured label lives in shell, in `refuse_label`. `plot-fleetctl.sh` runs once per operator command, so `docs/shell-and-domain.md` says it calls the domain.

## Design

### Approach

**One domain rule answers every verb.** `old-label-migration.ts` gains a sibling rule, `labelAction(reading, verb)`, over the existing `OldLabelReading`. It answers `proceed` or `refuse`:

| verb | `this <dir>` | `another <dir>` | `unknown` |
|---|---|---|---|
| `start` (the configured label is loaded) | refuse | refuse | refuse |
| `start-default` (the default label, when a `Fleet label` moved `$LABEL` away from it) | refuse | proceed | proceed |
| `stop` | proceed | refuse | refuse |

The `start` and `start-default` rows are today's `--start` behaviour at `:1107-1109`, moved, not changed. `oldLabelAction` and its verbs `retire` and `status` do not change.

**The bundle carries the verbs and the text.** `plot-old-label.mjs` (entry `packages/board/src/server/entry/old-label.ts`) accepts the verbs `start`, `start-default`, `stop` and `serves`, with four more arguments: the label, the platform, the read command, and the root the reading was compared against. For `start`, `start-default` and `stop` it prints the rule's word on stdout and, on `refuse`, the refusal text on stderr. For `serves` it prints the `--status` line that `serves_line` prints today. The `start` texts are `refuse_label`'s three texts, word for word, so the existing refusal-4 tests stay green. `retire` and `status` keep their one-argument form. An unreadable line, verb or argument list exits 2, as today.

**One shell caller asks the bundle.** `old_label_action` (`:607-613`) becomes the one function that pipes `supervisor_checkout` into the bundle for every verb. It keeps its `supervisor_loaded` guard, so a label that is not loaded is never asked, and it keeps its two `broken_install` refusals for a missing bundle and for a bundle that gives no answer. A caller reads a failed call as a refusal and never as `proceed`. `supervisor_checkout` takes an optional root to compare against, defaulting to `$repo_root`.

**`--start` calls the rule.** `refuse_label` and its three call lines (`:1102-1109`) are replaced by two calls: verb `start` for `$LABEL`, and verb `start-default` for `com.plot-pm.fleetd` in the existing subshell that sets `LABEL` and `UNIT_NAME`. Each exits 1 on anything but `proceed`.

**`--status` calls the rule for its `serves:` line.** `serves_line` (`:252-258`) is removed, and its two callers (`:819`, `:852`) ask the bundle for verb `serves`. This move is what pays for the `--stop` lines under the shell-lines gate (see *Shell-lines budget*).

**`--stop` reads the owner twice.**

1. After `resolve_wt_root` (`:1253`) and before the agent loop (`:1255`), `--stop` asks verb `stop` for `$LABEL`, compared against `plot_repo_root`. The check runs only when `supervisor_loaded` answers 0. With no supervisor loaded, `--stop` behaves as today: it stops this checkout's agents, prints `supervisor was not loaded` (`:1386`) and exits 0.
2. On `refuse`, `--stop` signals no agent, writes no stop record, unloads nothing and keeps the start marker. The bundle prints which checkout the job serves (`another`) or the `launchctl print` command (`unknown`) and says that nothing was unloaded. The shell adds that no agent was signalled, then names each loaded plot-pm supervisor whose working directory is this checkout (see *Supervisors that serve this checkout*), and exits 1.
3. Immediately before `unload_supervisor` (`:1363`), inside the existing `if supervisor_loaded` (`:1340`), `--stop` asks verb `stop` again. On `refuse` it unloads nothing, keeps the start marker, sets `sup_unconfirmed=1`, and exits 1 after the agent summary, as an unconfirmed unload does today. This closes the window in which another checkout's `--start` loads the same label while the agent loop waits up to `--wait` seconds per branch.

The trailing `retire_old_label` (`:1391`) does not change.

### Root each verb compares against

`supervisor_checkout` compares against `$repo_root`, which is `git rev-parse --show-toplevel` (`:69`). From a desk that is the desk, while the supervisor's working directory is the main checkout (`units/plot-fleetd.service:35`). `resolve_wt_root` (`:714-724`) accepts `--stop` from a desk under the estate (#1439), so `--stop` compares against `plot_repo_root` (`plot-desk-root.sh:38`), the main checkout from anywhere.

`--start` and `--status` keep `$repo_root`. `--start` writes `WorkingDirectory=$repo_root` into the unit (`:1168`), so its comparison matches the unit it would install. `--status` prints `this repository is $repo_root`, and only prints. Neither changes in this slice.

### Supervisors that serve this checkout

The `--stop` refusal prints a ready `PLOT_FLEET_LABEL=<label> plot-fleetctl.sh --stop` command for each loaded plot-pm supervisor whose process works in this checkout. `PLOT_FLEET_LABEL` outranks the config key (`:82`), so the printed command works today. The refusal never unloads one of these jobs itself; that would be a second, laxer stop rule.

`plot_processes_block` (`:381-485`) already finds every supervisor by process, reads its working directory through `process_cwd`, and reads its label from `launchctl list` (Darwin) or the systemd cgroup (Linux). As it stands it does not answer this question:

- It prints nothing when every process serves this checkout (`:464`), which is exactly the case to report.
- It prints a block, not a command.
- It compares against `$repo_root`, which is the desk from a desk.

So the slice gives `plot_processes_block` a second mode: with a second argument (the root to compare against), it prints, for each supervisor row whose working directory is that root and whose label is known, `PLOT_FLEET_LABEL=<label> <this script> --stop`, and nothing else. The first argument still skips the pid of the refused label's own job, so the refusal never names `$LABEL` itself. On Linux the row carries `unit <name>`, which is not a label, so the line names the unit and prints no command. With no row, the refusal says that no supervisor serving this checkout was found.

### Refusal text

`--stop` gets its own text, from the bundle, for example:

```
plot-fleetctl: 'com.plot-pm.fleetd' serves ANOTHER checkout (/Users/x/websmith), not this repository (/Users/x/ewz-leg) — it was not unloaded.
  Run --stop in that checkout, or give this checkout its own label — skills/plot/units/README.md
```

For `unknown` the text says which checkout the job serves cannot be determined, names the platform from the platform argument, and prints `read_cmd`'s command (`:559-564`). `refuse_label` is removed rather than hoisted: its `this` arm is a refusal for `--start` and a pass for `--stop`, its wording is `--start`'s, and its `unknown` arm reads `$plat`, which only `--start` (`:1067`) and `--status` (`:781`) set. The bundle takes the platform as an argument, so `--stop` passes `$(platform)` and needs no `plat` variable.

### Exit code and receipts

Both refusals exit 1, as `--start`'s refusal 4 does (`:1107`) and as a failed stop does (`:1402`). Exit 3 stays the code for an estate refusal. The refusal writes no `State:` line and no receipt: `plot-fleetctl.sh` is not a controller action, and no gate names it.

### Shell-lines budget

`scripts/check-shell-lines.sh` refuses any net growth in counted commands under `skills/`. Counted with the gate's own awk on `origin/main`:

| lines | what | counted commands |
|---|---|---|
| `:1102-1109` | `refuse_label` and its three call lines | 21 removed |
| `:252-258` | `serves_line` | 11 removed |
| `:607-613` | `old_label_action`, widened in place to the shared caller | about 0 net |
| `--start` | two calls to verb `start` / `start-default` | about 6 added |
| `--stop` | the early read, its refusal lines and the listing call | about 8 added |
| `--stop` | the second read before `unload_supervisor` | about 3 added |
| `plot_processes_block` | the second mode | about 5 added |
| `:819`, `:852` | `serves_line` calls replaced by bundle calls | about 0 net |

The estimate nets about 10 counted commands fewer. The gate, not this table, decides. If `./scripts/check-shell-lines.sh pr` reports growth, the slice moves more text into the bundle; it does not remove unrelated shell to pass.

### Open Questions

None. The operator decided the panel's questions on 2026-11-03:

- The decision lives in the domain, beside `oldLabelAction`, reached through `plot-old-label.mjs`.
- A `--stop` with no supervisor loaded stops this checkout's agents, as today.
- `--stop` compares against `plot_repo_root`.
- A refused `--stop` signals no agent and names this checkout's own supervisors as ready commands. This is in scope.
- A second owner read runs immediately before `unload_supervisor`.
- The refusal writes no receipt.
- `--stop --dry-run` is out of scope and filed as #3099.

## Slices

### Stop refuses a foreign supervisor

- `bug/plot-fleetctl-stop-unloads-another-checkout` — add `labelAction` beside `oldLabelAction`, carry its verbs and the refusal and `serves` text in `plot-old-label.mjs`, replace `refuse_label` and `serves_line` with calls through the shared shell caller, and make `--stop` read the owner before the agent loop and again before `unload_supervisor`. → #3107

**Domain tests.** `packages/domain/test/old-label-migration.test.ts` gets one case per cell of the table above (nine), so the domain keeps its 100% coverage gate.

**Bundle tests.** `test/reconcile/fleetctl.test.mjs`'s `askOldLabel` cases (`:3229-3248`) get the new verbs: each word for each reading, the refusal text on stderr, and exit 2 for a missing argument. The unreadable-verb case at `:3244` uses `stop` as its unknown verb; it changes to a verb the bundle still does not know.

**New `--stop` cases**, each under the DEFAULT label (no `PLOT_FLEET_LABEL`; `run()` clears it at `:291`), built on `holdLabel` (`:2250-2267`), with one running desk and a stubbed `plot-dispatch.sh` that records its calls (the pattern at `:439-442`):

| case | asserts | fails on `origin/main` because |
|---|---|---|
| `another` (workdir is another directory) | exit 1; the refusal names that directory; `launchctlCalls` records no `bootout`; the stub `plot-dispatch.sh` was never called; the start marker (`armedMarker`) is kept | `--stop` calls `plot-dispatch.sh --stop` and records `bootout gui/<uid>/com.plot-pm.fleetd` |
| `unknown` (workdir `null`) | exit 1; the refusal prints `launchctl print gui/<uid>/com.plot-pm.fleetd`; no `bootout`; no dispatch call; marker kept | the same |
| `another` with this checkout's own supervisor in a `writeProcs` fixture (`:2810`, `list: [[pid, 'com.plot-pm.fleetd.other']]`, cwd the sandbox root) | the refusal prints `PLOT_FLEET_LABEL=com.plot-pm.fleetd.other` and `--stop`; no `bootout` | no such line exists. `holdLabel`'s `launchctl` must answer `list` from `$PLOT_TEST_PROCS/launchctl-list` as `stubPlatform` does; `list` is still recorded in `calls`, so this case asserts the absence of `bootout`, not `calls == []` |
| `this` (workdir is the sandbox root) | `bootout gui/<uid>/com.plot-pm.fleetd` is recorded; the dispatch stub was called for the desk | passes on `origin/main`; it guards the proceed arm. Under the default label `retire_old_label` also reads `this` from `holdLabel` and records a `bootout` of `com.plot-pm.registryd`, so the case asserts the configured label's `bootout` by name |
| `this` through a symlinked path (as refusal 4's case at `:2299`) | the same as `this` | passes on `origin/main`; it guards the physical-path comparison |
| `this` from a desk under the estate (as `:3267`) | the `bootout` is recorded | passes on `origin/main`; it fails against a check that compares against `$repo_root` |
| the owner changes between the two reads (a `holdLabel` variant whose `print` answers this checkout first and another directory after) | exit 1; no `bootout` | `origin/main` has no second read |

**Fixture changes that keep existing cases green:**

- `stubUnload` (`:1519`) prints `pid = 4242` and no working directory, so the three cases built on it (`:583`, `:605`, `:625`, via `:590`, `:611`, `:641`) would read `unknown` and refuse. Its `print` emits `working directory = <sandbox root>`. Its systemd arm needs no change: it stubs `uname` as `Darwin` (`:1527`), so the systemd branch never runs.
- `stubSystemd`'s `show` (`:2640`) answers only `MainPID`, so the systemd case at `:2738` (assertion `:2750`) would read `unknown` and never `disable`. Its `show` answers `WorkingDirectory` with the sandbox root.
- `--stop with nothing running` (`:419`) and `--stop of an unloaded supervisor` (`:658`) use stubs that answer 113, so the label is not loaded, the check is skipped, and they stay green with no change. The old-label `--stop` cases (`:2500-2547`) hold only `com.plot-pm.registryd` (`holdOldLabelOnly`), so the new default reads not loaded and they stay green too.

**CI coverage.** `fleetctl.test.mjs` runs in `test:contracts` on `ubuntu-latest`, where the stubbed `uname` and `launchctl` drive the launchd arm. It is not in the `macos-shell-contract` list (`ci.yml:409`), so bash 3.2 checks only the syntax of the new shell, through `scripts/check-bash32-syntax.sh`. The systemd arm is exercised only through `stubSystemd`. CI builds the bundles before `test:contracts`; a local run needs `pnpm build:board` first, and the rebuilt bundle is restored before the push (`scripts/check-no-bundle-diff.sh`).

**Docs.**

- `skills/plot-fleet/SKILL.md` §5 (`:217`) states the `--stop` refusal, its exit 1, and its repair: run `--stop` in the named checkout, or run the printed `PLOT_FLEET_LABEL=<label>` command. §4's table (`:167-176`) gains the `--stop` refusal row.
- `skills/plot/scripts/README.md`: the `plot-fleetctl.sh` row (`:56`) names the `--stop` refusal, and the `board/plot-old-label.mjs` row (`:88`) names the new verbs and arguments.
- `skills/plot/units/README.md:79` adds one sentence: `--stop` refuses a job under the resolved label that serves another checkout.

**Changeset.** Package `plot`, patch. The description comes first. The comment block that follows carries `plan: docs/plans/2026-11-03-plot-fleetctl-stop-unloads-another-checkout.md` and `bumps: skills: plot-fleet: patch, plot: patch` (the `plot` skill because its scripts README changes). `./scripts/check-changeset-packages.sh` checks it.

## Notes

- Source: https://github.com/plot-pm/plot/issues/3060. Related and released: `2026-10-23-plot-fleetctl-ignores-the-fleet-label`.
- Panel 2026-11-03: four jurors, `unanimous amend`; moderation in `.plot/panels/2026-11-03-plot-fleetctl-stop-unloads-another-checkout/panel.md`.
- Out of scope and filed: `--stop` ignores `--dry-run` (#3099).
- Out of scope and not filed: from a desk, `--status` prints `serves: ANOTHER checkout` for the main checkout's supervisor (`serves_line`'s comparison), and `--stop` removes the start marker at `$repo_root/.plot/state/` (`:546`), which is the desk's path, not the main checkout's.
- `Review: pr` follows `Plan PRs: required`; `Impl: own branches` is the repository default for a fix with its own test.
