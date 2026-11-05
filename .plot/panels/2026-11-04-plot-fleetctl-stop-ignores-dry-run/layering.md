# Layering juror: plot-fleetctl --stop ignores --dry-run

Position: amend

## Findings

- The change is CLI argument validation in `skills/plot/scripts/plot-fleetctl.sh` (parser at `:764-795` on `origin/main`, `dry_run` read at `:654` and `:1146` only). Which flags combine with which mode is a property of this script's own interface, not a lifecycle rule, so it does not belong in `@plot-pm/domain`. Keeping it in shell does not break the layering rule. A JS entry point or a domain rule for it would be ceremony.
- No lifecycle action is routed past a controller. `--stop` still orchestrates `plot-dispatch.sh --stop` and `unload_supervisor`; the refusal only exits before them. No controller, port or adapter changes. `packages/board/src/server/supervisor-reading.ts:52` and `fleet.ts:568` call the script with `--status` only; neither passes `--dry-run`, so the board needs no change.
- No index is read and no host answer is bought. The decision is a pure function of argv. "A Decision Reads The Index" does not apply.
- The change grows the shell, and the plan does not pay for it. `scripts/check-shell-lines.sh` (CI, `ci.yml:1509-1511`) counts commands, and `a || b` counts two. A post-loop refusal such as `[ "$dry_run" = 0 ] || [ "$mode" = start ] || { echo ...; exit 1; }` adds about four commands. The gate stores no allowance and has no override. The plan says "a refusal costs about four lines" (plan line 38) but names no lines to remove in the same change. As written, the slice fails `check-shell-lines.sh pr` in CI. `check-shell-lines.sh` is also absent from the `Local checks` `**` list, so an unattended agent does not see the failure before it pushes.
- `-h|--help` prints `sed -n '2,27p' "$0"` (`:789`). The plan edits the usage block at `:2-5` and the `--dry-run` comment at `:31`. A longer usage block shifts the help range. The plan does not mention this.

## Amendments required

1. Name the offset: the slice removes at least as many counted commands from shipped shell under `skills/` as the refusal adds, in the same change. Name a candidate, or state the rule "find dead or duplicated commands in `plot-fleetctl.sh` and remove them; prove net growth is zero or below".
2. Add `./scripts/check-shell-lines.sh pr` to the slice's verification steps, with the expected result "passes".
3. State the shape of the check: one test after the argument loop, keyed on `mode` and `dry_run`, not a check inside the `--dry-run)` case arm (argument order `--dry-run --stop` would bypass an in-arm check).
4. If the usage block grows, update the `sed -n '2,27p'` range in the `-h` arm, or keep the usage block to the same line count.

## Decisions for a person

- None under this lens. The Open Question on `--once`/`--status` is a search the agent can answer.

## Ran versus read

- Ran: `git show origin/main:` of `plot-fleetctl.sh`, `skills/plot-fleet/SKILL.md`, `skills/plot/scripts/README.md`, `scripts/check-shell-lines.sh`; grep for `dry_run`/`dry-run` in the script and for `plot-fleetctl` callers under `packages/*/src`; grep of `ci.yml` for the shell-lines gate.
- Read only: the plan, the juror brief, repo `CLAUDE.md`. Did not run `check-shell-lines.sh` or any test.
