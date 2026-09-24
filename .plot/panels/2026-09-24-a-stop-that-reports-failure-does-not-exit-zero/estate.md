# Estate lens — a stop that reports failure does not exit zero

Position: amend

## What I searched

`skills/plot/scripts/plot-fleetctl.sh` (785 lines), `plot-boardctl.sh` (551), the poll-to-bound corpus across `skills/plot/scripts/*.sh`, `test/reconcile/fleetctl.test.mjs` (929 lines) and the four fleetctl-adjacent test files, every plan in `docs/plans/` mentioning fleetctl / `--stop` / unload / bootout (30 files, four read in full), `skills/plot-fleet/SKILL.md`, and `CLAUDE.md`.

## The line references resolve

- **`plot-fleetctl.sh:763` is exactly what the plan says it is.** `:758` `if supervisor_loaded`, `:760` `launchctl bootout "gui/$(id -u)/$LABEL"`, `:763` the second `supervisor_loaded` — one ask, no poll. The `did NOT unload` branch at `:764` prints and falls through; the only `exit 1` in the stop block is `:782`, gated on `n_still > 0` (agents), and `:784` is the unconditional `exit 0`. **The defect is real and the plan describes its mechanism correctly.**
- **`KeepAlive` is `true` and unconditional** — `skills/plot/units/com.plot-pm.registryd.plist:59-60`. The plan's reasoning about why `bootout` may be slow stands on a fact in the tree.
- **`--wait` exists and defaults to 30 s**, parsed at `:306-308`, documented `:28`, with a bound-not-deadline comment at `:288-292`. Reusing it for the unload is coherent with what the flag already means.
- **The marker logic is as described** — `start_marker()` at `:176`, `rm -f "$(start_marker)"` at `:773` inside the confirmed-unload arm only. The plan's "the marker follows the observation" reading is accurate; no change to the marker rule is needed, only to the observation feeding it.

## The estate already has the pattern — closer than the plan says

**The convention the plan proposes to adopt is thirty lines above the bug, in the same function.** `plot-fleetctl.sh:729-734`:

```
started=$(date +%s)
exited=0
while [ $(( $(date +%s) - started )) -lt "$wait_bound" ]; do
  row=$(plot_worker_state "$wt")
  [ "$(printf '%s' "$row" | cut -f1)" = "running" ] || { exited=1; break; }
  sleep 0.5
done
```

Same `wait_bound`, same `sleep 0.5`, same flag-and-break shape, same "named, not waited on forever" comment at `:744-746`. `plot-boardctl.sh:416-421` and `:517-522` are the same idiom (`waited` counter against `bound * 2`, `sleep 0.5`). **There is no helper to reuse — three open-coded copies, no shared function** — so the slice should copy the agent loop's own shape rather than invent one. This is a strengthening of the plan, not an objection: the fix is smaller and more idiomatic than the plan implies.

## Where the plan overstates the boardctl precedent — the one amendment

The Notes claim `plot-boardctl.sh` "already holds the pattern this adopts" and quote it. **The quoted sentence is not in `plot-boardctl.sh`.** It is in `CLAUDE.md:200`, the helper-script table, paraphrasing the script. The script's own wording is `plot-boardctl.sh:413-415`: *"WAIT FOR THE PORT, not for the process. Exit 0 is not evidence: the server treats `EADDRINUSE` as a report and exits 0."*

More importantly, **that sentence is `--start`'s, not `--stop`'s, and the analogy inverts.** boardctl `--start` distrusts a *success* exit code and polls for positive evidence. Here `bootout`'s exit code is not the thing being distrusted at all — `:760` discards it with `2>/dev/null` and never reads it. What is wrong is the *observation* (`supervisor_loaded` asked once, too early) and the *reporting* (the script's own exit 0 over its own printed failure).

**The transferable precedent is `plot-boardctl.sh --stop`, not `--start`** — `:517-538`: poll the bound, and when the fact still does not hold, `exit 1` with the evidence named. That is precisely the two-arm shape this plan wants, already built, one script over. **Amend the Notes to cite boardctl's `--stop` (`:517-538`) and quote the script rather than `CLAUDE.md`.** Keeping the `--start` citation invites an implementer to build the wrong half — polling for a start-style positive proof instead of the refuse-and-exit-non-zero arm that is the whole point.

Note also that boardctl `--stop` **escalates to `KILL`** at `:528-532`. The plan explicitly refuses escalation (`What this does NOT do`), which is right for a supervisor, but it means the precedent is adopted in part. Saying so in the Notes would pre-empt an implementer copying the KILL arm.

## Prior art: adjacent, not duplicative

Four plans touch this surface and **none of them fixes this**:

- `2026-09-09-the-supervisor-is-loaded-or-it-is-reported` (Released, v2.16.0) — built `start_marker` and the three-state `--status`. It created the marker this bug corrupts; it never touched `--stop`'s verification.
- `2026-09-18-a-stopped-fleet-names-its-repair` (Released, v2.19.0) — its slice's Done-when says *"the exit code is unchanged, 0 loaded and 1 not"*, scoped to `--status`. `--stop`'s exit code was out of scope there and remains unclaimed.
- `2026-09-22-a-loaded-label-is-not-a-running-daemon` (Released, v2.20.0) — `--status` asks the process table. Same family, different verb.
- `2026-09-22-a-test-must-not-stop-the-fleet` (Released, v2.20.0) — built `guardBin`, the stub-`launchctl` seam. **This is the enabler**, not a duplicate.

**No prior plan claims the `--stop` exit code.** The deliverable is not built.

## Testability is better than the plan assumes

`test/reconcile/fleetctl.test.mjs` already has everything the slice needs and the plan does not say so:

- `sandbox()` mints a per-case `PLOT_FLEET_LABEL` (`:112`) and a `guardBin` with stub `launchctl` / `systemctl` (`:130-143`) returning the real codes (113 / 3). A stub that answers "loaded" on the first N calls and "gone" after is a two-line change to that fixture — **both arms are drivable, and on CI's `ubuntu-latest`, which has no launchd.** The `a-loaded-label-is-not-a-running-daemon` plan already relied on this seam after a panel corrected it for scoping the launchd arm away as untestable; the same correction applies here in advance.
- **The two existing `--stop` tests assert no exit code whatsoever.** `:293-298` (`stopempty`) checks only stdout; `:300-336` (`stoporder`) checks call order and stdout. Of 13 `r.status` assertions in the file, **zero are on a `--stop` run.** The plan's "the contract suite covers the exit code" is therefore net-new coverage on an untested path, which is correct — and worth the slice knowing that `stopempty` is the ready-made regression test for the third arm (`supervisor was not loaded` must still exit 0).

## One consumer gap the plan should name

`skills/plot-fleet/SKILL.md:190-192` documents the stop exit code: *"Exit 1 says at least one did not exit."* After this change **exit 1 will have two causes** — an agent that did not exit, and a supervisor that did not unload. A caller reading only the code cannot tell them apart. That is acceptable (both mean "the stop did not fully succeed"), but the sentence becomes wrong as written. **The slice should update that line**; the plan says only "It does not change `--status`'s prose" and is silent on `--stop`'s. Board impact is correctly stated as none — I found no domain or board consumer of the `--stop` exit code (`grep` over `packages/domain/src` and `packages/board/src`: zero hits).

## What I could not determine

- I did not reproduce the failure. The plan is honest that its own 50 ms measurement did not either, and says so explicitly — that is the right disclosure and I have nothing to add against it.
- Whether the systemd arm (`systemctl --user disable --now`, `:761`) shares the timing window. `--now` blocks on stop where `bootout` does not necessarily, so the poll may be a no-op there. It costs nothing and the shared code path is simpler than branching, but no measurement exists either way.

## Summary

Nothing here is already built, and the defect is real at the cited line. The estate's verdict is: **the fix is smaller and better-supported than the plan presents** — the poll idiom is 30 lines up in the same function, and the test seam landed two days ago. The amendment is to the plan's Notes, not its design: **cite `plot-boardctl.sh --stop` (`:517-538`) rather than `--start`, quote the script rather than `CLAUDE.md:200`, note that escalation is the part deliberately not adopted, and add `skills/plot-fleet/SKILL.md:190-192` to the slice's scope.**
