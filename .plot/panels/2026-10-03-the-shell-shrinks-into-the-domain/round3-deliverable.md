# Round 3 — Deliverable

Position: amend

## What I read

- Read in full: the plan at `main` (`d8920211f`, last plan commit `4aee1f6df`), `round2-deliverable.md`, `round2.md` (only the deliverable items in detail), and the brief `rubric3.md`.
- Ran `skills/plot/scripts/plot-plan-meta.sh docs/plans/2026-10-03-the-shell-shrinks-into-the-domain.md`: exit 0, `format: canonical`, `phase: draft`, four waves of exactly one branch each in plan order, `waits_on: bug/the-monitor-follows-the-hop` on slice 1 only, four `builds:` values, five changelog lines, `issues: [1245]`, `long_wave_names: []`, `unread_branch_headings: []`, `malformed_prs: []`, `rounds: 2`.
- Ran the per-file count over `git ls-files 'skills/*.sh'`, each through `command grep -vE '^\s*(#|$)' | wc -l`: 61 files, total 15,499 (the plan states 15,423; 76 lines grew since its measurement). Top seven: `plot-host.sh` 1,737, `plot-dispatch.sh` 1,650, `plot-fleet-scan.sh` 1,451, `plot-reconcile-scan.sh` 1,269, `plot-worker-loop.sh` 870, `plot-fleetctl.sh` 691, `plot-deliver.sh` 601.
- Ran `gh pr view 1234` and `gh pr view 1244`: both MERGED (09:54:07Z and 08:44:21Z on 2026-10-03).
- Read the `State:` line of the seven siblings slice 1 names: six read `Approved`; `a-scan-says-where-its-time-goes` reads `Delivered` (`215e633b4`, 2026-10-03 11:13 +0200, "plot: deliver a-scan-says-where-its-time-goes").
- Ran `git grep -n plot-fleetctl` over `packages/board/src`, `skills/*/SKILL.md` and `hooks`: `packages/board/src/server/supervisor-reading.ts:53` holds `const SCRIPT = 'plot-fleetctl.sh'`, and `fleet.ts:738` and `:3450` read the result of its `--status` run. `skills/plot-fleet/SKILL.md:76,97,134` runs it for `--once`, `--status` and `--start`.
- Read the `on:` blocks of `.github/workflows/ci.yml` (pull_request and push to `main`) and `build-bundles.yml` (push to `main`).

## What must change

1. **Slice 4's deliverable is not determined by the plan's own ranking rule (Design › Approach, slice 2 and slice 4; Slices › The first script becomes a command; Changelog line 5).** The ranking is "scripts whose *runs* is once per operator command, excluding the five largest, sorted by `--per-file` lines, largest first". On `main` today the next two by size are `plot-fleetctl.sh` (691) and `plot-deliver.sh` (601). `plot-fleetctl.sh` runs once per `/plot-fleet` command (`skills/plot-fleet/SKILL.md:76,97,134`) and also on the board's refresh through `supervisor-reading.ts:53`, so its *runs* value is not one of the three the column defines, and the plan gives no rule for a script with several callers. The first-ranked script is therefore either the fleet supervisor's control (launchd unit fill, the `--stop` orchestration over `plot-dispatch.sh`, seven test files and a board reader name it) or the delivery controller (a `plot-state-gate.sh` receipt owner and one of slice 3's three gated basenames). Those two are different slices with different risks, and an approver of this plan approves one of them unseen. Fix: state the rule for a multi-caller script (for example, the most frequent caller sets *runs*), run the ranking now, since every input exists on `main`, and name the script in slice 4's branch line and Changelog line 5 before approval. Add a checkable end state to slice 4: `<script>.sh` is a launcher (or absent), `board/<script>.mjs` exists, and `check-shell-lines.sh` reports the count fell by the script's lines minus the launcher's.

2. **Slice 1 amends a sibling that is already Delivered (Design › Approach, "Slice 1 tells the work already approved"; Slices › The shell cannot grow).** The plan says "Seven Approved siblings write shell" and lists `a-scan-says-where-its-time-goes`. That plan was delivered at `215e633b4` on 2026-10-03, after the round-2 amendment. A Notes line on a Delivered plan reaches no future brief. Fix: name six siblings, and phrase the deliverable as "every sibling Approved when slice 1 starts", so the list does not go stale again before the slice runs.

## What holds

- The plan parses canonically: four waves of one branch each, in the order the Approach describes, no malformed or unread headings (command above).
- Round-2 deliverable item 1 is answered in part: the sort direction (largest first) and the exclusion of the five largest are now in the plan. What remains is item 1 above.
- Round-2 deliverable item 2 is answered: slice 2 adds the 13 missing rows before it adds the columns. The ranking still names no shipped file, but it is reproducible from `--per-file` plus the *runs* column, which a reviewer can check.
- Round-2 deliverable item 3 is answered: the old slice 4 (the three commit hooks) is dropped, with the reason that each exits before its token loop on every #1245 command, and #1245 closes at slice 3.
- Round-2 deliverable item 4 is answered: slice 1 carries `<!-- waits: bug/the-monitor-follows-the-hop -->`, and the parse shows `waits_on`. #1234 merged at 09:54Z, so the wait is satisfied and costs nothing; #1244 merged and is correctly left out.
- The wave order holds: the ratchet lands before any slice that changes shell size, slice 4 follows slice 2 whose ranking it consumes, and the wave gate enforces both. Slice 3 does not need slices 1 or 2, so the serial order delays the #1245 fix but breaks nothing.
- Slices 1, 2 and 3 each name a file or function a reviewer can check: `scripts/check-shell-lines.sh` with five fixture cases; the README columns and the 13 rows with `check-helper-table.sh`'s baseline drop; `controllerInvocation` in its own bundle with a stated failure direction.
- The Changelog describes what the slices build. Line 1 is slice 1, line 2 is slice 2 plus slice 1's `--per-file`, line 3 spans slice 1 (brief template) and slice 2 (docs, `CLAUDE.md`), line 4 is slice 3, line 5 is slice 4. Line 1's push row fits `ci.yml`, which runs on push to `main`; the bundle App's pushes under `build-bundles.yml` change only `.mjs` files and do not move the count.
- Slice 3 edits `plot-controller-gate.sh` (135 code lines) under slice 1's ratchet; replacing its token loop with a prefilter and a bundle call is expected to shrink it, so the slice pays for itself.
