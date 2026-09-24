# A stop that reports failure does not exit zero

> `/plot-fleet --stop` printed *"supervisor did NOT unload"* and exited 0. The supervisor had in fact unloaded; the check ran before launchd finished, and because the run was recorded as failed the start marker stayed, which made the next `--status` report a crash that never happened.

## Status

- **State:** Approved
- **Type:** bug
- **Review:** in-session
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-24, in-session review after panel (round 1)

## Changelog

- `/plot-fleet --stop` verifies the unload rather than asking once, and exits non-zero when it cannot confirm one. Measured 2026-09-24: a stop of a supervisor whose last tick had run 41 minutes printed `supervisor did NOT unload` and exited 0, while `launchctl print` moments later reported the job gone. A caller reading the exit code recorded that run as a clean stop, and the marker it left behind made the next `--status` announce a crash.

Board impact: **yes**, and the first draft said none. The marker this bug leaves behind feeds a domain rule: `plot-fleetctl.sh:242` makes `install=installed` depend on it, `supervisor-reading.ts` parses that off the `summary:` line, and `supervisorState` maps exit 1 + `installed` to **`died`** — rendered as *FLEET STOPPED UNEXPECTEDLY* at `alert` prominence. The false negative drives a domain state whose whole purpose is to say a supervisor died unexplained.

## Motivation

**A stop is the one fleet action whose result a caller cannot re-derive.** A dispatch can be re-read from the refs, a tick recomputes from scratch, but whether the supervisor is down is a machine fact that decays.

**No caller reads this exit code today, and the first draft implied one did.** A panel searched the estate: zero automated consumers — the board reads `--status`'s exit code, never `--stop`'s, and the skill prints the output rather than gating on it. The exit code is being made correct **ahead of a reader**, which is defensible on its own (`plot-boardctl.sh --stop` already exits 1 on an unconfirmed kill) but is a weaker claim than the draft made.

**The damage that was actually measured flows through the marker, not the exit code** — see Board impact above.

Here the exit code and the printed text disagreed, and **the text was right about the check and wrong about the world**:

```
no agents on a branch; stopping the supervisor
  supervisor did NOT unload — com.plot-pm.registryd is still loaded
exit=0
```

Both halves are defects, and they compound. The stop reported a failure it did not have, then exited as though nothing had gone wrong.

## Design

### What was measured, 2026-09-24

The supervisor **was** unloaded by that call. Immediately after:

```
launchctl print gui/501/com.plot-pm.registryd   -> exit 113 (not loaded)
launchctl list | grep com.plot-pm.registryd     -> 0 matches
kill -0 3260                                    -> gone
pgrep -fl plot-registryd                        -> nothing
```

So `supervisor_loaded` at `plot-fleetctl.sh:763` answered true in the window between `launchctl bootout` returning and launchd finishing the teardown.

### The mechanism is UNDETERMINED, and the fix does not depend on it

The first draft said `bootout` had not finished when `supervisor_loaded` was re-asked. **A panel refuted that as established fact, and the correction is kept here.**

**No reading was taken between `bootout` and the re-check.** The four readings above establish only the end state — the job was gone *afterwards*. The window is inferred, not observed; the distinguishing evidence would have been the pid at `:763`, and it does not exist.

Three candidates fit the same readings:

| Candidate | What would confirm it |
|---|---|
| teardown had not completed | a `launchctl print` capture between the two calls |
| **launchd restarted the job** under `KeepAlive` | a changed pid at the re-check; `runs` incrementing |
| `bootout` failed silently | its exit code — which `:760` discards with `2>/dev/null` |

**The second has already been measured on this estate, in this exact confusion.** `registryd-main.ts:824-827` records a plan refuted for attributing a launchd restart to another mechanism: *"The `runs = 1` reading cited in the original plan was re-measured as `38 -> 39 -> 40` in forty seconds — `KeepAlive` was restarting it."* The first draft reproduced that error one file over.

**The measured 50 ms teardown stands and explains nothing.** Bootstrapping the real unit and polling every 50 ms after `bootout` gave `gone after ~50ms (iteration 1)` — an idle unit. It did not reproduce the failure, and no fix may be sized from it.

**The wedged-tick premise is withdrawn as contradicted by the code.** `registryd-main.ts` registers no signal handler — `grep SIGTERM|SIGINT|process.on` returns nothing — so Node's default disposition terminates at once and a pending `await` does not defer it. `ExitTimeOut` is unset, so launchd's default 20 s SIGTERM→SIGKILL escalation applies: there **is** an upper bound, and the draft said there was none.

### Why a bounded poll is right anyway

**The fix is correct under all three candidates**, which is what licenses building it without settling the mechanism:

- teardown still running → the poll sees it finish
- restarted under `KeepAlive` → still loaded at the bound, correctly reported as unconfirmed
- `bootout` failed → still loaded at the bound, same honest answer

**The bound is 20 s of launchd escalation plus margin**, not an unknown. The existing `--wait` default of 30 s covers it.

### The idiom already exists thirty lines above the bug

`plot-fleetctl.sh:729-734` polls a worker to the same `wait_bound` with the same `sleep 0.5` and the same flag-and-break shape, and `plot-boardctl.sh` uses it twice more. **There is no shared helper — three open-coded copies** — so this slice copies the agent loop's own shape rather than inventing one. The fix is smaller than the draft implied.

### Why the marker must follow the observation, not the attempt

`.plot/state/fleet-start.done` records that a `--start` finished. `--stop` clears it **only after a confirmed unload**, which is correct and stays. The bug is upstream: a false negative on the unload left a marker describing a run that had ended.

`--status` then reasons from the marker's presence to a cause:

```
supervisor: STOPPED — a --start finished here and the supervisor is gone since
  Nothing unloaded it: --stop clears this marker only after a clean unload.
  So it died on its own — a crash, a logout, or an OS update.
```

**That inference is sound and its premise was false.** The prose is not what needs changing — fixing the observation fixes the message.

### What this does NOT do

- **It does not make `--stop` force anything.** A supervisor that will not unload within the bound is reported, not escalated to `kill -9`. Ending a wedged process is a person's call, and the refusal names what to look at.
- **It does not touch the agent loop.** Agents are stopped before the supervisor and that order stays.
- **It does not change `--status`'s prose.** Its reasoning is correct; it was fed a wrong fact.
- **It does not diagnose why a tick took 41 minutes.** That is [`a-supervisor-that-stopped-ticking-is-not-running`](2026-09-24-a-supervisor-that-stopped-ticking-is-not-running.md)'s subject.

### Done when

- `--stop` polls the unload to the `--wait` bound rather than asking once, and a confirmed unload still clears the marker.
- **An unconfirmed unload exits non-zero and keeps the marker.** A test drives both arms.
- A stop of an unloaded supervisor still reports `supervisor was not loaded` and exits 0 — the regression this must not cause.
- The contract suite covers the exit code, because the exit code is what a caller gates on and prose is not.
- **`supervisorState` keeps a unit test pinning that a confirmed unload does not read as `died`.** That rule is where this bug's consequence is implemented, it is already unit-tested, and it is the cheapest place a regression lock can live.
- **`skills/plot-fleet/SKILL.md:191` is amended.** Its sentence *"Exit 1 says at least one did not exit"* is a complete statement of the non-zero contract today, and this plan makes it partial.

## Slices

### The unload is verified to a bound (Branch: bug/the-unload-is-verified-to-a-bound)

- `bug/the-unload-is-verified-to-a-bound` — poll `supervisor_loaded` after `bootout` up to the `--wait` bound; exit non-zero and keep the marker when the bound is reached; tests for the confirmed arm, the unconfirmed arm and the not-loaded arm

## Notes

- Found by running `/plot-fleet --stop` and reading the exit code against the printed text rather than accepting either. The two disagreed, and `launchctl` settled it.
- **The transferable precedent is `plot-boardctl.sh --stop` (`:517-538`), not `--start`.** The draft quoted `CLAUDE.md`'s paraphrase of the script and pointed at the wrong arm: `--start` distrusts a *success* exit code and polls for positive proof, which would have an implementer build the wrong half. `--stop` polls to a bound and exits 1 with the evidence named when the fact still does not hold — the two-arm shape this plan wants, already built one script over.
- **That precedent is adopted in part.** boardctl `--stop` escalates to `KILL` at `:528-532`; this plan refuses escalation, and an implementer must not copy that arm.
