# Seams juror: plot-fleetctl-stop-ignores-dry-run

Position: amend

Lens: where the change meets other plans, open PRs, branches, declared shell/domain duplicates and the corpus tier.

## Findings

1. **No open PR or active plan collides with the slice.** `gh pr list` shows 11 open PRs (#3076, #3080, #3105, #3109-#3116). None of their file lists touches `skills/plot/scripts/plot-fleetctl.sh`, `skills/plot-fleet/` or `docs/fleet-user-test.md`. No plan under `docs/plans/active/` on `origin/main` (`e54e53815`) names `plot-fleetctl` outside this plan. The sibling plan `2026-11-03-plot-fleetctl-stop-unloads-another-checkout.md` reads `State: Delivered` (`:7`, `:16`), and its commits `644d3194e`..`c66f29262` are the last five on `plot-fleetctl.sh`. The plan's note (`:60`) that the slice starts from the sibling's result is true. No ordering constraint follows.

2. **The plan's line claims hold on `e54e53815`.** `dry_run` is declared at `:764`, set at `:788`, read at `:654` (`retire_old_label`) and `:1146` (`--start`). The `--stop` arm now ends after `:1441` (`retire_old_label || sup_unconfirmed=1`), past the issue's `:1405`. So `--stop --dry-run` today unloads the configured label via `unload_supervisor` (`:1413`) and only reports the old label, as the plan says.

3. **The shell-lines ratchet refuses any growth, and the plan names no offset.** `scripts/check-shell-lines.sh` header: "THE SHELL UNDER skills/ MAY SHRINK AND MAY NOT GROW", with no allowance and no override. The plan (`:38`) says "a refusal costs about four lines" as though four lines were affordable. They are not: any added command fails CI unless the same change removes an equal count under `skills/`. "Room freed by a merged change is gone for the next change", so the offset cannot come from a sibling PR. An unattended Sonnet agent meets this at CI with no decision in the plan about where to remove commands.

4. **`--help` already hides the `--dry-run` text the plan edits.** `plot-fleetctl.sh:789` prints `sed -n '2,27p' "$0"`, but the usage block runs to `:32`; `--wait` (`:28-30`) and `--dry-run` (`:31-32`) never print. The plan names the usage block as `:2-5` (`:43`) and expects the document to state the rule. Any line it adds to the block moves the `--dry-run` text further past `:27`. The refusal message itself carries the rule, but the documented help stays wrong.

5. **Open Question 1 is answerable now and should not reach an unattended agent.** Read-only search on `origin/main`: the only code caller of `plot-fleetctl.sh` in `packages/` is `supervisor-reading.ts:152`, which passes `['--status']` alone. Every `--dry-run` in `test/reconcile/fleetctl.test.mjs` (`:361`, `:394`, `:1019`, `:1066`, `:2179`, `:2284`, `:2704`) pairs it with `--start`. `skills/plot-fleet/SKILL.md:44` documents it with `--start` only. `plot-fleetd.mjs --dry-run` (`registryd-main.ts:306-333`) is a different entry point and does not pass through `plot-fleetctl.sh`'s parser. So the refusal can cover `--once` and `--status` with no caller broken, and the plan can close the question.

6. **No declared shell/domain duplicate and no corpus pair is touched.** `packages/domain/corpus/` names `fleetctl` zero times. The argument parser has no TypeScript twin. The bundles `plot-fleetctl.sh` calls (`old-label.ts`, `write-probe.ts`) are reached from `--start` and `--stop` arms after the parser, so a refusal placed after the loop runs before them and leaves their contracts unchanged.

7. **The sprint field has no sprint line.** The plan sets `Sprint: follow-ups-2-30-1` (`:9`, commit `e2e9ac039`), but `docs/sprints/2026-W45-follow-ups-2-30-1.md` in the worktree has no item for this plan or #3099. The sibling has its line at `:47` and a scope-change log at `:70`.

8. **No changeset is named.** The slice edits `skills/plot-fleet/SKILL.md`, so it needs a changeset with `plot-fleet: patch` in its `bumps:` block, description first.

## Amendments required

- A1. State in Approach that `check-shell-lines.sh` refuses any growth, and name where the slice removes the commands it adds (for example, fold the new mode check into the existing `[ -n "$mode" ] || ...` line at `:795`, or remove a dead command elsewhere in `plot-fleetctl.sh`). Add `./scripts/check-shell-lines.sh pr` to the slice's checks.
- A2. Correct the usage reference to `:2-32`, and fix the `-h` range (`sed -n '2,27p'`) so `--wait` and `--dry-run` print, or state why it stays. A test that `--help` output contains the `--dry-run` line holds it.
- A3. Close Open Question 1 with finding 5's evidence: the refusal covers every mode but `--start`.
- A4. Name the changeset (`'plot': patch`, `bumps: skills: plot-fleet: patch`).

## Decisions for a person

- Add the plan to `docs/sprints/2026-W45-follow-ups-2-30-1.md` with a dated scope-change line, or clear the `Sprint:` field. This is a sprint-scope choice, not the agent's.

## Ran versus read

Ran (read-only): `gh pr list`; `gh pr view <n> --json files` for 9 open PRs; `gh issue view 3099`; `git show`/`git grep`/`git log` on `origin/main` over `plot-fleetctl.sh`, `skills/plot-fleet/SKILL.md`, `test/reconcile/fleetctl.test.mjs`, `packages/*/src`, `packages/domain/corpus`, `docs/plans/active/`, the sprint file, and the sibling plan. Read only: `scripts/check-shell-lines.sh` header. Did not run any test, gate or fleet command.
