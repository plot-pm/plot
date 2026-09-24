## Implementation brief — a-stop-that-reports-failure-does-not-exit-zero

- **Plan (canonical):** `docs/plans/2026-09-24-a-stop-that-reports-failure-does-not-exit-zero.md` on main
- **Approved:** 2026-09-24, in-session review after panel (round 1)
- **Branch:** `bug/the-unload-is-verified-to-a-bound` (base: `main`)
- **Ends as:** one PR to main, opened with `skills/plot/scripts/plot-open-pr.sh`
- **Review of the code:** repo convention (CI green + review)

The plan's only slice. Nothing waits on it and it waits on nothing.

### What to build

`plot-fleetctl.sh --stop` asks `supervisor_loaded` exactly once after `launchctl bootout` (`:758-776` on main at dispatch). Measured 2026-09-24: that one question answered *loaded*, the script printed `supervisor did NOT unload — com.plot-pm.registryd is still loaded` and exited **0**, and `launchctl print` moments later exited 113 (not loaded). Two defects compound:

1. **The check is a single sample.** It reported a failure the world did not have.
2. **The failure does not reach the exit code.** The script exits 0 after printing it.

Because the arm believed the unload failed, it kept `.plot/state/fleet-start.done`. The next `--status` then read *unit present + marker present + not loaded* as `install=installed` with exit 1, and `supervisorState` maps that to **`died`** — rendered on the board as *FLEET STOPPED UNEXPECTEDLY* at `alert` prominence. The false negative on the unload is what fed a crash alarm for a deliberate stop.

The fix: after `bootout`, poll `supervisor_loaded` to the `--wait` bound (default 30 s). On a confirmed unload, print `supervisor unloaded` and clear the marker, as today. At the bound, print the failure, keep the marker, and make the run exit non-zero. The plan is canonical; this is orientation.

### Settled decisions — do not re-derive them

**The mechanism is undetermined, and the fix must not depend on it.** Three candidates fit the readings: teardown still running, launchd restarting the job under `KeepAlive`, or `bootout` failing silently (its exit code is discarded by `2>/dev/null` at `:760`). No reading exists from inside the window, so none of the three is established. A bounded poll is correct under all three: the first finishes inside the bound, the other two stay loaded at the bound and are honestly reported as unconfirmed. **Do not spend time reproducing the failure.** The one reproduction attempt (bootstrap the real unit, poll every 50 ms after `bootout`) unloaded in ~50 ms on iteration 1 and explains nothing. Do not size the bound from it.

**The bound is `--wait`, not a new constant.** launchd's default SIGTERM→SIGKILL escalation is 20 s (`ExitTimeOut` is unset in the plist), so a real teardown has an upper bound, and the existing `--wait` default of 30 s covers it with margin. The "wedged tick has no upper bound" premise was withdrawn: `registryd-main.ts` registers no signal handler, so SIGTERM terminates at once.

**Copy the loop thirty lines above the bug; add no helper.** `:729-734` polls a worker with `started=$(date +%s)`, `while [ $(( $(date +%s) - started )) -lt "$wait_bound" ]`, `sleep 0.5`, and a flag-and-break. `plot-boardctl.sh` open-codes the same shape twice more. Three open-coded copies exist and there is no shared helper; this slice makes a fourth in the same shape rather than extracting one.

**The precedent is `plot-boardctl.sh --stop` (`:517-538`), adopted in part.** Take its two arms: poll to a bound, then exit 1 with the evidence named when the fact still does not hold. **Do not copy its `kill -KILL` escalation (`:528-532`).** A supervisor that will not unload is reported, never killed — ending a wedged process is a person's call. Do not look at `--start` for the pattern either: it distrusts a *success* exit code, which is the other half.

**The marker follows the observation.** `rm -f "$(start_marker)"` stays inside the confirmed-unload arm only. `--status`'s prose ("Nothing unloaded it … So it died on its own") is correct reasoning from a false premise; **do not edit `--status`**. Fixing the observation fixes the message.

**The exit code has no automated reader today.** The board reads `--status`'s exit code, never `--stop`'s. It is being made correct ahead of a reader, so the contract test is what holds it — not a consumer.

### Done when

The plan's `### Done when` list is the specification. The assertions below exist because a naive implementation passes without them:

- **An unconfirmed unload must not `exit 1` inside the supervisor block.** The agent summary (`N agent(s) did not exit within …`) prints *after* that block. An early exit swallows it when agents and supervisor both fail. Set a flag, and exit non-zero at the end. A test drives agents-still-running together with supervisor-unconfirmed and asserts both reports print.
- **Both arms need a stateful stub.** `stubPlatform` (`test/reconcile/fleetctl.test.mjs:706`) answers `launchctl` statically, so it cannot express *loaded, then unloaded after `bootout`*. Extend it (or add a sibling) with a counter file: `print` answers 0 for K calls after `bootout`, then 113. With K ≥ 1 the confirmed arm is only reachable by polling, which is what makes the test fail on the single-sample code. The unconfirmed arm answers 0 forever and runs with `--wait 1`, so it stays fast.
- **Assert the marker in both arms**, not only the text: gone after a confirmed unload, still present after an unconfirmed one.
- **The not-loaded arm stays exit 0** with `supervisor was not loaded`. A stub that answers 113 from the start covers it. This is the regression the plan names.
- **Assert exit codes exactly** (`0`, `1`), not merely zero/non-zero. The file already does this for `--status` (`:738`, `:882`) and says why.
- **`supervisorState` lock:** after a confirmed stop the unit file remains and the marker is gone, which `--status` reports as `interrupted`. `packages/domain/test/supervisor-reading.test.ts:84-90` already asserts that exit 1 with `not-installed`/`interrupted`/`none` is not `died`. Check that it covers this case. If it does, name the stop in a comment or a dedicated `it` rather than adding a duplicate rule test.
- **`skills/plot-fleet/SKILL.md:191`:** "Exit 1 says at least one did not exit" becomes a partial statement. Amend it so exit 1 also covers a supervisor unload that was not confirmed within the bound.
- **Optional, in scope:** the unconfirmed report may name the supervisor pid at the bound (`supervisor_pid`). A changed pid distinguishes a `KeepAlive` restart from a stuck teardown, and it is the reading that was missing on 2026-09-24. Do not add escalation or retries.

Plus the repo gates:

- `nvm use` (Node 24; pnpm crashes on 26)
- `pnpm run test:contracts` — `fleetctl.test.mjs` lives here; run that file alone first with `node --test test/reconcile/fleetctl.test.mjs`
- `pnpm --filter @plot-pm/domain test` if the domain test changes
- `pnpm test`
- A changeset: package `'plot': patch`, description first, `bumps:` last, bumping `plot` (the script) and `plot-fleet` (the SKILL.md) as `patch`. Run `./scripts/check-changeset-packages.sh`.
- Do **not** run `test:e2e` locally.

**Nothing in this suite may touch the real init system.** The file's header (`:12-40`) and its guard stub explain why: a test once ran `launchctl bootout` on the operator's live label. Every new test goes through the PATH stub and a test label.

### Bookkeeping

- Push the first real commit as soon as it exists.
- Open the PR with `skills/plot/scripts/plot-open-pr.sh` (`--draft` while moving). Never `gh pr create`.
- When the PR exists, append `→ #<number>` to this branch's line under `## Slices` in the plan on main.

### Scope guard

This branch owns:

- `skills/plot/scripts/plot-fleetctl.sh` — the `--stop` arm's supervisor block and its final exit only
- `test/reconcile/fleetctl.test.mjs` — the stub extension and the new `--stop` tests
- `skills/plot-fleet/SKILL.md` — the exit-code sentence at `:191`
- optionally `packages/domain/test/supervisor-reading.test.ts` — one named case
- one `.changeset/*.md`

In flight at dispatch (verified 2026-09-24): **no remote branch touches any of these files.** The approved sibling plan `a-supervisor-that-stopped-ticking-is-not-running` names `bug/the-status-says-when-it-last-ticked` and `bug/the-board-shows-the-tick-age`. Neither was claimed at dispatch. The first one changes `plot-fleetctl.sh --status` and very likely `fleetctl.test.mjs`. Keep to the `--stop` arm, and expect a textual merge in the test file if both run at once.

If you find something the plan did not anticipate, report it rather than improvising outside scope.
