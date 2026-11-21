## Implementation brief — shell-scripts-refuse-a-second-mode-and-name-the-fetch (wave 1: Mode Flags)

- **Plan (canonical):** `docs/plans/2026-11-21-shell-scripts-refuse-a-second-mode-and-name-the-fetch.md` on `main`
- **Approved:** 2026-11-21, Jan Wloka, plan-PR #3612 merged
- **Branch:** `bug/boardctl-and-dispatch-refuse-a-second-mode` (base: `main`)
- **Ends as:** one PR to `main`, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** per repo convention — the PR is reviewed as code; CI is the authority for e2e

Waves 2 (`bug/fleetctl-restart-reads-the-bundle-and-main-checkouts`) and 3 (`bug/check-scripts-name-the-default-branch-fetch`) touch disjoint files and wait on nothing. This slice waits on nothing either.

### What to build

`plot-boardctl.sh` and `plot-dispatch.sh` take the last mode flag and drop the earlier ones silently (#3138). `plot-boardctl.sh --start --stop` stops the board and says nothing about `--start` (arms at `:242-244`). `plot-dispatch.sh --start --stop` runs the stop arm, and `plot-fleetctl.sh --stop` calls that arm per desk, so a mixed call signals a running agent. One level down, `--stop feature/a --stop feature/b` sets `stop_branch` twice and stops only `feature/b`; `--restart` and `--release` behave the same.

The fix is the shape `plot-fleetctl.sh:749-755` already has, from commit `997eb0f64`: one case arm for every mode flag, a test `[ -z "$mode" ] || [ "$mode" = "${1#--}" ]`, then `mode=${1#--}`. Both refusals run inside the argument loop, before the first side effect, exit 1, write to stderr, and name both flags. The wording follows `plot-fleetctl.sh:750`:

- `plot-boardctl: --<first> and --<second> are different modes; give one; nothing was done`
- `plot-dispatch: --<first> and --<second> are different modes; give one; nothing was done`
- `plot-dispatch: --stop feature/a and --stop feature/b name different branches; give one; nothing was done`

The plan's `Design › Slice 1` section is canonical for the mechanics. Orientation:

- **`plot-boardctl.sh`:** replace the three arms with `--status|--start|--stop)`. The one-line form `mode=${mode:-${1#--}}; [ "$mode" = "${1#--}" ] || { …; exit 1; } ;;` counts 8 against 9 today. `boardctl` has no default mode, so an empty `mode` means no flag yet.
- **`plot-dispatch.sh`:** the default is `mode=dispatch` (`:278`) and no `--dispatch` flag exists, so `mode` still equal to `dispatch` means "no mode flag yet". Merge the six arms (`--status`, `--migrate`, `--stop`, `--restart`, `--release`, `--start`) into one arm, then one `case "$1:${2:-}"` that consumes a `*/*` branch after `--stop`, `--restart` or `--release` and a bare number after `--start`. Keep the existing rules and their comments' substance: a bare `--stop <slug>` must not take the slug as a branch, and `--start --dry-run` keeps `--dry-run` as a flag.
- **One `mode_branch`** replaces `stop_branch`, `restart_branch` and `release_branch` (`:279-281`). Only one mode can hold after the refusal, so one variable serves all three. Its 21 readers change their name only (measured: 21 lines, all in `plot-dispatch.sh`; no other file under `skills/`, `test/`, `packages/` or `scripts/` names any of the three). The same branch given twice passes; a different second branch refuses.

### Decisions the plan settles — do not re-derive them

**Refuse, do not pick a winner.** Last-wins is the defect. First-wins would be the same defect with the roles swapped, and a caller that passes two modes has a bug the script cannot repair by guessing. The same flag twice stays legal, as in `plot-fleetctl.sh`.

**One shared helper across the two scripts does not exist and is not wanted.** The two scripts have different default modes (`dispatch` against empty), so the one-line test differs. Both copy the fleetctl arm's shape; a sourced helper would cost lines the budget below does not have.

**No caller meets the new refusals.** No caller in `packages/` passes two mode flags: `performer-shell.ts:102`, `claim-release-shell.ts:21`, `supervisor-reading.ts:152` and `release.ts:222` each pass one. The plan did not check shell callers under `skills/` (the controller gate refused a shell read that names the script). Grep them before the push and report any caller that passes two modes — do not widen scope to fix one silently.

**The survival assertion must reach the desk.** For `dispatch.test.mjs`, the `--start --stop` test must use a fixture desk that a bare `--stop` reaches today (the slug precondition at `:391` passes it). A fixture the stop arm never reaches passes before and after the fix and proves nothing. Run the new test against the unfixed script first and see it fail.

**Rules carried over unchanged:** read the exit code, not the emptiness; absent is not false. `--start 3`, `--stop feature/x`, `--restart feature/x` and `--release feature/x` keep their values; `--status` alone and the default dispatch with no mode flag behave as before.

### Done when

The plan's `## Done when`-equivalent is its `Changelog` plus the `Tests` bullets of Slice 1. Lifted, with what each catches:

- `boardctl.test.mjs`: `--start --stop` exits 1, names `--start and --stop are different modes`, and starts and stops nothing (catches a refusal that fires after the first side effect). `--stop --status` names both. `--status --status` passes (catches a refusal that is too wide). `--status --port N` passes (catches a refusal that treats an option as a mode).
- `dispatch.test.mjs`: `--start --stop` exits 1, names both flags, and signals no agent (the desk-reaching fixture above). `--stop feature/x --restart feature/x` names both modes. `--stop feature/a --stop feature/b` exits 1, names both branches and stops neither. `--stop feature/x --stop feature/x` passes the parser. `--start 3 --dry-run` keeps the count and the dry run, beside `runDetached(['--start', '--dry-run'], …)` near `:4092`. `--status` alone and the default dispatch behave as before.
- Style of the tests: `test/reconcile/fleetctl.test.mjs:782-857`. Any helper you write is an arrow function.

Plus: add `.changeset/<slug>.md` for `'plot': patch` — description first, the `bumps:` block last with `skills: plot: patch`. Run `./scripts/check-changeset-packages.sh`.

**Shell line budget.** `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base. This slice nets about −13 lines in `plot-dispatch.sh` and 0 or −1 in `plot-boardctl.sh`, so it must not grow; measure with `./scripts/check-shell-lines.sh pr` before the push. The gate counts commands, not lines: joining statements with `;` or `&&`, or folding `fi` or `done` onto the line before, is not a payment. The gate stores no number and has no override.

For tests, run `node skills/plot/scripts/board/plot-local-checks.mjs` before each push and run what it prints. The suites in the `CI suites` key run in CI, and a failure there comes back as a correction. Do not run `test:e2e` locally.

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while it moves); never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices` section. Push the first real commit as soon as it exists. The PR body names issue #3138.

### Scope guard

This branch owns `skills/plot/scripts/plot-boardctl.sh`, `skills/plot/scripts/plot-dispatch.sh`, `test/reconcile/boardctl.test.mjs`, `test/reconcile/dispatch.test.mjs` and one `.changeset/*.md`. Do not touch `plot-fleetctl.sh` (wave 2 owns it; its mode defect is already fixed) or `scripts/` (wave 3 owns it). Do not edit generated bundles under `skills/plot/scripts/board/`.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
