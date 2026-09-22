# Panel moderation — a test must not stop the fleet

**Subject:** `docs/plans/2026-09-22-a-test-must-not-stop-the-fleet.md`
**Reconciliation:** `unanimous amend` — evidence, fix-shape, blast-radius. **3 of 3 gated.**

## The refutation attempt failed, and it failed by execution

The evidence lens was briefed to destroy the central claim. Its own words:

> **My brief was to REFUTE the central claim. I could not.** I loaded a decoy under the production label and the suite booted it out, **twice, independently, green.**

It backed up the real plist first (`shasum 8976376a…`), bootstrapped a decoy under `com.plot-pm.registryd` pointing at `/bin/sleep 3600`, ran the suite, and the decoy was gone. **That converts the plan's timestamp correlation into a proof.**

**Confirmed after the fix, in this session:** the same decoy now survives, and the real plist's checksum is unchanged.

## The unanimous finding: the plan picked the weaker of two mechanisms

All three lenses arrived at the same amendment from different directions.

> The fix picks the weaker of two mechanisms while the stronger one sits unused **in the same file.**

**A required label closes ONE direction** — a call that unloads the operator's unit. It cannot close the other: a sandbox plist **bootstrapped** under the production label occupies it, and that has already taken a supervisor down once on this machine. An operator cannot distinguish them; both present as a supervisor that is not there.

**A stubbed `launchctl` on `PATH` can do neither.** One seam closes both, and it sees a wrong-but-present label where an unset-check cannot.

`stubPlatform` already mints such a bin for two cases. The fix applies it to every case.

## What each lens added

| lens | its own finding |
|---|---|
| **evidence** | The proof, by decoy. And the count: **9 of 21**, not 7 of 22 — *"a plan whose argument is that a header's count was false must get its own right"* |
| **fix-shape** | The PATH-over-label argument, and the scope split: the leak's **capability** belongs here, its **disk cleanup** may be deferred |
| **blast-radius** | **`fleetctl.test.mjs` is the only offender** — `boardctl.test.mjs` passes `--port` at all six `--stop` sites, `workerloop.test.mjs` is unique by construction, e2e reaches no launchctl. But the guard sits in one file where no other suite inherits it |

**The blast-radius result is the reassuring one**: the estate is otherwise disciplined, and this file was the exception rather than the pattern.

## What was built

The amendment was implemented before this moderation was written, and measured:

1. `sandbox()` mints a `guardBin` with stub `launchctl` (exit 113) and `systemctl` (exit 3) — the real codes, so the arms under test see what they would see.
2. `run()` takes it as a **required argument and throws without it**. The header's *"never unloads anything"* was a rule for the file's whole life; a throw cannot be talked past.
3. All 21 call sites pass it. The two `stubPlatform` cases still override `PATH` deliberately, to drive a loaded launchd — stubs too, so the guarantee holds.
4. The header is corrected: it documented behaviour the file did not have.

**35 tests pass. The decoy survives. The real plist is untouched.**

## What stays open

- **The 2822 leaked directories** and an `after()` teardown — housekeeping, deferred with the panel's agreement. The *capability* to leak a unit is closed.
- **CI cannot observe this.** `ubuntu-latest` has no launchd. The PATH gate partly repairs it by driving the real arm on Linux.
