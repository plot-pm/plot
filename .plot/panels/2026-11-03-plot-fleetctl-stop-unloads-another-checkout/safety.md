# Safety juror: plot-fleetctl --stop unloads another checkout's supervisor

Position: amend

The approach is right: `--stop` must read `supervisor_checkout` before `bootout`, and only `this <dir>` may unload. Every failure of the reading (`unknown`, a truncated path, a missing key) lands on a refusal, never on a wrong unload. Four gaps remain. Two of them break the fix as a Sonnet agent would build it from the plan text.

## Findings

### F1 (HIGH). "Refuse `unknown`" without a `supervisor_loaded` guard refuses every stop with no supervisor loaded

- `supervisor_checkout` (`skills/plot/scripts/plot-fleetctl.sh:238-249` on origin/main) answers `unknown` whenever `supervisor_workdir` is empty, and that includes a label launchd does not hold (`launchctl print` exits 113, `:205-213`).
- The plan places the check "before the agent loop" and says "`unknown`: refuse". Read literally, a `--stop` after a supervisor crash, with agents still running, now refuses and signals no agent. Today that path prints `supervisor was not loaded` (`:1385`) and stops the agents.
- `--start` avoids this because it calls `supervisor_loaded && refuse_label ...` (`:1107`). The plan does not carry that guard over.

### F2 (HIGH). The existing `--stop` tests use a launchctl stub that prints no working directory, and a systemctl stub that answers `4242` to every `show`

- `stubUnload` (`test/reconcile/fleetctl.test.mjs:1519`) makes `launchctl print` emit only `\tpid = 4242`. After the fix, `supervisor_checkout` answers `unknown`, so the three cases at `:583`, `:605` and `:625` refuse instead of unloading and fail.
- The systemd arm of the same stub echoes `4242` for any `show`, so `systemctl --user show ... -p WorkingDirectory` reads `4242` and `supervisor_checkout` answers `another 4242`.
- The slice names only new cases. It must also say that `stubUnload` emits `working directory = <sandbox root>` (launchd) and answers `WorkingDirectory` with the sandbox root (systemd), or the agent finds three red tests and has to guess why.

### F3 (MEDIUM). The check and the `bootout` are separated by the agent loop

- The plan reads the owner once, before the agent loop. The loop waits up to `--wait` (default 30 s, `:744`) per branch (`:1302`), so the gap before `unload_supervisor` (`:1364`) can be minutes.
- In that window another checkout's `--start` can bootstrap the same label. This is the exact shape of #3060: two checkouts that resolve to the default label. The stop then unloads the new foreign job.
- A second `supervisor_checkout` read immediately before `unload_supervisor` closes this at the cost of one `launchctl print`. Keep the early read too, so that a refused stop signals no agent.

### F4 (MEDIUM). The refusal names no route to this checkout's own supervisor

- In the measured case, `ewz-leg`'s own job `com.plot-pm.fleetd.ewz-leg` stays loaded and keeps re-dispatching under `KeepAlive`. After the fix, `--stop` in `ewz-leg` refuses, and the operator still cannot stop their own fleet through the tool.
- `PLOT_FLEET_LABEL` already overrides the config (`:82`). The refusal should print `PLOT_FLEET_LABEL=<label> plot-fleetctl.sh --stop` for each loaded `com.plot-pm.fleetd*` / `com.plot-pm.registryd*` job whose working directory is this checkout. That answers Open Question 1 as a read-only step: list and `launchctl print` each job, name the matches, and unload none of them. The command must never pick one of these labels and boot it out by itself. That would be a second, laxer stop rule.
- Live reading on this machine, 2026-11-03: `launchctl list` holds four plot-pm jobs (`com.plot-pm.fleetd`, `com.plot-pm.fleetd.quaweb-website`, `com.plot-pm.fleetd.agent-skills`, `com.plot-pm.registryd.ewz-kus-portal`), each printing `working directory = <its own checkout>` at line 15 of `launchctl print`. The multi-checkout shape is the normal case here, not an edge.

### F5 (LOW). The plan does not name the exit code or say that agents were left alone

- "exit non-zero" is not specific enough for a test. The existing stop failures use exit 1 (`:1400-1403`), `--start`'s `refuse_label` refusals use exit 1 (`:1107`, `:1109`), and exit 3 means "unaskable" (`:718`, `:721`). Pin exit 1 for both `another` and `unknown`.
- The message must say that no agent was signalled and nothing was unloaded. Without that, the operator cannot tell this refusal from a partial stop, because the agent loop prints before the supervisor block today.

### F6 (LOW). A `--stop` run from a desk reads the main checkout's supervisor as `another`

- `repo_root` is `git rev-parse --show-toplevel` (`:69`). At a desk under the desk root, which `resolve_wt_root` accepts (`:721`), that is the desk path. The fleetd job's working directory is the main checkout (live: `/Users/jwloka/Quatico/Agentic-Tools/plot`). So a stop from a desk refuses with "serves ANOTHER checkout".
- This error is on the safe side. The plan should still choose: either compare against `plot_repo_root` (`plot-desk-root.sh:38`) for `--stop`, or accept the refusal and test it. `--start` and `--status` share the same property.

### Pre-existing and out of scope (report, do not fix in this slice)

- `--stop` ignores `--dry-run`. The flag is parsed (`:765`), and the stop arm (`:1253-1405`) reads `dry_run` only inside `retire_old_label`. `plot-fleetctl.sh --stop --dry-run` signals agents and boots out the supervisor. A separate issue should cover this.

## Rubric

1. **Fixes the defect?** Yes, for the measured case. The read before `bootout` makes `ewz-leg`'s stop refuse `another /…/websmith`. To verify: a sandbox whose stub prints `working directory = /elsewhere` gets `--stop` exit 1, the stub records no `bootout` call, and `plot-dispatch --stop` is not called. F1 and F3 decide whether the fix is complete. F4 decides whether the operator still needs a person's intervention, which matters for the sprint goal.
2. **Claims true?** Mostly. `supervisor_checkout` is at `:238`, `refuse_label` at `:1102-1109`, the `ANOTHER` line of `serves_line` at `:255` (the function starts at `:252`). The `--stop` arm runs `:1253-1405`, and its `bootout` is inside `unload_supervisor` at `:585`, called at `:1364`. The plan's `:1277-:1364` covers the loop and the call, not the whole arm. `retire_old_label` is at `:623`, not `:616` (`:616` is its comment). The claim "adds no second ownership rule" is only partly true. `oldLabelAction` (`packages/domain/src/rules/old-label-migration.ts`) is the domain's existing rule that maps this/another/unknown to an action. This plan writes a second mapping in shell, as `refuse_label` already does. Other lenses should weigh this.
3. **Breaks / half-done:** the `stubUnload` tests (F2). `skills/plot-fleet/SKILL.md` (`--stop` section near `:220`) and the `plot-fleetctl.sh` row in `skills/plot/scripts/README.md:56` do not mention the new refusal. `scripts/check-shell-lines.sh` refuses net growth of shipped shell, and the plan names no lines to remove. Bash 3.2: a `case` on the answer is fine. Bitbucket: not involved.
4. **Failure modes:** missing key → `unknown` → refuse (safe). Truncated path → `another <fragment>` → refuse (safe). No working-directory key → refuse (safe). Label not loaded → `unknown` → wrong refusal (F1). Label replaced mid-stop → foreign unload (F3). Desk run → wrong-but-safe refusal (F6). Every outcome is either correct or a refusal, except F3.
5. **Buildable unattended?** Not as written. The agent must decide the guard (F1), the stub change (F2), the exit code (F5) and the shell-lines offset. Open Question 2 has a clear answer: write no receipt, because the refusal writes no `State:` line and the receipt gates cover only that. Open Question 1 belongs to a person only if it means anything beyond naming (see F4).
6. **Tests sufficient?** One case per answer is necessary but not sufficient. Add: (a) no supervisor loaded with a running agent → the agent is still stopped and exit 0 (guards F1); (b) the `another` case asserts that the stub saw no `bootout` and that `plot-dispatch --stop` was not called; (c) a stub whose working directory changes between the first and the second `print` → no `bootout` (guards F3). Each of these fails on a naive implementation and passes on the amended one.

## Required amendments

1. Guard the check with `supervisor_loaded`, as `:1107` does. With no label loaded, `--stop` behaves as today.
2. Re-read `supervisor_checkout` immediately before `unload_supervisor`, and refuse on anything but `this`.
3. Name the `stubUnload` change (launchd `working directory = <root>`, systemd `WorkingDirectory`) in the slice.
4. Pin exit 1 for both refusals. The refusal text says that no agent was signalled and nothing was unloaded.
5. In the refusal, name each loaded plot-pm label whose working directory is this checkout, as a `PLOT_FLEET_LABEL=… --stop` command. Never unload it automatically.
6. Name the shell-lines offset, and update `skills/plot-fleet/SKILL.md` and the `plot-fleetctl.sh` row in `skills/plot/scripts/README.md`.
7. Answer Open Question 2 as "no receipt".

## Decisions for a person

- F6: should `--stop` (and later `--start`/`--status`) compare against the main checkout rather than the current worktree? Changing it touches three verbs.
- Whether amendment 5's command list ships in this slice or in a follow-up.

## Ran versus read

- Ran (read-only): `git fetch origin main`, `git show origin/main:` for `plot-fleetctl.sh`, `plot-dispatch.sh`, `plot-desk-root.sh`, `fleetctl.test.mjs`, `check-shell-lines.sh` and `old-label-migration.ts`; `git grep bootout`; `gh issue view 3060`; `launchctl list` and `launchctl print gui/501/<label>` for the four loaded plot-pm jobs, plus `launchctl print` on an absent label (exit 113). I ran no stop, bootout, test suite or host write.
- Read only: the line-level control flow of the `--stop` arm and the stub's behaviour after the change. I inferred F1, F2 and F3 from the code and did not execute them.
