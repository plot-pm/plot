# Panel moderation: a-second-mode-flag-in-plot

Round 1. Four jurors: layering, safety, testability, seams. Positions: amend, amend, amend, amend. All four verdict files name a position.

## Shared findings

- **The offset is unnamed.** Three jurors (layering 4, safety 4, seams 2) say an unattended agent must not pick the shell-lines offset alone. Testability does not raise it.
- **The cited lines hold on `fbf670eaf`.** Layering 6, testability and seams 8 each checked `:773-782` and `:1276` against the moved `origin/main`. All three ask the slice to find sites by content.
- **The refusal is argument parsing, not a domain rule.** Layering 1 states it; no juror disputes it.
- **The two Open Questions are safe either way.** Every juror reads the proposals (`--stop --stop` passes, `-h` exits 0) as harmless; testability and safety still ask a person to settle them.

## Disagreements

1. **Whether the order against the sibling plan needs a mechanism.** Safety 6 and seams 1 both say the ordering is prose only. They disagree on the remedy. Safety asks the agent to check the sibling's PR before its first edit and write a `PLOT-BLOCKED` marker if it is open. Seams says the hunks do not overlap, so the slice can proceed in parallel and rebase. Layering 5 reads the prose as a stated order and asks for nothing. **Resolution (caller):** a `<!-- waits: feature/plot-fleetctl-stop-ignores-dry-run -->` annotation on the branch line. Seams' claim that "no plan field or rule orders one plan's slice behind another plan's slice" is false: `waits:` is a parsed annotation (`docs/plans/2026-09-01-a-slice-can-wait-on-another-plan.md`), used by at least five plans on `origin/main`. The annotation makes safety's check a gate rather than an agent step.
2. **What the offset is.** Layering 4 proposes inlining `unit_name()` or `tick_age_seconds()`. Safety 1 offers that or merging the mode arms, and excludes `desk_running`, `process_cwd` and `plot_process_candidates`. Seams 2 asks for named candidates only. **Resolution (measured by the amender):** with the gate's own `COUNT_AWK`, the loop counts 46 before and 43 with the merged arm including the refusal, so the merged arm alone pays −3. Inlining `unit_name()` measured 19 before and 19 after, so it pays nothing; layering's candidate would not have closed the gap. `tick_age_seconds()` stays as a named fallback.
3. **Whether the panel can settle the Open Questions.** Layering says no decision needs a person. Testability and safety say a person settles them. **Resolution (caller):** both settled as proposed.

## Shared blind spots

- **No juror counted.** Every juror states it did not run `check-shell-lines.sh` or its awk. Layering's command estimate ("about five") and its `unit_name()` candidate were both wrong in the direction that matters: the separate `case` the plan described counts 56 against 46 (+10), and inlining `unit_name()` saves 0.
- **No juror prototyped the parse.** The amender ran the merged arm under `bash` against nine argument vectors, including `--start x` and `--stop 3`, which no juror named; both keep their pre-change `unknown argument` refusal.
- **No juror checked the `-h` header range against a doc edit.** A new usage line inside `:2-27` would shift the range the sibling's slice fixes. The plan now puts the rule in a comment above the arm.
- **The sprint seam.** Only seams 6 saw that `docs/sprints/2026-W45-follow-ups-2-30-1.md` does not list this plan while its `Sprint:` field names the sprint. The amender confirmed it on `origin/main` and left it to the sprint controller at approval; the plan's Notes record it.

## Ran versus read

| juror | ran | read only |
|---|---|---|
| layering | `git fetch`, `git show origin/main:` on the script, the gate and the sibling plan, `git grep -wc` for every function's callers, `gh issue view 3119` | plan, `CLAUDE.md` |
| safety | `git fetch`, `git show` and grep over the script, `git grep` for callers, `gh issue view 3119`, `gh pr list --head feature/plot-fleetctl-stop-ignores-dry-run` | plan, brief, sibling plan and tests |
| testability | `git show origin/main:` over the script and `fleetctl.test.mjs`, `gh pr view 3128` | plan |
| seams | `git fetch`, `git show` on the script, sibling plan, sprint file, gate, `plot-boardctl.sh`, `plot-dispatch.sh`, `SKILL.md`; `git grep` for callers and dependency syntax; `git ls-remote`; `gh pr list`; `gh pr diff 3128`; `gh issue view 3119` | plan, brief |
| amender | the gate's `COUNT_AWK` over the loop, the merged arm, the separate-case variant and `unit_name()`; the merged arm under `bash` on nine argv; `git grep` for `waits:`, callers and sprint lines; `gh pr view 3113` | the four verdicts, the plan, `fleetctl.test.mjs` cases cited |

No one ran a test suite, a fleet, board or dispatch command.

## Decisions

| decision | by |
|---|---|
| `--stop --stop` passes as one mode | caller |
| `--start 3` keeps working | caller |
| Two different modes refuse with exit 1 before any host, init-system or bundle call; the message names both; exit 1 shared with `--status` is safe because the one package caller passes `--status` alone | caller |
| Order by `waits: feature/plot-fleetctl-stop-ignores-dry-run`; cite sites by content | caller |
| The offset is the merged mode arm (−3), with `tick_age_seconds()` as fallback; `desk_running`, `process_cwd`, `plot_process_candidates` and the `--stop` arm excluded | caller (options), amender (measured choice) |
| Tests: running-desk fixture for `--start --stop`; no-start assertions for `--stop --start`; `--stop --stop` and `--start 3` regressions; message asserted; mutation check | caller |
| `-h` keeps exiting 0; a conflict before `-h` refuses first | amender (plan's proposal kept; `-h` acts on nothing) |
| The usage header does not change; the rule goes in a comment above the arm | amender (keeps the sibling's `-h` range fix correct) |
| Same defect in `plot-boardctl.sh` and `plot-dispatch.sh` filed as #3138 | caller |
| Sprint file line left to the sprint controller | amender (a sprint write belongs to `plot-sprint-state.sh`, outside an amendment) |
