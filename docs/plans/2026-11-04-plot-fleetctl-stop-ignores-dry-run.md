# plot-fleetctl --stop ignores --dry-run and stops the fleet

> `plot-fleetctl.sh --stop --dry-run` signals every agent, unloads the supervisor and removes the start marker, because the parser accepts `--dry-run` with every mode and only `--start` reads it.

## Status

- **State:** Approved
- **Type:** feature
- **Sprint:** follow-ups-2-30-1
- **Issue:** #3099
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3113 merged
- **Started:** 2026-11-04, Jan Wloka, `feature/plot-fleetctl-stop-ignores-dry-run`

## Changelog

- `/plot-fleet --stop --dry-run` no longer stops the fleet. `plot-fleetctl.sh` refuses `--dry-run` with every mode but `--start`, names the mode and `--start`, and exits 1 before it signals an agent. `-h` now prints the whole usage block, including `--wait` and `--dry-run`.

Board impact: none. The one package caller, `packages/board/src/server/supervisor-reading.ts:152`, passes `['--status']` alone and never `--dry-run`. No payload field and no board source changes. The slice touches `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs`, `skills/plot-fleet/SKILL.md` and one changeset.

## Motivation

Measured 2026-11-03 by the safety juror of the panel on `docs/plans/2026-11-03-plot-fleetctl-stop-unloads-another-checkout.md` (#3060), which keeps this out of its slice. Issue #3099 records the evidence.

The parser sets `dry_run=1` for `--dry-run` in any mode (`skills/plot/scripts/plot-fleetctl.sh:788` on `origin/main` at `e54e53815`). The only check after the loop is the mode-required line at `:795`. `dry_run` is declared at `:764` and read at two places: `:654` in `retire_old_label` and `:1146` in the `--start` arm. The `--stop` arm (`:1276`) reads it once, indirectly: it calls `retire_old_label` at `:1441`, and that call only reports the OLD label. Everything else in the arm runs: `plot-dispatch.sh --stop <branch>` for every running desk (`:1336`), the stop record `.plot/state/fleet-stopped.json`, `unload_supervisor` for the configured label (`:1413`), and removal of the start marker `.plot/state/fleet-start.done` (`:1420`).

The usage text (`:5`, `:31-32`) and `skills/plot-fleet/SKILL.md:44` document `--dry-run` with `--start` only. `-h` prints `sed -n '2,27p' "$0"` (`:789`), and the usage block ends at `:32`, so `-h` already omits `--wait` and `--dry-run`. Nothing tells an operator that `--stop` ignores the flag, and an operator who types it expects a preview.

Line numbers drift. The slice finds each site by content (`--dry-run) dry_run=1`, `one of --status, --once`, `running_major`, `home_short`) and not by number.

## Design

### Approach

**Refuse the combination, do not preview.** `--dry-run` is accepted only with `--start`. `--stop`, `--once` and `--status` with `--dry-run` each refuse. The refusal is one line directly after the mode-required line (`:795`):

```bash
[ "$dry_run" = 0 ] || [ "$mode" = start ] || { echo "plot-fleetctl: --dry-run works with --start only, not --$mode; nothing was done" >&2; exit 1; }
```

- **It reads the final `$mode` after the argument loop**, never the flag order inside the `--dry-run)` case arm. `--dry-run --stop` and `--stop --dry-run` both refuse. The parser is last-mode-wins (`:773-782`), so `--start --dry-run --stop` refuses and `--stop --dry-run --start` previews a start; both outcomes write nothing.
- **It sits after the mode-required line**, so a bare `--dry-run` with no mode keeps the existing message `one of --status, --once, --start, --stop is required`.
- **It runs before the first arm**, so it holds for every arm and for any arm added later. No host, init-system or bundle call runs before it.
- **Exit 1 and the `plot-fleetctl:` prefix.** Unknown arguments already exit 1 (`:790`). `--status` also exits 1 for "not loaded", but no caller passes `--dry-run` with `--status` (see Decisions), and the prefix lets a reader of stderr tell a refusal from a status.

Reasons to refuse rather than preview:

- A preview of `--stop` needs a second path through a 160-line arm (`:1276-1441`) with a dry-run twin for each destructive step. A refusal is one line.
- The expected behaviour in #3099 allows either. The refusal also closes `--once` and `--status`, which accept the flag today and ignore it.

**`-h` prints the whole usage block.** `:789` becomes `-h|--help) sed -n '2,/^# Output:/p' "$0"; exit 0 ;;`. The range ends at the first `# Output:` line (`:33`), so `--wait` and `--dry-run` print, and a longer usage block needs no new number. The command count of that line stays 4.

**Documents state the rule.** The `--dry-run` comment at `:31-32` starts `--dry-run   with --start only: report what would be filled, loaded and started;` and gains one comment line: `every other mode refuses it and exits 1, before it acts.` The usage synopsis at `:5` stays. The `--dry-run` row of `skills/plot-fleet/SKILL.md:44` reads: `With --start only: report what would be filled, loaded and started. Writes nothing. Every other mode refuses it and exits 1.`

### Shell-lines offset

`scripts/check-shell-lines.sh` refuses any growth of the command count under `skills/`, stores no allowance and has no override (`ci.yml:1509-1511`). Comments and blank lines do not count. Counted with the gate's own awk on `e54e53815`:

| Change | Commands |
|---|---|
| The refusal line above | +6 |
| Inline `running_major()` (`:152-157`, 7 commands) at its one call site (`:1055`, `have=$(running_major) \|\| have=""`, 2 commands) as `have=$(node --version 2>/dev/null) \|\| have=""; have=${have#v}; have=${have%%.*}` (4 commands) | -5 |
| Inline `home_short()` (`:359-364`, 9 commands) at its one call site (`:448`, `inst=$(home_short "$full")`, 1 command) as a `case "$full" in "${HOME:-/nonexistent}"/*) inst="~${full#"$HOME"}" ;; *) inst=$full ;; esac` block (7 commands) | -3 |
| `-h` range fix | 0 |
| **Net** | **-2** |

Both functions have exactly one caller in the repository (`git grep` on `e54e53815`; no test sources them). `pinned_major()` is NOT a candidate: `fleetctl.test.mjs:380` and `:389` source the script and call it. Existing tests hold both inlinings: `consumer: the node refusal fires on Plot's pin where the consumer has none` (`fleetctl.test.mjs:2430`, asserts `node on PATH is 26, Plot pins 24`) reads `running_major`'s answer, and `processes: two supervisors, a --watch board and a plain board are all named` (`:3099`, asserts `installed: '~/.claude/plugins/...'` and `installed: '/inst/a'`) reads both arms of `home_short`.

If the refusal's final wording counts differently, the slice measures with `./scripts/check-shell-lines.sh --per-file` before and after and keeps the net at or below 0 with these two inlinings. It removes no other code to pay.

### Tests

All in `test/reconcile/fleetctl.test.mjs`, next to the `--stop` cases at `:419-461`, built on `sandbox()` and `run()` with `guardBin` (`:139`, `:276`). `run()` refuses a call without `guardBin`, so no case reaches the machine's `launchctl`.

New, each fails on `origin/main` and passes after the change:

1. `--stop --dry-run refuses before it signals an agent, writes a record or unloads the supervisor`. Build the sandbox from `--stop calls plot-dispatch --stop once per branch, and the supervisor last` (`:426`: a desk with a live sleeper and a `plot-dispatch.sh` stub that appends to `calls.log`) and `--stop polls the unload past a still-loaded first answer, clears the marker, exits 0` (`:583`: `armedMarker(root)`, `stubUnload(box, { sticky: 2, workdir: root })`, `fakeHome(box, { unit: true, label: fleetLabel })`). Assert all six: exit status 1; output matches `--dry-run`, `--stop` and `--start`; `calls.log` does not exist; `<box>/unload-ticks` does not exist (the stub writes it on `bootout` only); `.plot/state/fleet-start.done` still exists; `.plot/state/fleet-stopped.json` does not exist. Before the change, the run records `dispatch --stop feature/a`, writes `unload-ticks` and removes the marker, so the case fails.
2. `--dry-run before --stop refuses too`: the same sandbox with argv `['--dry-run', '--stop']`; assert exit 1 and no `calls.log`.
3. `--once --dry-run and --status --dry-run refuse and name --start`: for each mode, assert exit 1 and output matching `--dry-run works with --start only, not --once` (or `--status`). On `origin/main` both run their arm, so the case fails.
4. `-h prints --wait and --dry-run`: `run(ctl, ['-h'], ...)` exits 0 and its output matches `--wait S` and `--dry-run   with --start only`. On `origin/main` the range stops at `:27`, so the case fails.

Regression cases that stay green: `--dry-run reports the state it would act on, and writes nothing` (`:2172`), the `--start --dry-run` case at `:394`, `refusal: the wrong node refuses --dry-run too` (`:359`), `migration: --dry-run names the migration and boots out nothing` (`:2703`), and the two tests named under the offset.

**Mutation check.** Delete the refusal line, run case 1, and confirm it fails on the `calls.log` or `unload-ticks` assertion. Restore the line from git (`git checkout -- skills/plot/scripts/plot-fleetctl.sh` after committing the change, never from a copy).

### Changeset

`.changeset/plot-fleetctl-dry-run-start-only.md`, package `'plot': patch`, description first, the block last:

```markdown
---
'plot': patch
---

`plot-fleetctl.sh --stop --dry-run` no longer stops the fleet: `--dry-run` works with `--start` only, and every other mode refuses it before it acts. `-h` prints the whole usage block.

<!--
plan: docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md
bumps:
  skills:
    plot: patch
    plot-fleet: patch
-->
```

### Checks

Run each before the push, and each must pass:

- `node --test test/reconcile/fleetctl.test.mjs`
- `./scripts/check-shell-lines.sh pr` (not in the `Local checks` list today, #3120)
- `./scripts/check-bash32-syntax.sh`
- `./scripts/check-changeset-packages.sh`
- `node skills/plot/scripts/board/plot-local-checks.mjs`, then every command it prints

No board type changes, so `pnpm run typecheck` is not required. `test:e2e` is CI's.

### Decisions

- **The refusal covers `--once` and `--status` too.** Settled by the caller. Evidence: no caller passes `--dry-run` with any mode but `--start`. `supervisor-reading.ts:152` passes `['--status']` alone; every `--dry-run` in `fleetctl.test.mjs` (`:361`, `:394`, `:1019`, `:1066`, `:2179`, `:2284`, `:2704`) pairs it with `--start`; `plot-fleetd.mjs --dry-run` (`registryd-main.ts:333`) is its own entry point and does not pass through this parser.
- **No `--stop` preview in this plan.** A real preview is its own plan if anyone asks for it, and the refusal is the safe state until then.
- **The offset comes from two single-caller functions in the same script**, chosen because existing tests read both and neither is sourced by a test. A dead-code hunt elsewhere under `skills/` would widen the diff past the file the slice already owns.
- **A second mode flag still replaces the first** (`--start --stop` stops). That is #3119, not this slice.

## Slices

### Refuse dry-run outside start

- `feature/plot-fleetctl-stop-ignores-dry-run` — refuse `--dry-run` with any mode but `--start` after the mode-required line; fix the `-h` range; inline `running_major` and `home_short` to keep the shell count from growing; four new cases in `test/reconcile/fleetctl.test.mjs`; `--dry-run` row in `skills/plot-fleet/SKILL.md`; changeset <!-- builds: a mode check for --dry-run in plot-fleetctl.sh --> → #3147

## Notes

- Created from issue #3099 through `/plot-idea`, unattended. Review `pr` and Impl `own branches` follow the repo's `Plan PRs: required`.
- Deliverable search for "plot-fleetctl --stop --dry-run" found only citations in comments, no existing mode check.
- The sibling plan #3060 edits the same `--stop` arm. It reads `State: Delivered`, and its commits are the last five on `plot-fleetctl.sh`, so this slice starts from its result. No open PR touches `plot-fleetctl.sh`, `skills/plot-fleet/` or `fleetctl.test.mjs` (11 open PRs read 2026-11-04).
- Round 1 panel (layering, safety, testability, seams): unanimous amend. Moderation in `.plot/panels/2026-11-04-plot-fleetctl-stop-ignores-dry-run/panel.md`.
- Out of scope, filed: #3119 (a second mode flag replaces the first), #3120 (the shell-lines gate is missing from `Local checks`).
