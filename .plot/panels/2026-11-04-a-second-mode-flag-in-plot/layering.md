# Layering juror: a-second-mode-flag-in-plot

Position: amend

## Lens

Layering: controller → domain → port ← adapter, rules in the domain, decisions read the index, lifecycle actions through controllers, and shell growth.

## Findings

1. **The refusal is argument parsing, not a domain rule, so it belongs in the script.** The check compares two flags of one command line. It reads no host, no index, no plan and no desk, and it decides no lifecycle transition. `plot-fleetctl.sh` is an `orchestration` script that runs once per operator command (`skills/plot/scripts/README.md:56` on `origin/main` `fbf670eaf`). Moving a usage check into a bundle would add a `node` hop and a second argument parser for no rule the domain owns. The plan does not violate "No domain-specific code or behaviour lives outside the domain".
2. **No controller is bypassed and no answer is bought.** The refusal sits in the argument loop (`plot-fleetctl.sh:771-793`), before the first `plot_repo_root`, `plot-old-label.mjs`, `launchctl`/`systemctl` or `plot-dispatch.sh` call. The `--stop` arm still orchestrates `plot-dispatch.sh --stop` per branch (`:1276` onward); the plan changes no route. "A Decision Reads The Index" does not apply: nothing here reads PR state.
3. **The board caller is unaffected.** `packages/board/src/server/supervisor-reading.ts:52` names `plot-fleetctl.sh` and its caller passes `--status` alone, as the plan's Changelog states. The port (`Scripts.awaited`) and its exit-code contract stay as they are.
4. **The shell grows, and the plan names no offset.** `scripts/check-shell-lines.sh` counts commands, not lines (`:9-16`): a `case` arm with `[ -z "$mode" ] || [ "$mode" = "${1#--}" ] || { echo …; exit 1; }` counts about five. The plan says "one-caller helper functions that a call site can inline" and forbids the two the sibling plan takes (`running_major`, `home_short`), but names no candidate and no count. An unattended Sonnet agent must then search for an offset, and the obvious move under pressure is to trim comments or join lines, which the counter does not reward, or to inline something with a test that sources it. Read on `origin/main`: `unit_name()` (`:100-108`, one caller at `:109`) and `tick_age_seconds()` (`:517`, one caller at `:819`) each have exactly one reference besides their definition in `skills`, `test`, `packages` and `scripts` (`git grep -wc`). `desk_running()` (`:585`) also has one caller but is passed to `poll_while` as a callback (`:1341`), so it cannot be inlined. `pinned_major()` is sourced by tests and is not a candidate.
5. **Both plans edit the same loop, and the order is stated.** The plan branches after `2026-11-04-plot-fleetctl-stop-ignores-dry-run` merges (Design, "Relation to"). That plan is Approved and Started on `feature/plot-fleetctl-stop-ignores-dry-run` (`db54723e2`). With both landed, `--start --dry-run --stop` refuses on the mode conflict first, and the sibling's `--dry-run` refusal then reads one unambiguous `$mode`. The two refusals do not conflict.
6. **Line references hold on `fbf670eaf`.** The loop is still `:773-782` and the `--stop` arm still `:1276`, though `origin/main` moved past the plan's cited `e54e53815`. The plan should tell the slice to find sites by content, as the sibling plan does.
7. **Direction of travel.** The repo's target names a `.sh` that remains as a launcher that decides nothing (CLAUDE.md, "A Shell Script Asks The Domain"). This change adds a decision to a script that is far from a launcher already, and the cost is bounded by the offset. Converting `plot-fleetctl.sh` to an entry point is out of scope and should not block this fix.

## Amendments required

1. Name the offset in the plan: a concrete one-caller helper (for example `unit_name()` at `:100-109` or `tick_age_seconds()` at `:517`/`:819`), its command count before and after inlining, and the net against the refusal's count. Name the test that already reads its answer, or add one, so the inlining is held.
2. State that the slice finds the loop, the mode arms and the offset helper by content and not by line number, because `origin/main` already moved past `e54e53815`.

## Decisions for a person

None under this lens. The two Open Questions (`--stop --stop` passes; `-h` keeps exiting 0 in its own arm) carry a proposal an agent can follow.

## Ran versus read

Ran: `git fetch`, `git show origin/main:` for `plot-fleetctl.sh`, `scripts/check-shell-lines.sh` and the sibling plan, `git grep` for callers of every function in `plot-fleetctl.sh` and for `supervisor-reading.ts`, `gh issue view 3119`. Read only: the plan and repo `CLAUDE.md`. No test suite, gate script or host write was run; the command counts in finding 4 are estimates, not output of `check-shell-lines.sh --per-file`.
