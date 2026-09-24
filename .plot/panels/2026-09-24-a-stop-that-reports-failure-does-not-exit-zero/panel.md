# Panel moderation — a stop that reports failure does not exit zero

**Reconciliation: `unanimous amend` — estate, contracts, evidence, manifesto.**

Four jurors, four commitments, no hedges. Nobody says reject: **the defect is real and readable from the source without any measurement** — `plot-fleetctl.sh:758-776` has one arm, neither branch sets a non-zero exit, and the run ends at `exit 0`. What every juror disputes is the plan's *explanation* and its *scope*.

## Where the jurors agree

**The outcome is right under every candidate explanation.** The evidence lens states it plainly: an unconfirmed unload must exit non-zero and keep the marker, and that holds whatever caused the false negative. Estate confirms every line reference resolves. Nobody proposes changing the fix's shape.

## The four amendments, in the order they cost

### 1. The diagnosis reproduces an error this repo already corrected — evidence

The plan says `supervisor_loaded` answered true in the teardown window. **No reading was taken between `bootout` and the re-check**; the four readings establish only the end state. `KeepAlive` is unconditional and `ThrottleInterval` is 60, so launchd restarting the job between the two calls fits the same readings.

**And the estate has measured this exact misattribution before.** `registryd-main.ts:824-827`:

> THE SUPERVISOR'S DEATHS ON 2026-09-22 WERE NOT THIS. … The `runs = 1` reading cited in the original plan was re-measured as `38 -> 39 -> 40` in forty seconds — **`KeepAlive` was restarting it**.

That paragraph exists because a panel refuted a plan for attributing a launchd restart to another mechanism. This plan reproduces the shape one file over and does not cite the correction.

**Verified by the moderator**: the comment is at those lines and says that.

### 2. The "wedged mid-tick" premise is contradicted by the code — evidence

`registryd-main.ts` registers **no signal handler** — `grep SIGTERM|SIGINT|process.on` returns nothing. Node's default disposition terminates at once; a pending `await` does not defer it. So a wedged tick gives SIGTERM nothing to wait for. `ExitTimeOut` is unset, so launchd's default 20 s SIGTERM→SIGKILL escalation applies — **an upper bound the plan says does not exist**.

**Verified by the moderator**: the grep returns nothing.

### 3. `Board impact: none` is false — manifesto

The marker feeds a domain rule. `fleetctl.sh:242` makes `install=installed` depend on the marker; `supervisor-reading.ts` parses it; `supervisorState` maps exit 1 + `installed` to **`died`**, rendered as *FLEET STOPPED UNEXPECTEDLY* at `alert` prominence.

So the false negative does not merely mislead prose — **it drives a domain state whose whole purpose is to say a supervisor died unexplained.** The plan reaches that diagnosis and misses the rule implementing it, and budgets no test there, where a regression lock is cheapest.

**Verified by the moderator**: `died` is a documented state in that rule.

### 4. Two contract gaps — contracts

- **No caller reads `--stop`'s exit code today.** Zero automated consumers; the board reads `--status`'s only. The Motivation's *"a caller … recorded that run as a clean stop"* names a caller that does not exist. The real damage flows through the marker.
- **The second non-zero path is unnamed.** `exit 1` today means *an agent did not exit*, and `SKILL.md:191` promises exactly that. Reusing 1 makes that sentence false and loses information when both conditions hold. Name a distinct code and amend the skill.

## Where a juror overreached

**Estate calls the boardctl citation wrong; it is imprecise rather than wrong.** The quoted sentence is `CLAUDE.md`'s paraphrase, and the transferable arm is boardctl `--stop` (`:517-538`), not `--start`. The correction is worth making — an implementer following `--start` would build a positive-proof poll instead of the refuse-and-exit arm — but the precedent itself stands.

## What the moderator does not average

Estate reports the poll idiom already exists **thirty lines above the bug**, in the same function, and that there is no shared helper — three open-coded copies. That makes the fix smaller than the plan implies. It is a strengthening, not an objection, and no juror contradicts it.

## The disposition

**Amend before building.** The fix survives every objection; the reasoning does not. Specifically: state the mechanism as undetermined and name the candidates, drop the wedged-tick premise, correct `Board impact`, restate the Motivation on evidence, and name the exit code.
