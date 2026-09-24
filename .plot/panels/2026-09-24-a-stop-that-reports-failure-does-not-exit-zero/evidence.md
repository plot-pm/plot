# The evidence lens — a-stop-that-reports-failure-does-not-exit-zero

Position: amend

## What holds

**The defect is established and does not depend on the diagnosis.** `plot-fleetctl.sh:758-776` has one arm — `supervisor_loaded` after `bootout` — and neither branch of it sets a non-zero exit. The run ends at `:783 exit 0` whenever no agent overran its bound. That the printed text and the exit code can disagree is readable from the source; it needs no measurement at all. The plan's headline outcome — **an unconfirmed unload must exit non-zero and keep the marker** — is correct under every candidate explanation below, and that is the strongest thing in the plan.

**The marker reasoning is sound.** `:770-774` clears `.plot/state/fleet-start.done` only on a confirmed unload; `--status` then reasons from its presence to *"nothing unloaded it, so it died on its own"*. The marker is on disk right now, dated `Sep 22 13:31` (`.plot/state/fleet-start.done`), over a label that `launchctl print` answers 113 for. The plan's claim that `--status`'s inference is sound and its premise false is confirmed on the live machine.

**The `plot-boardctl.sh` precedent is real and correctly cited** (line 109 of the plan).

**Both arms are testable without a real unit.** `test/reconcile/fleetctl.test.mjs:727-734` already stubs `launchctl print` to answer 0 or 113 per case. A stub that answers `loaded` forever drives the unconfirmed arm; one that flips after N polls drives the confirmed arm. So "Done when" bullet 2 costs nothing to satisfy. That is a real finding in the plan's favour.

## Where a small sample is written as a property

### 1. The central diagnosis is the most plausible of several, not established — and the plan's own numbers argue against it

Plan `:45`: *"`supervisor_loaded` at `plot-fleetctl.sh:763` answered true in the window between `launchctl bootout` returning and launchd finishing the teardown."*

The four readings at `:38-43` establish only the **end state** — the job was gone *afterwards*. Nothing in them is a reading taken *between* `bootout` and the re-check. The window is inferred, not observed. Distinguishing evidence would have been the pid at `:763`, or a `launchctl print` capture at that instant; neither exists.

**A cheaper explanation fits the same readings better.** `KeepAlive` is `true` and unconditional (plist, and its own comment says so), and `ThrottleInterval` is `60`. If the job was restarted by launchd between the two calls, `supervisor_loaded` answers true for a *live, newly-started* job — not a dying one — and the later readings still show it gone, because the second `bootout`-less run ended some other way or the operator's later measurement followed a real teardown.

**And the repo has already measured exactly this misattribution.** `packages/board/src/server/entry/registryd-main.ts:824-827`:

> THE SUPERVISOR'S DEATHS ON 2026-09-22 WERE NOT THIS. … The `runs = 1` reading cited in the original plan was re-measured as `38 -> 39 -> 40` in forty seconds — **`KeepAlive` was restarting it**, and the label was being taken away underneath.

That paragraph exists because **a delivery panel refuted a plan on this estate for attributing a launchd-restart to a different mechanism**. This plan reproduces the shape of that error one file over, and does not cite the correction.

### 2. The "wedged mid-tick" premise is contradicted by the code

Plan `:58`: *"`bootout` waits for the process to leave, and a process wedged mid-tick does not leave promptly."*

`registryd-main.ts` registers **no signal handler** — `grep` for `SIGTERM|SIGINT|process.on` over that file returns nothing but the unrelated `stop()` at `:808`. Node's default SIGTERM disposition terminates the process at once; it is not deferred by a pending promise. The tick is `await`ed JavaScript (`:836`) reaching git and the host through adapters, not an uninterruptible native section. So a "wedged" tick gives SIGTERM **nothing to wait for**: the process dies on the signal regardless of what it was awaiting.

`ExitTimeOut` is not set in the plist, so launchd's default 20 s SIGTERM→SIGKILL escalation applies — an upper bound the plan says does not exist.

### 3. "No bound this script can know" is asserted, not measured or argued

Plan `:60`: *"the delay scales with how stuck the job is, and has no bound this script can know."*

Neither half is supported. **Scaling**: one data point at ~50 ms (idle) and one inferred non-observation (the failure) is not a relationship; nothing was measured at intermediate stuckness, and §2 gives a mechanism under which tick duration and teardown latency are independent. **No bound**: launchd's SIGTERM→SIGKILL default is a bound, and this plist does not raise it.

This is the estate's named author error — *one outlier for a distribution* — applied to a sample of one.

### 4. The unreproduced mechanism is then relied on anyway

Plan `:56` states honestly that the 50 ms measurement did not reproduce the failure. But `:60` uses the unreproduced mechanism to **rule out a sleep and select a retry**, and §"The shape of the fix" `:64-68` adopts that selection wholesale. The honesty at `:56` is real; it is spent at `:60`. The fix is chosen by an argument the plan has just said it could not reproduce.

### 5. Four candidates the plan does not separate

| candidate | fits the four readings? | separated by the plan? |
|---|---|---|
| slow teardown (the plan's) | yes | — |
| **KeepAlive restart between the two calls** | yes | **no** — and precedented at `registryd-main.ts:824` |
| bootout returned non-zero / silently failed | yes — stderr is `2>/dev/null` at `:760`, and the exit code is **never read** | **no** |
| launchd answering from cache | yes | no |
| a second unit on the same label | no (plist comment forbids it; `launchctl list` shows none) | n/a — ruled out |

The third is worth naming: `:760` discards both `bootout`'s stderr and its exit status. If `bootout` failed, the plan's whole window story is vacuous and the one-line fix is *read the exit code*.

### 6. A second, smaller evidence slip

The trailing line of `.plot/logs/registryd.log` is a fresh `plot-registryd: supervising …` startup banner written **after** the `cost=2478705ms` tick, and the file's mtime is now `Sep 24 12:13`, not the `Sep 23 11:01` the sibling plan records. The sibling plan (`a-supervisor-that-stopped-ticking-is-not-running`) discloses this: the unit was bootstrapped on 2026-09-24 to take this plan's own bootout timing. **This plan does not disclose it.** Its `:49-54` measurement ran against a unit whose state on disk the reader cannot now reconstruct, and the reader is not told.

### 7. `--wait` is reused with a changed meaning, silently

`:28` of the script documents `--wait S` as *"seconds to wait for **one worker** to exit (default 30)"*, and `:730` applies it per branch. The plan `:65` reuses it as the supervisor bound without saying the flag now bounds two different things. Default 30 s against a 20 s SIGKILL escalation happens to be adequate, but the plan should say so rather than leave it to coincidence.

## What to amend

Three changes, none of which touch the outcome:

1. **Rewrite the diagnosis as unresolved, and make the fix correct under all candidates.** Do not claim the window is established. State the four candidates. Then the fix follows from *the observation is unconfirmed*, not from *teardown is slow* — which is the same fix, better licensed.

2. **Read `bootout`'s exit code and stderr** (`:760` currently discards both), and print them in the unconfirmed arm. This costs two lines, distinguishes candidate 3 from the rest, and turns the next occurrence into evidence instead of another inference. Without it the retry hides a failed `bootout` behind a bound.

3. **Name the KeepAlive-restart candidate explicitly and say the retry does not fix it.** If launchd is restarting the job, a poll to 30 s reports *still loaded* correctly and exits non-zero — the right answer for the wrong reason, and the operator is sent to look at a wedged process that is actually a healthy restart. Recording the pid across the poll separates them in one field: **a changed pid is a restart, an unchanged one is a teardown.** That reading is free and it is the discriminator the plan is missing.

Add to "Done when": *the unconfirmed arm names `bootout`'s exit code and whether the pid changed across the bound.*

## Smaller notes

- Delete or qualify `:60` (*"no bound this script can know"*) — `ExitTimeOut` defaults to 20 s and the plist does not raise it.
- `:58`'s "`bootout` waits for the process to leave" needs the caveat that this daemon installs no signal handler, so SIGTERM is not deferred by a long tick.
- Disclose at `:49` that the timing measurement bootstrapped the production unit, as the sibling plan does.
- State that `--wait` now bounds two distinct things, or give the supervisor its own bound.
