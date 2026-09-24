# Evidence lens — a-supervisor-that-stopped-ticking-is-not-running

Position: amend

## The headline reading survives. The causal claim does not.

I can no longer reproduce the 25-hour mtime (the file now reads `Sep 24 12:13:22`), and the plan says so in its own block quote. That disclosure is honest and the reading is corroborated by what the file still holds: `.plot/logs/registryd.log` ends at line 3885 with `cost=2478705ms`, and the eight ticks before it are `13364 49305 28947 48257 18802 48871 19688` ms — exactly the seven numbers the plan prints, in order, at lines 3853–3881. The last tick printed its full counts and its `held on not-claimable (619):` block, then the file ends with a bare `plot-registryd: supervising …` restart banner. So *the tick completed and nothing followed* is established from the surviving file, not from the lost mtime. **That half of the plan is sound.**

## The harm claim is refuted, not merely unestablished

The plan's Motivation, Changelog and headline all assert the three agents timed out **because** the supervisor had stopped. The log refutes this.

Timeline, from the artefacts:

- `.worktrees/free-{5f5f7b27,8d8901a7,b9153568}/.plot-worker.pid` — all written `Sep 23 14:10`.
- All three `.plot-worker.log` files record the wait bound expiring, and their monitor lines stamp `2026-09-23T20:11:2{1,2}Z` = 22:11 local. 14:10 → 22:11 is 8h01m: the full 28800 s bound, **elapsed exactly on schedule**.
- The supervisor's last log line is *later still* (its mtime sat at Sep 23 11:01 before the reset — i.e. **before** the agents even started at 14:10, on the plan's own reading).

That last point is the problem. If the log truly went silent at 11:01 on the 23rd, the supervisor had already stopped **three hours before the three agents were created at 14:10**. A daemon that stopped before the agents existed cannot be the thing that stopped handing *them* work — they were never in a world where it was ticking. The plan's own two measurements are mutually inconsistent as a causal story.

And the log shows the supervisor did see them. 547 ticks read `agents=3 … idle=3` — three registered agents, all three idle, all three visible to the supervisor. **All 547 handed nothing.** Not one is `no-free-agent`; the field is `no-free-agent=0` on 986 of 987 ticks. A live, healthy, on-cadence supervisor looked at three free agents 547 times and handed out zero slices.

## Because there was nothing to hand out

The decomposition is exact. On all 987 ticks, `held − not-claimable − no-brief − no-free-agent == 0` (verified arithmetically across every tick). Every held slice on this estate is held for `not-claimable`, plus exactly one for `no-brief` (`feature/the-controller-records-it`). Across the whole log:

- `handed=1` on **3** ticks; `handed=0` on **984**.
- The last hand-over is at **line 205** of 3889 — roughly 5% into the file. Nothing has been handed over since, across ~780 subsequent ticks.
- `not-claimable` sits at 260–265 for almost the entire run, rising to 619–620 at the end.

So the counterfactual the plan needs — *had the supervisor kept ticking, the three agents would have received work* — is false on the record. It kept ticking through 547 observations of those exact agents and offered them nothing, because on this estate **nothing has been claimable since line 205**. The agents would have burned their eight hours and exited 124 whether the supervisor ticked or not. This is the panel's named author error in its purest form: one incident (a stale log) and one coincident outcome (three timeouts) welded into a causal claim that the log itself disproves.

## The 41-minute tick is the same defect, and splitting it is wrong

The plan calls the slow tick "a lead and not a finding" and offers the estate doubling (`held=267 → held=620`) as the explanation. The restraint is misplaced, and the doubling does not explain it.

Six ticks exceed 120 s in this file (lines 38, 42, 1030, 3752, 3756, 3797, 3885): `128528`, `1738815`, `954668`, `2008832`, `1290881`, `1531014`, `2478705` ms. Against p50 = 10370 ms and p95 = 27954 ms over 987 ticks, these are 100–240× the median. Crucially **line 42 is `cost=1738815ms` at `held=614`** — a 29-minute tick that happened early, and line 1030 is a 16-minute tick. So multi-minute ticks recur at both `held=614` and `held=620`, and the 128 s outlier at line 38 occurred at `held=261`, the *low* estate size. Estate size does not separate the fast ticks from the slow ones; the plan's lead is not supported by its own file.

What these have in common is that the tick interval is 60 s and these ticks run 16–41 minutes. The supervisor waits the interval *after* a tick, so a 41-minute tick **is** a 41-minute silence in the log. The plan's subject is "a supervisor that stopped ticking", and here is a mechanism, already in the file, that produces exactly that with the daemon alive and holding its pid — and the final line of the log is one of these. The 25-hour gap and the 41-minute tick are not two subjects. They are the same subject at two magnitudes, and the plan has split off the half that contains the cause.

## Would the fix have prevented the harm?

No — and the plan does not claim it would, which is to its credit, but the Motivation frames the three timeouts as the cost the fix addresses. Trace it:

1. Nobody ran `--status` during the incident. The plan's own Notes say the defect was "found by reading `.plot/logs/registryd.log` after a `--stop` that behaved oddly, rather than by noticing the fleet was idle". The reading that mattered was of the log, not of `--status`.
2. Had an operator run `--status` and seen `last tick: 90061s ago`, the three agents would still have received nothing, because nothing was claimable.
3. A passive line on a command nobody ran cannot prevent an outcome nobody was watching for.

This fixes the **observation** and the plan's Design section is honest about being about "the silence being visible". The Motivation and Changelog are not. They sell the fix on a harm it would not have prevented and did not cause.

## On refusing a threshold

Here the plan is right, and I want to say so plainly rather than manufacture a complaint. `plot-fleetctl.sh:374`'s existing arm already prints the age as evidence with the same caveat, ticks of 49 s are measured here, and — decisively — ticks of **41 minutes** are measured here too. Any threshold safe against a 41-minute legitimate tick would have to sit above 41 minutes, and would then have said nothing useful about a 25-hour gap that a human reading "90061s" grasps instantly. The number without a verdict is the correct shape. Symmetry with the sibling arm is a real argument and it holds.

The "operator must compare against a mental model" objection is answered by the caveat text itself, which states the 60 s cadence inline. That is the model, printed next to the number.

## What to amend

The slice is a four-line change to a status arm, reusing a reading that already exists one branch away, with `summary:` unchanged. It is cheap, correct, and symmetric with `:374`. **Build it.** What must change is the plan's evidence, because this repo's standard is that a plan's stated measurement is true:

1. **Strike the causal claim.** The Changelog's "Three free agents timed out at their eight-hour bound waiting for hand-overs from it" and the Motivation's "The fact that no work arrived **because the supervisor had stopped**" must go. Replace with the measurement: three agents timed out having been offered nothing, and the log shows 547 ticks with `agents=3 idle=3 handed=0`, the last hand-over at line 205 of 3889. The timeouts are concurrent with the silence, not caused by it — and the 14:10 start against an 11:01 last-write makes the stated causation chronologically impossible.
2. **Say that nothing was claimable.** `held − not-claimable − no-brief − no-free-agent == 0` on all 987 ticks; `no-free-agent=0` on 986 of 987. A supervisor that never lacked a free agent and never had a claimable slice is the estate's actual state, and the plan should record it — it is the finding that makes the fix modest rather than urgent, which is the honest framing.
3. **Fix the slow-tick paragraph or drop the claim.** Either withdraw "the estate roughly doubling is a lead" — line 38 is 128 s at `held=261` and line 42 is 29 minutes at `held=614`, so size does not separate them — or state the real relationship: a 16–41 minute tick with a 60 s interval *is* a multi-minute silence with the pid held, which is this plan's subject, and the last line of the log is one. I would keep the fix in this plan and file the slow tick as a sibling that cites this file's seven outliers, rather than dismissing it as a lead.
4. **Re-aim the Motivation** at what the fix does: make a silent supervisor visible to whoever runs `--status`. Drop the three timeouts as its cost, since the fix would not have changed them.

The `Done when` list, the heartbeat-file refusal (`supervisor.ts:49` is quoted accurately), the `summary: supervisor=up` regression guard, and the no-threshold decision all stand as written.
