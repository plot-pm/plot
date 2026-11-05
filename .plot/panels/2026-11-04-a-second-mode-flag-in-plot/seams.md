# Seams juror: a-second-mode-flag-in-plot

Position: amend

Lens: where this change meets other plans, open PRs and branches, declared shell/domain duplicates and the corpus tier.

## Findings

### 1. The ordering constraint on the sibling plan is prose that nothing enforces

The plan says (Design, "Relation to ...") that "this slice branches from `main` after that plan's slice merges". The fleet has no cross-plan dependency: wave gating is per plan, and no plan field or rule orders one plan's slice behind another plan's slice. Once this plan is Approved, the fleet can dispatch `feature/a-second-mode-flag-in-plot` at once.

State of the sibling on 2026-11-04: `docs/plans/2026-11-04-plot-fleetctl-stop-ignores-dry-run.md` reads `State: Approved` with a `Started:` record for `feature/plot-fleetctl-stop-ignores-dry-run`, but `git ls-remote origin 'refs/heads/feature/plot-fleetctl*'` returns nothing and no open PR carries that head (`gh pr list --state open`, 15 PRs read). The sprint log line 103 records that its brief run was restarted at 18:25Z. So the two slices can run at the same time.

The textual overlap is smaller than the plan implies. The sibling edits the `-h` arm (`plot-fleetctl.sh:789`) and adds one line after `:795`, and inlines `running_major()` and `home_short()`. This plan adds a `case` before the arm `case` inside the loop at `:772-783`. The hunks do not touch the same lines, so git merges them. The real coupling is the shell-lines offset: both slices must pick disjoint candidates, and this plan only says "must not reuse a candidate the sibling plan already takes", which an agent working in parallel cannot check against an unmerged branch.

### 2. The offset candidates are not named

`scripts/check-shell-lines.sh` (`:27`, `:30` on `origin/main` `fbf670eaf`) supports `pr` and `--per-file`, so the measurement the plan names exists. The plan names no candidate. An unattended Sonnet agent must choose dead or one-caller code under `skills/` alone, and the sibling's Decisions section records why a hunt outside the owned file widens the diff. Naming two or three concrete candidates in `plot-fleetctl.sh` other than `running_major` and `home_short` removes both the decision and the collision.

### 3. The same defect lives in two sibling scripts, and the plan does not name them

`skills/plot/scripts/plot-boardctl.sh:243-245` (`--status`, `--start`, `--stop`) and `skills/plot/scripts/plot-dispatch.sh:310-333` (`--status`, `--stop`, `--restart`, `--start`) assign `mode=` in each arm the same way, so `plot-boardctl.sh --start --stop` stops the board and `plot-dispatch.sh --start --stop` runs the stop arm. Out of scope for this slice is right, but the plan should say so and file it, the way the sibling filed #3119. The `--start --stop` hazard in `plot-dispatch.sh` matters more than in `plot-fleetctl.sh`, because `plot-fleetctl.sh --stop` calls `plot-dispatch.sh --stop` per branch.

### 4. Exit 1 collides with the `--status` contract, and the plan does not say why that is safe

The usage block (`plot-fleetctl.sh:7-10`) says `--status` exits 1 when the supervisor is not loaded, "so a caller can gate on it". The board reads that exit code (`packages/board/src/server/supervisor-reading.ts:152`, `['--status']` alone). A refused `--status --once` also exits 1. The plan's Board impact line names the caller correctly, so nothing breaks today; the plan should state, as the sibling's Decisions do, that no caller passes a second mode with `--status`, and that the `plot-fleetctl:` prefix on stderr tells a refusal from a status.

### 5. Interaction with the sibling's refusal is consistent, and the plan states it correctly

After both land, `--start --dry-run --stop` refuses in the loop (mode conflict) before the sibling's post-loop `--dry-run` check runs. The sibling's Design text "`--stop --dry-run --start` previews a start" becomes false once this lands, but the sibling's four tests (`--stop --dry-run`, `--dry-run --stop`, `--once --dry-run`, `--status --dry-run`, `-h`) each pass one mode, so no sibling test breaks. No amendment needed beyond a sentence that names this.

### 6. Sprint seam: the sprint file does not list this plan

The plan reads `Sprint: follow-ups-2-30-1` (commit `223db5036`, only on `origin/idea/a-second-mode-flag-in-plot`). `docs/sprints/2026-W45-follow-ups-2-30-1.md` on `origin/main` lists the sibling (`:51`, `:78`) and not this plan. A plan whose `Sprint:` field names a sprint that does not list it reads as out of scope to the sprint score. The sprint line and its log entry belong with the approval, through `plot-sprint-state.sh` / `/plot-sprint`, not by hand.

### 7. No shell/domain duplicate and no corpus pair

`git grep -i fleetctl packages/domain/corpus` returns nothing. The argument parser has no TypeScript twin: `plot-fleetd.mjs --dry-run` (`registryd-main.ts:333`, per the sibling) is its own entry point. No corpus test is needed and no declared duplicate is touched.

### 8. Code claims hold on current `origin/main`

`origin/main` moved from `e54e53815` to `fbf670eaf`; the cited lines are unchanged: `mode=` assignments at `:773`, `:774`, `:777`, `:782`, the mode-required line at `:795`, the `--stop` arm at `:1276`. No open PR touches `plot-fleetctl.sh` or `test/reconcile/fleetctl.test.mjs` (open PR list read; #3130 adds only a plan file).

## Amendments required

1. Replace "this slice branches from `main` after that plan's slice merges" with a statement that holds without an ordering mechanism: the hunks do not overlap; if the sibling's PR has merged, rebase onto it; if not, the slice proceeds independently and no test reads the sibling's refusal.
2. Name the shell-lines offset candidates in `plot-fleetctl.sh` (two or three one-caller helpers), excluding `running_major` and `home_short`, so two parallel agents cannot pick the same one.
3. Add one Notes line that files the same last-mode-wins defect in `plot-boardctl.sh:243-245` and `plot-dispatch.sh:310-333` as a new issue, out of scope here.
4. Add one Decisions line: exit 1 is safe next to `--status`'s exit-1 contract because the only package caller passes `['--status']` alone (`supervisor-reading.ts:152`), and the stderr prefix tells a refusal from a status.
5. Add the plan to `docs/sprints/2026-W45-follow-ups-2-30-1.md` through the sprint controller, with its log line, so the `Sprint:` field and the sprint file agree.

## Decisions that need a person

- Whether `plot-boardctl.sh` and `plot-dispatch.sh` get the same refusal in this sprint or later.

## What I ran versus read

Ran (read-only): `git fetch`, `git show origin/main:` on `plot-fleetctl.sh`, the sibling plan, the sprint file, `check-shell-lines.sh`, `plot-boardctl.sh`, `plot-dispatch.sh`, `plot-fleet/SKILL.md`; `git grep` for callers, cross-plan dependency syntax and corpus pairs; `git ls-remote` for the sibling branch; `gh pr list`, `gh pr diff 3128 --name-only`, `gh issue view 3119`; `git worktree list`. Read only: the plan file and the panel brief. No test, gate, fleet or board command ran.
