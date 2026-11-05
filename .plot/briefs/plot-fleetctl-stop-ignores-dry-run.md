## Implementation brief — plot-fleetctl-stop-ignores-dry-run

- **Plan (canonical):** docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md on main
- **Approved:** 2026-11-04, Jan Wloka, plan-PR #3113 merged
- **Branch:** `feature/plot-fleetctl-stop-ignores-dry-run` (base: `main`)
- **Ends as:** one PR to `main`
- **Review of the code:** PR review through the declared channel (`Review: pr`)

Single-slice plan: nothing waits on this branch and it waits on nothing. The sibling plan #3060 (same `--stop` arm) is Delivered, so this slice starts from its result.

### What to build

`plot-fleetctl.sh --stop --dry-run` signals every agent, unloads the supervisor and removes `.plot/state/fleet-start.done`, because the parser sets `dry_run=1` in any mode and only the `--start` arm reads it (#3099). The fix is a refusal: `--dry-run` works with `--start` only, and `--stop`, `--once` and `--status` refuse it with exit 1 before any arm runs. The plan is canonical; this is orientation.

Find every site by content, not by line number (`--dry-run) dry_run=1`, `one of --status, --once`, `running_major`, `home_short`). Line numbers drift.

### Settled decisions — do not re-derive

- **Refuse, do not preview.** A `--stop` preview needs a dry-run twin for each destructive step across a 160-line arm. The refusal is one line. It also closes `--once` and `--status`, which accept the flag and ignore it today.
- **Check the final `$mode` after the argument loop**, directly after the mode-required line (`one of --status, --once, --start, --stop is required`). Never read flag order inside the `--dry-run)` case arm. The parser is last-mode-wins, so `--dry-run --stop` and `--stop --dry-run` both refuse. A bare `--dry-run` keeps the existing mode-required message. Exact line:
  `[ "$dry_run" = 0 ] || [ "$mode" = start ] || { echo "plot-fleetctl: --dry-run works with --start only, not --$mode; nothing was done" >&2; exit 1; }`
- **Exit 1 with the `plot-fleetctl:` prefix**, so stderr tells a refusal from `--status`'s "not loaded" exit 1. No caller passes `--dry-run` with any mode but `--start` (`supervisor-reading.ts:152` passes `['--status']` alone; `plot-fleetd.mjs --dry-run` does not use this parser).
- **`-h` range:** `-h|--help) sed -n '2,/^# Output:/p' "$0"; exit 0 ;;`. The old `2,27p` ends before `--wait` and `--dry-run`. The command count of that line stays 4.
- **Shell-lines offset (gate has no override, stores no number):** the refusal costs +6 commands. Pay it by inlining `running_major()` at its one call site as `have=$(node --version 2>/dev/null) || have=""; have=${have#v}; have=${have%%.*}` (-5) and `home_short()` at its one call site (`inst=$(home_short "$full")`) as a `case "$full" in "${HOME:-/nonexistent}"/*) inst="~${full#"$HOME"}" ;; *) inst=$full ;; esac` block (-3). Net -2. Do NOT touch `pinned_major()`: `fleetctl.test.mjs` sources the script and calls it. Remove no other code. If the final wording counts differently, measure with `./scripts/check-shell-lines.sh --per-file` before and after and keep net ≤ 0. Joining statements with `;`/`&&` to hide commands is not a payment.
- **Out of scope, filed:** #3119 (a second mode flag replaces the first — `--start --stop` still stops), #3120 (the shell-lines gate is missing from `Local checks`). Do not fix either here. `--stop --dry-run --start` previews a start and `--start --dry-run --stop` refuses; both write nothing.
- **Carried rules:** read the exit code, not the emptiness of output. `run()` in the fleetctl tests refuses a call without `guardBin`; keep it so no case reaches the machine's `launchctl`.

### Done when

The plan's `## Done when` / Tests list is the specification. The four new cases in `test/reconcile/fleetctl.test.mjs`, next to the `--stop` cases, must each fail on `origin/main` and pass after:

1. `--stop --dry-run` refuses before it signals an agent, writes a record or unloads the supervisor. Build on the sandboxes of `--stop calls plot-dispatch --stop once per branch…` and `--stop polls the unload past a still-loaded first answer…`. Assert all six: exit 1; output matches `--dry-run`, `--stop`, `--start`; `calls.log` absent; `<box>/unload-ticks` absent; `fleet-start.done` still present; `fleet-stopped.json` absent. Each assertion catches a different destructive step; asserting only the exit code would pass for a refusal printed after the damage.
2. `--dry-run --stop` (flag first) refuses too: exit 1, no `calls.log`. Catches a check bound to flag order.
3. `--once --dry-run` and `--status --dry-run` refuse and name the mode (`--dry-run works with --start only, not --once`).
4. `-h` exits 0 and prints `--wait S` and `--dry-run   with --start only`.

Regressions that must stay green: the `--start --dry-run` cases, `refusal: the wrong node refuses --dry-run too`, `migration: --dry-run names the migration and boots out nothing`, `consumer: the node refusal fires on Plot's pin where the consumer has none` (reads `running_major`), `processes: two supervisors, a --watch board and a plain board are all named` (reads both `home_short` arms).

**Mutation check:** commit first, delete the refusal line, run case 1, confirm it fails on the `calls.log` or `unload-ticks` assertion, then restore with `git checkout -- skills/plot/scripts/plot-fleetctl.sh` (from git, never from a copy).

Also: `scripts/check-shell-lines.sh pr`, `./scripts/check-bash32-syntax.sh`, `./scripts/check-changeset-packages.sh`, and `node skills/plot/scripts/board/plot-local-checks.mjs` — run it before each push and run what it prints. The suites in `CI suites` run in CI; a failure there comes back as a correction. Run no full suite and no `test:e2e`. `scripts/check-shell-lines.sh` refuses a PR whose shell under `skills/` is longer than at its merge base; growth is paid for in the same change.

Docs: update the `--dry-run` comment in the usage block (add the line `every other mode refuses it and exits 1, before it acts.`) and the `--dry-run` row of `skills/plot-fleet/SKILL.md` (`With --start only: report what would be filled, loaded and started. Writes nothing. Every other mode refuses it and exits 1.`). Changeset `.changeset/plot-fleetctl-dry-run-start-only.md`, package `'plot': patch`, description first and the `plan:`/`bumps:` block last (bumps: plot patch, plot-fleet patch).

### Bookkeeping

Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while the work moves). Never `gh pr create`. When the PR exists, append `→ #<number>` to this branch's line in the plan's `## Slices`. Push the first real commit as soon as it exists.

### Scope guard

This branch owns: `skills/plot/scripts/plot-fleetctl.sh`, `test/reconcile/fleetctl.test.mjs`, `skills/plot-fleet/SKILL.md`, one changeset. No board source changes (`Board impact: none`). Other branches in flight: no open PR touches these files (11 open PRs read 2026-11-04). If you find something the plan did not anticipate, report it rather than improvising outside scope.
