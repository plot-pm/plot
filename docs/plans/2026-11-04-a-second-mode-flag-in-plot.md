# A second mode flag in plot-fleetctl.sh replaces the first

> `plot-fleetctl.sh --start --stop` runs the `--stop` arm, because each mode flag assigns `mode=` again and the last one wins; two different mode flags in one call should refuse with exit 1 before any side effect.

## Status

- **State:** Draft
- **Type:** feature
- **Issue:** #3119
- **Review:** pr
- **Impl:** own branches

## Changelog

- `plot-fleetctl.sh` refuses two different mode flags in one call. `--start --stop` and `--stop --start` exit 1 before the first side effect, and the message names both flags. Before this change the last flag won, and `--start --stop` stopped the fleet.

Board impact: none. The one package caller, `packages/board/src/server/supervisor-reading.ts`, passes `['--status']` alone. No payload field and no board source changes.

## Motivation

Issue #3119, found by the safety juror of the panel on `docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md` (finding 2). That plan keeps this out of its slice.

The argument loop at `skills/plot/scripts/plot-fleetctl.sh:773-782` on `origin/main` (`e54e53815`) assigns `mode=` in each of the `--status`, `--once`, `--start` and `--stop` arms. The last mode flag wins and nothing reports the conflict. `plot-fleetctl.sh --start --stop` runs the `--stop` arm (`:1276`): it signals every dispatched agent and unloads the supervisor. An operator who typed `--start` first gets a stop.

## Design

### Approach

**Refuse in the loop, on the first conflicting flag.** When a mode flag arrives and `mode` already holds a different mode, the script prints `plot-fleetctl: --<first> and --<second> are different modes; give one; nothing was done` to stderr and exits 1. The check runs while the loop reads arguments, so it holds before any host, init-system or bundle call.

- **The message names both flags**, as the issue expects.
- **Two arms stay unchanged.** The loop keeps its four `mode=` assignments; the check is one `case` placed before the arm `case`, so a mode flag added later is covered by extending one pattern list.
- **The same flag twice** (`--stop --stop`) is not a conflict and is not refused; see Open Questions.
- **`--start 3` keeps working.** The arm that consumes a bare count is untouched.

**Relation to `2026-11-04-plot-fleetctl-stop-ignores-dry-run`.** That plan adds a refusal after the loop that reads the final `$mode`. Once this plan lands, the final `$mode` is the only mode, so that refusal reads an unambiguous value. Both plans edit the same argument loop, so this slice branches from `main` after that plan's slice merges.

### Shell-lines offset

`scripts/check-shell-lines.sh` refuses any growth of the shell command count under `skills/` and stores no allowance. The refusal adds commands, so the slice removes an equal count elsewhere under `skills/` in the same change. The slice measures with `./scripts/check-shell-lines.sh --per-file` before and after, and keeps the net at or below 0. The candidates are one-caller helper functions that a call site can inline, the way the sibling plan does for `running_major()` and `home_short()`; the slice must not reuse a candidate the sibling plan already takes.

### Open Questions

- [ ] Does `--stop --stop` refuse, or pass as the same mode? This plan proposes: pass, because the issue names "two different mode flags" and repeating a flag does no harm.
- [ ] Does `-h` stay valid next to a mode flag? It exits 0 in its own arm today, and this plan leaves that unchanged.

## Slices

### Refuse two mode flags

- `feature/a-second-mode-flag-in-plot` — `plot-fleetctl.sh` refuses two different mode flags with exit 1 before the first side effect, names both flags, and removes an equal count of shell commands elsewhere under `skills/`. Tests in `test/reconcile/fleetctl.test.mjs` hold `--start --stop`, `--stop --start`, `--status --once`, and that a refused call leaves no stop record and sends no signal. One changeset.

## Notes

- Created from issue #3119 by `/plot-idea` with `PLOT_UNATTENDED=1`. Stops at Draft.
- Deliverable search for "plot-fleetctl.sh mode flag conflict refusal" found no existing mode-conflict refusal in the estate.
