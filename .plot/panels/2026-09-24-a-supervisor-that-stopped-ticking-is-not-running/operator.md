# Operator lens — a supervisor that stopped ticking is not running

Position: amend

## The amendment, stated first

Add a second slice: **carry the tick age to the board.** The board already asks this exact script every refresh, already renders a supervisor banner with four states and an `alert` prominence, and is already the surface the 2026-09-09 measurement proved an operator reads. A `--status` line alone puts the fix on the one surface nobody visited the night three agents timed out.

Concretely, the plan's slice is correct and should ship as written. What it must not do is ship alone and be called done.

## What I looked at

- `skills/plot/scripts/plot-fleetctl.sh:356` — the `running` arm, the branch that printed the lie.
- `skills/plot/scripts/plot-fleetctl.sh:374-386` — the `LOADED, NOT RUNNING` arm that already reads `.plot/logs/registryd.log` mtime and prints it as evidence.
- `skills/plot/scripts/plot-fleetctl.sh:484-490` — the `summary:` line and the `sup_word=up` / `exit 0` decision.
- `packages/board/src/server/supervisor-reading.ts` — `readSupervisor` spawns `plot-fleetctl.sh --status` once per refresh, bounded at 5 s, and parses exactly two things: the exit code and `install=` off the `summary:` line.
- `packages/domain/src/rules/supervisor-reading.ts` — `supervisorState`, `supervisorProminence`, `supervisorVerdict`.
- `packages/board/src/app/components/FleetControls.tsx:354` — `FleetAlert`, rendered from `AgentList.tsx:1178` at the top of the WORKING section.
- `skills/plot-fleet/SKILL.md:39, 97-101` — the documented `--status` workflow.
- `skills/plot/scripts/plot-worker-loop.sh:1888` — the agent's eight-hour timeout message.

## THE HARM: would the fix have surfaced it?

No, on the path it actually took. The plan's own Notes line says so: *"Found by reading `.plot/logs/registryd.log` after a `--stop` that behaved oddly, rather than by noticing the fleet was idle."* Nobody ran `--status` that night. Adding a line to the output of a command nobody runs changes nothing about the night it describes.

Who runs `--status`, and when? Reading `skills/plot-fleet/SKILL.md`, the documented workflow directs a person to it in exactly one place — **step 2, "Ask before starting"** (`:97`). That is a person who has already decided to start a fleet. They are not the person who needs this: the fleet they are about to start is, by their own assumption, not running. Nowhere in the skill is `--status` offered as *check whether what is running is healthy*. Step 5's `--stop` does not call it. There is no periodic invocation documented at all.

So the human path is: an operator suspects something, types `--status`, and now reads one more number. That is real and it is small.

**But there is a second caller, and the plan does not mention it.** `packages/board/src/server/supervisor-reading.ts` runs `plot-fleetctl.sh --status` **once per board refresh, automatically, forever**. That is the path where the operator learns without asking. The plan treats `--status` as a command a person types; it is also a machine-read API with a live consumer, and that consumer is the fix's whole value.

## The board is the surface, and it is already built for this

The infrastructure the plan needs already exists and is fully reasoned:

- `SupervisorState` has four members and `died` was added specifically for *started here, gone, nothing stopped it* (`packages/domain/src/rules/supervisor-reading.ts`).
- `supervisorProminence` returns `alert` for a dead supervisor with agents running, and the header records exactly why: on 2026-09-09 the right sentence in a grey chip was read for an hour and not acted on. Weight was the fix.
- `supervisorVerdict`'s `died` arm prints *"FLEET STOPPED UNEXPECTEDLY"* and routes the reader to the log rather than to `--start`.
- `FleetAlert` (`FleetControls.tsx:354`) renders it with `role="alert"` at the top of WORKING.

**And every one of those is unreachable in the measured failure.** The supervisor held a pid, so `install_state=running`, so `sup_word=up`, so `exit 0` (`plot-fleetctl.sh:484-490`). `supervisorState` returns `up`. `supervisorVerdict` returns `shown: false`. The board renders **nothing**, all night, while three agents starve.

This is the same defect the estate already fixed once. `supervisor-reading.ts`'s own header records the 2026-09-07 case: *"the board showed six rows that looked exactly like six healthy ones, because it carried no supervisor field at all."* This is that, one arm over: the board shows a healthy fleet because the script tells it the fleet is healthy.

The plan's Changelog says **"Board impact: none."** That is factually wrong about the estate as it stands. The board is a consumer of this script's output, and the plan changes the output of the one arm the board's `up` verdict comes from. The correct statement is *board impact: none in this slice, and the board is where the reading belongs.*

## Is the restraint principled, or avoiding the hard part?

The restraint against a **threshold** is principled and I would not overturn it. 49 s ticks are measured here, and the plan's argument — a threshold safe for a busy estate would not have caught 25 hours sooner than a person reading the number — holds.

The restraint against **the number reaching the board** is not principled; it is unexamined. The plan never considers it. And notice that the board does not need a threshold either: `supervisorProminence` already combines the state with a live agent count, which is precisely the composition the plan says a bare threshold cannot do. *Tick age 90061 s while three agents run* is not a threshold judgement — it is the same shape as the `alert` rule already shipped.

Put me at 2am with the plan as written. `last tick: 90061s ago (evidence, not the verdict — a busy tick writes at most every 60s)` sits in a dump that already contains `platform:`, `supervisor:`, a line per worktree, and a `summary:` with five fields. It reads as one more number. The parenthetical actively softens it — it tells me not to conclude anything. I would have to divide 90061 by 3600 myself and notice it is 25 hours. A tired person does not.

That is survivable **because the number's real reader is the board**, which can do the arithmetic and the weighting. As a line for a human alone it is weak, and that weakness is the argument for the second slice, not against the first.

## The cheaper earlier signal

The agent's eight-hour message (`plot-worker-loop.sh:1888`) is the fleet telling somebody eight hours late. The loop does print an opening line when a wait starts (`:1866-1873`) — *"free on X — nothing handed over yet ... for up to 28800s"* — so the wait is announced, once, to a per-worktree log file nobody tails.

I considered recommending a mid-wait signal. I do not, for this plan:

- The board already carries the raw material. `plot-fleetctl.sh:453-461` computes each running worker's quiet time from `.plot-worker.log` mtime, and the schema carries `worker_activity` (`schema.ts:2911`). A free agent waiting eight hours is a visible fact on a surface that exists.
- More importantly, it fixes the wrong subject. A free agent waiting is **normal** — a queue longer than the pool is the documented ordinary case. Three agents waiting is only a symptom because the supervisor died. Alarming on the symptom trains the reader to dismiss the ordinary case. The plan's `## What this does NOT do` is right: *"Eight hours of waiting was correct behaviour given no work was offered."*

So: correct subject, wrong reach.

## What is right about the plan

Saying so plainly, because it is a real finding:

- The diagnosis is exact. `plot-fleetctl.sh:356` decides `running` from label + pid and the tick age sits eighteen lines below in a branch a live pid can never reach. That is the defect, precisely located.
- Refusing a heartbeat file is correct and the citation (`supervisor.ts:49`) is the right one. The daemon's statelessness is measured, not asserted.
- Keeping `summary: supervisor=up` is correct and is the thing that must not regress. It is a wire contract with a live parser (`supervisor-reading.ts`'s `SUMMARY_PREFIX` and `INSTALL_PREFIX`), and the `## Done when` names it as the regression to avoid. Good.
- The evidence is properly dated and its own erosion is disclosed (the mtime note at `:52`). That is honest reporting of a measurement that cannot be re-taken.
- The scope refusals are disciplined — no restart, no threshold, no explanation of the 41-minute tick, no touching the bound.

## What the amendment should say

1. Correct the Changelog line. `Board impact: none` → state that the board reads this script's `--status` every refresh via `packages/board/src/server/supervisor-reading.ts`, that a live-pid stalled supervisor currently renders as `up`/`shown: false`, and that this slice does not change that.
2. Add a second slice, sequenced after the first: carry the tick age from the `summary:` line (appended `key=value`, which the existing comment at `plot-fleetctl.sh:466-471` explicitly says cannot break the substring test) into `SupervisorRun`, and let `supervisorProminence`/`supervisorVerdict` combine it with the agent count. Whether that produces a fifth state, a refinement of `up`, or a `warn` — the level the domain reserved and nothing currently produces (`supervisor-reading.ts`, `SupervisorProminence`) — is that slice's design question, not this one's.
3. Promote the Open Question about `--once` to the second slice or drop it. It is a third caller of a reading with two.

Ship slice one. Do not let the plan close on it.
