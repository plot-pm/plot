# Safety juror: plot-fleetctl --stop ignores --dry-run

Position: amend

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal rather than a guess.

## Findings

1. **The defect is real and the fix closes it.** On `origin/main` at `e54e53815`, `skills/plot/scripts/plot-fleetctl.sh:788` sets `dry_run=1` in any mode, and `:795` checks only that a mode exists. The `--stop` arm (`:1276`) runs `plot-dispatch.sh --stop "$br"` (`:1336`), unloads the supervisor and removes the start marker without a `dry_run` read. A refusal placed after the argument loop and before `:805` (the first arm) runs before every side effect in every arm. This is the safest shape: a refusal changes nothing, and a preview would need a twin path through each destructive step.

2. **Order of flags is safe, because the check reads the final `$mode`.** The parser is last-mode-wins (`:773-782`). `--start --dry-run --stop` ends as `mode=stop` and is refused; `--stop --dry-run --start` ends as `mode=start` and previews. Both outcomes are safe. The plan must say the check reads `$mode` after the loop, not the flag order. (Out of scope but worth an issue: `--start --stop` silently stops, because a second mode flag overwrites the first with no refusal.)

3. **One claim is inaccurate.** The plan says "The `--stop` arm reads none of them". The `--stop` arm calls `retire_old_label` at `:1441`, and that function reads `dry_run` at `:654`. The plan's next sentence states the effect correctly. The amendment is wording only.

4. **The test asserts three of the four side effects.** The issue names four: agents signalled, stop record written, supervisor unloaded, start marker removed. The plan's test checks exit 1, no dispatch call, supervisor still loaded. It omits the start marker and the stop record. The existing fixture at `test/reconcile/fleetctl.test.mjs:426` already plants a recording `plot-dispatch.sh` and the `guardBin` `launchctl` stub (`:193-221`), so the extra assertions cost two lines.

5. **The mutation run is safe on this machine.** `run()` refuses a call without `guardBin` (`fleetctl.test.mjs:32-33`), so a mutated script that reaches `launchctl bootout` hits the stub and never a real label. The test must use that `run()` and must assert the stub recorded no `bootout`, not only that a status read says loaded: the stub answers `exit 113` (absent) by default, so "still loaded" needs a stub that answers loaded AND logs its calls.

6. **`-h` prints a fixed line range.** `:789` runs `sed -n '2,27p' "$0"`. The usage block ends at `:32`, so `-h` already omits `--wait` and `--dry-run`. An edit that adds lines to `:2-5` shifts the range further. The slice must keep `-h` showing the `--dry-run` rule it adds, or the refusal is documented in a place `-h` does not print.

7. **Exit 1 is ambiguous for `--status`.** `--status` exits 1 for "supervisor not loaded" (`:8-10`), and `packages/board/src/server/supervisor-reading.ts` reads that exit code. A refusal of `--status --dry-run` with exit 1 reads to such a caller as "down". No caller passes `--dry-run` with `--status` today (searched `packages/`, `skills/`, `test/` on `origin/main`: only `--start --dry-run` in `fleetctl.test.mjs`), and unknown-argument refusals already exit 1 (`:790`). The risk is low and needs no amendment; the refusal text must start with `plot-fleetctl:` so a caller that reads stderr sees a refusal, not a status.

8. **Open Question 1 is answered.** No caller in `skills/`, `packages/` or `docs/` passes `--dry-run` with `--once` or `--status`. `plot-fleetd.mjs` accepts its own `--dry-run` (`registryd-main.ts:333`), but `--once` does not forward it. The plan can close the question and refuse all three modes.

9. **Bitbucket and other checkouts are not touched.** The refusal sits before any host or init-system call, so it reaches no host, no other checkout and no label. bash 3.2: a `[ "$dry_run" = 1 ] && [ "$mode" != start ]` test is 3.2-safe.

## Required amendments

1. Correct the Motivation sentence: the `--stop` arm reads `dry_run` once, through `retire_old_label` (`:1441` to `:654`), and only for the old label.
2. State that the check runs after the argument loop and reads the final `$mode`, before the first arm, and names the refusal with the `plot-fleetctl:` prefix.
3. Extend the test to assert all four side effects: no dispatch call, no `launchctl bootout` recorded by the stub, start marker present, no stop record written. Use the existing `run()`/`guardBin` and a `launchctl` stub that logs its arguments.
4. Keep `-h` (`sed -n '2,27p'` at `:789`) printing the `--dry-run` rule after the usage edit; adjust the range in the same slice if the block moves.
5. Close Open Question 1 with the search result above.

## Decisions for a person

None. Open Question 2 (a real `--stop` preview) is a later plan, and the refusal is the safe state until then.

## Ran versus read

Ran: `git fetch`, `git show origin/main:` of `plot-fleetctl.sh`, `skills/plot-fleet/SKILL.md` and `test/reconcile/fleetctl.test.mjs`; `git grep` for `fleetctl` and `--dry-run` callers across `packages/`, `skills/`, `test/`, `docs/`; `gh issue view 3099`. Read only: the `--stop` arm, `retire_old_label`, the parser and the test fixture. Ran no test suite, no fleet or board command, and no host write.
