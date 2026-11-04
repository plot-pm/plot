# Safety juror — 2026-11-04-a-second-mode-flag-in-plot

Lens: what can this change stop, delete, merge, overwrite or misreport, and does every uncertain case end in a named refusal?

Position: amend

## Findings

1. **The defect is real and the fix direction is safe.** `skills/plot/scripts/plot-fleetctl.sh` on `origin/main` (`fbf670eaf`) assigns `mode=` at `:773`, `:774`, `:777` and `:782`, and the arms dispatch on the final value at `:805` (status), `:1030` (once), `:1038` (start) and `:1276` (stop). `--start --stop` reaches the `--stop` arm. A refusal inside the loop exits before `plot_repo_root`, any init-system call or any bundle call, because the arms start after the loop and the mode-required line (`:795`). The refusal itself writes nothing, so the change cannot add a new destructive path.
2. **No caller passes two modes, so the refusal breaks nobody.** `supervisor-reading.ts` passes `--status` alone; `skills/plot-fleet/SKILL.md:76,100,153,229` each show one mode; every `run(ctl, …)` in `test/reconcile/fleetctl.test.mjs` passes one mode. The one script that prints a fleetctl command (`plot-fleetctl.sh:470`) prints `--stop` alone.
3. **Edge cases resolve safely under the proposed design.** `--start 3 --stop`: the count is consumed at `:778-780`, then `--stop` refuses. `--start --stop -h`: the refusal fires before `-h`. `--stop --stop`: passes as one mode, which is harmless. `--start --dry-run --stop` and `--stop --dry-run --start`, which the sibling plan says refuse or preview, now refuse at the conflict instead; both outcomes write nothing, and the sibling's four test cases use no mixed-mode argv, so none breaks.
4. **The shell-lines offset is the one unsafe part, because it is unnamed.** The plan leaves the choice of removed code to the agent ("one-caller helper functions"). Measured on `origin/main`: after the sibling takes `running_major` and `home_short`, the single-caller functions left are `unit_name` (`:100`), `plot_process_candidates` (`:274`), `process_cwd` (`:348`), `tick_age_seconds` (`:517`) and `desk_running` (`:585`). `desk_running` is the predicate the `--stop` arm polls at `:1341` (`poll_while desk_running "$wt"`), and `process_cwd`/`plot_process_candidates` decide which processes count as "THIS repository" — the attribution that prints `--stop` commands at `:470`. An inlining error in any of those three changes what a stop waits for or whose process it names, and the plan names no test that would catch it. An unattended agent free to pick among them can trade a mode refusal for a stop defect.
5. **The test list does not prove "no side effect" for the stop-last case's mirror.** The slice line asks that a refused call "leaves no stop record and sends no signal". That covers `--start --stop`. It does not cover `--stop --start`, whose pre-change behaviour is a START: fill the unit, load it, bring up agents. A refused `--stop --start` must also assert no fill, no load/bootstrap and no `plot-dispatch.sh --start` call.
6. **The ordering against the sibling plan is prose only.** "This slice branches from main after that plan's slice merges" names no mechanism, and I found no cross-plan dependency marker the fleet scan reads. The sibling slice has no PR yet (`gh pr list --head feature/plot-fleetctl-stop-ignores-dry-run` returned none). If both run at once, the result is a textual conflict in the argument loop and in the shared offset pool — a rebase refusal, not a silent mis-merge — so the risk is wasted work, not a wrong stop. It still needs a stated stop condition for the agent.
7. **The refusal message is a named refusal.** `plot-fleetctl: --<first> and --<second> are different modes; give one; nothing was done`, exit 1 — consistent with the unknown-argument refusal at `:790`.

## Amendments required

1. **Name the offset.** Either (a) fold the four mode arms into one `--status|--once|--start|--stop)` arm that runs the conflict check and sets `mode=${1#--}` once, with the `--start` count consumption guarded by `[ "$1" = --start ]`, and measure whether that alone keeps the net at or below 0; or (b) name the exact functions to inline and the existing test that holds each. In both cases, state that `desk_running`, `process_cwd` and `plot_process_candidates` are NOT candidates, and that no code in the `--stop` arm (`:1276` onward) is touched for the offset.
2. **Add the start-side assertion.** A case for `--stop --start` asserts exit 1, no unit file written under the fake HOME, no bootstrap/load call recorded by the stub, and no `plot-dispatch.sh --start` call. Keep the `--start --stop` case asserting no `calls.log`, no `unload-ticks`, the start marker still present, and no `fleet-stopped.json`.
3. **State the ordering as a check the agent runs.** Before the first edit, the agent confirms that the sibling's PR on `feature/plot-fleetctl-stop-ignores-dry-run` is merged; if it is not, the agent leaves a `PLOT-BLOCKED` marker naming that PR and stops, rather than editing the same loop.
4. **Add a mutation check**, as the sibling plan does: remove the conflict check, run the `--start --stop` case, and confirm it fails on the `calls.log` or `unload-ticks` assertion.

## Decisions for a person

- The two Open Questions (`--stop --stop` passes; `-h` beside a mode exits 0) are safe either way; the plan's proposals do no harm. A person settles them so the agent does not.

## What I ran versus read

- Ran: `git fetch origin main`; `git show origin/main:skills/plot/scripts/plot-fleetctl.sh` and grep over it for `mode=`, the arm conditions and single-caller functions; `git grep` for fleetctl callers under `skills/`, `packages/` and `test/`; `gh issue view 3119`; `gh pr list --head feature/plot-fleetctl-stop-ignores-dry-run`; `git show` of the sibling plan.
- Read only: the plan, the brief, the sibling plan's design and tests. I ran no test suite, no gate script and no fleet or board command, and I did not count the refusal's commands with `check-shell-lines.sh`.
