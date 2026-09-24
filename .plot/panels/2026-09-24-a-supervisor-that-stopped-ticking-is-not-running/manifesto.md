# Manifesto lens — a-supervisor-that-stopped-ticking-is-not-running

Position: amend

## The amendment, in one sentence

The plan adds the tick age to `--status`'s prose only. The board renders the supervisor from that same script and `rules/supervisor-reading.ts` already names the exact failure this plan describes; the plan must state whether the board is in scope and, if it is not, say so in "What this does NOT do" with the reason — because "Board impact: none" is the one factual claim in the plan I could not verify.

Everything else passes. The mechanism, the caveat, the heartbeat refusal and the scope are correct.

## The 9-question checklist

1. **Keeps planning in git / no external dependency** — PASS, trivially. Nothing is stored; the reading is a `stat` on a log the daemon already writes. Principle 4's *"derived, never stored"* is honoured exactly.
2. **Project-agnostic** — PASS. `plot-fleetctl.sh:378` builds `tick_log` from `$repo_root`; the new arm reuses that. No hardcoded path or name.
3. **Fails gracefully** — PASS, and it is stated in *Done when*: "A missing log file prints no line rather than a zero." That matches `:379`'s existing `if [ -f "$tick_log" ]`. Q3 also asks about unexpected state: `stat -f %m || stat -c %Y || echo "$now"` at `:381` degrades to `0s ago` on a platform with neither, which is odd but pre-existing and reused rather than introduced.
4. **Convention opted into, not enforced** — PASS. `--status` is read by an operator who asked.
5. **Would removing it make the system simpler without losing something essential?** — NO, and this is the strongest pass. The reading already exists at `:377-383`; the plan moves nothing and adds no mechanism. It is `if [ -f ]` in one more arm. Three agents burned 8 h each for want of it.
6. **Could a human execute it manually?** — PASS, and the plan's own Notes prove it: the defect was found by a human running `stat` on the log.
7. **Could a smaller model follow the mechanical part?** — PASS. Copy a five-line block into the sibling arm.
8. **Scheduling, not effort tracking** — N/A. This is fleet observability, not plan scheduling. Q8 does not reach it.
9. **Ceremony scaling with weight** — PASS. One slice, one branch, `Review: in-session`, `Impl: own branches`. Principle 10's *lightest allowed path* for a five-line bug fix.

No question fails. Q8 does not apply.

## Design split — verified, no interpretation smuggled

Principle 3's line is *"skills interpret and adapt; scripts collect and report."* The plan adds `last tick: Ns ago` to a script and explicitly refuses a threshold. That is collect-and-report in its purest form.

I checked the caveat wording for smuggled interpretation and found none: `(evidence, not the verdict — a busy tick writes at most every 60s)` is copied verbatim from `plot-fleetctl.sh:383`. It states the mechanism's own period, which is a fact about the daemon, not a judgement about this reading. A caveat saying "possibly stale" or "may indicate a stall" would be the smuggled verdict; this one is not.

The plan also protects the machine-readable contract correctly. `summary:` at `:485` carries `supervisor=$sup_word install=$install_state`, and `packages/board/src/server/supervisor-reading.ts:84` parses `install=`. Keeping `supervisor=up` (Design §"`summary:` keeps `supervisor=up`") is not a nicety — changing it would silently retarget `supervisorVerdict`'s `died` refinement, which is reached from exit 1 plus `installed`/`loaded-not-running` only. The plan names this as "the regression this must not cause" in *Done when*. Correct.

## Gates over rules — the plan is right to add no gate

CLAUDE.md's test is: *can you answer "did I complete this?" without doing the work?* Applied to the plan's own deliverable, the answer is no — the `Done when` list names four assertions a test either makes or does not, and the last bullet commits to writing that test. A gate on the plan's own completion already exists.

Applied to the operator's reading, the gate question would be "should a stale tick refuse something?" — and the answer is no, because there is nothing to refuse. `--status` performs no action; the plan's own first NOT-bullet says so, and that property is what lets it report an absence at all. A gate needs an action to stop.

The counter-argument in Design §"The shape of the fix" is measured and holds: this repo records ticks of 13364–49305 ms (plan line 47), so a 60 s threshold fires on a healthy busy estate, and a threshold generous enough to be safe — say an hour — would not have caught 25 hours "any sooner than a person reading the number." I accept that. A threshold here is a gate that would be turned off, which is the shape CLAUDE.md's `a-merged-pr-carried-work` line warns against.

One honest limit, and it is a rule not a gate: nothing makes an operator run `--status`. The plan does not claim otherwise; Principle 13 (*an agent that has gone quiet has failed*) would want the fleet to volunteer this, and that is the board's job — see below.

## The heartbeat refusal — quote verified, applied correctly

The plan cites `supervisor.ts:49`. **The file is `packages/board/src/server/supervisor.ts` and the line is 48**, not 49 — a one-line drift worth fixing in the plan text. The quote itself is exact:

> A memo that outlived the tick would make the daemon hold state, which is the one property this design does not have. This is where a world drops it, so `kill -9` still costs one tick and nothing else.

The application is correct, and the distinction from a log mtime is real rather than verbal. Three differences, each load-bearing:

- **Direction.** `beginTick?()` is the world's per-tick memo *the supervisor reads*. A heartbeat is a record *the supervisor maintains for a reader*, with a write the tick must not skip. The log write is already unconditional and already happens.
- **Contract.** A heartbeat file has a format, a location and a staleness meaning that two components must agree on — `plot-boardctl.sh:83`'s reason (a machine-local record) plus a new schema. The log has none; `stat` needs no agreement.
- **Failure mode.** A heartbeat that stops being written while the daemon lives is a new lie. The log mtime cannot lie in that direction: the daemon writes the log *because* it ticked.

CLAUDE.md's *"a second store of who-has-what is precisely the drift Principle 1 exists to prevent"* (Principle 4) is the same argument one level up, and the plan is on the right side of it.

## Every rendered state is a domain property — this is the amendment

The reading applies, and the plan does not answer it.

`packages/domain/src/rules/supervisor-reading.ts` exists. It reads `plot-fleetctl.sh --status`'s exit code and its `install=` field, derives `SupervisorState` (`up`/`down`/`unknown`/`died`), a `SupervisorProminence`, and a `SupervisorVerdict` the board renders. Its header names the defect this plan is a sibling of:

> `plot-fleetctl.sh --status` reported `supervisor=down` while six workers ran 23–25 hours against an 8-hour `Worker bound`. ... the board showed six rows that looked exactly like six healthy ones, because it carried no supervisor field at all.

And its `SupervisorProminence` doc names an empty slot that fits this plan's shape exactly:

> `warn` — a chip's worth of concern. **No supervisor reading produces it today**; it stays because prominence is a scale and the level between a note and an alert is a real one a later state may need.

So: the estate has a domain rule for how loudly to say what the supervisor is, an unused level between `note` and `alert`, and a measured failure — "running, 25 h silent, three agents starved" — that is exactly a `warn`.

**I am not asking the plan to build that.** Two reasons it should stay out:

- A `warn` needs a threshold, and the plan's threshold argument (49 s ticks measured) refutes a threshold here as soundly on the board as in the shell. Extracting the state would force the judgement the plan correctly refuses.
- The `--status` prose line is genuinely outside the rule's scope. That rule governs *rendered* states — what a `.tsx` draws. A line of shell output read by a person in a terminal is not a rendered view state, and there is no `.tsx` re-deriving it.

**What I am asking for is one sentence of scope.** The plan says "Board impact: none. The reading is `--status`'s own output; no plan field, template or board payload changes." The payload claim is true — I verified `install=` is the only parsed field and it is unchanged. But "Board impact: none" reads as *the board has no stake in this*, and the board does: it renders supervisor state from this script, from a rule that names this failure mode and holds an unused level for it. A later reader of this plan will not find that out.

Amend the "What this does NOT do" section with a fifth bullet, along these lines:

> **It does not reach the board.** `rules/supervisor-reading.ts` derives the board's supervisor state from this script's exit code and `install=` field, both unchanged here, and its `warn` prominence — the level between a note and an alert, produced by no reading today — is where a board-side staleness signal would go. It is left unbuilt deliberately: a rendered state needs a threshold, and the measurement above (ticks of 13–49 s) refutes one on the board for the same reason it refutes one here. A person reading a number is the only thing that works at this precision, and `--status` is where a person reads.

That converts an unexamined claim into an argued exclusion, which is what the rest of this plan does everywhere else.

## "What this does NOT do" — otherwise correctly scoped

The four existing bullets each disclaim something genuinely separate, and none disclaims something the plan must handle:

- *does not restart anything* — correct, and it is the property that licenses the whole thing.
- *does not judge* — this is the Gates-over-Rules position, argued above, and it is right.
- *does not explain the 41-minute tick* — correct to exclude. `held=267` → `held=620` is a lead. A plan that tried to explain the slow tick and make the silence visible would be two plans, and the second would block on the first.
- *does not touch the agent bound* — correct. 8 h of waiting with no offer is the bound working.

The Open Question about `--once` is properly deferred: it is a second caller, named as such, and the plan does not pretend to have decided it.

## One smaller note

*Done when* asks for "A test drives a running supervisor with a stale log and asserts the line, and one with no log asserting its absence." Worth knowing while building: `test/reconcile/fleetctl.test.mjs` has 38 tests and **none of them asserts the tick-age line in the existing `loaded-not-running` arm** — I grepped for `last tick` and got nothing. So the plan's test is the first coverage of this reading anywhere, on either arm. That is a small bonus rather than a problem, and the sandbox helpers the new test needs (`sandbox`, `fakeHome`, `installState`, the `{ loaded: true, pid: ... }` stub at `:558`) already exist and already drive the `running` arm at `:545`.
