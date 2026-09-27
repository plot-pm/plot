# Evidence lens — one-answer-to-is-a-worker-running

Position: amend
Evidence: executed

Reviewed against the **round-1 amended** plan (the file changed on disk mid-review; findings below are re-measured against the amended text, and where the amendment already concedes a first-draft finding of mine I say so rather than re-litigating it).

## 1. Is the defect real? Did you reproduce the disagreement?

**The defect is real. I reproduced the headline transcript exactly. The amended plan's mechanism for it is false.**

Fixture: sandbox repo, branch `bug/fx` pushed to its upstream, a `sleep 300` as the recorded pid with `.plot-worker.wrapper.pid` beside it, **no `claude` child**, clean tree, **no exit record**, `PLOT_AGENT_GRACE_SECONDS=0`:

```
LIVE wrapper pid=23768, no 'claude' child, tree CLEAN, branch pushed, no exit record
plot_worker_state    = [finished|23768|]
plot-reap.sh reading:  PLOT_PID='23768' -> 'worker alive (pid 23768)'
```

`finished <pid>` against `worker alive (pid <pid>)`, one pid, both components. That is the plan's transcript, character for character in shape — produced with **no recycled pid and no exit record**.

The mechanism is the one the plan does not name: `plot_worker_state` finds the pid alive, then asks `plot_worker_agent_alive` (`plot-worker-state.sh:580-620`) whether a `claude` process descends from it. When the wrapper lives and the agent is gone, it returns 1 and the desk is refined through `plot_worker_task_state` into `finished`/`waiting`/`stalled` (`:868-873`). The reaper takes no such reading and reports the wrapper as a live worker.

## 2. Does the fix work, or is the diagnosis wrong about where the reading comes from?

**The amendment fixed the first draft's error and introduced a new one. The fix as designed does not resolve the measured case.**

Credit where due: the amended §"The two readings" now states that `workerPid` producers resolve liveness with `ps` first and that `:441` is not the defect. That is correct and matches `plot-reap.sh:506-509`, `:1040-1042`, and the contract at `:503-504`. The `git log -L` on those lines dates the `ps -p` guard to `808ac3a7` — "One rule decides what is reapable (#540)", 2026-08-30 — the commit that created the rule.

**But the new mechanism is contradicted by the code it cites.** Plan line 47:

> `plot-worker-state.sh:888` reads `.plot-worker.exit` **before** it reports on the process

It does not. Line 888 sits **after** the `kill -0` branch has already returned, under the section header at `:880-882`:

```
  # -------------------------------------------------------------------------
  # The process is gone. What exit code did it leave?
  # -------------------------------------------------------------------------
```

The exit record is read **only when `kill -0` fails**. Measured — exit record present, pid alive, which is precisely the plan's recycled-pid case:

```
exit record present (0); pid 6297 is ALIVE (stands for the recycled pid)
plot_worker_state = [running|6297|]
```

**`running`, not `finished`.** So under the amended plan's own mechanism `--stop` would have printed `stopped bug/... (pid 99861)` and killed the recycled process — not `is not running (finished 99861)`. **The transcript the plan is built on cannot be produced by the mechanism the plan now names.** The amendment moved the diagnosis from a wrong place to a different wrong place.

Consequences for the design as written:

- **The fix is real work that does not close the measured case.** Adding a `.plot-worker.exit` reading to `plot-reap.sh:506` and `:1040` is a correct hardening — the reaper genuinely reads no exit record (`grep 'plot-worker.exit' plot-reap.sh` → no match, so plan §"The defect" is true on its own terms). But in the measured population there **is** no exit record: the wrapper has not exited. The refusal would still fire and the desks would still be unreapable.
- **"Both sites or neither" is a good observation with the wrong payload.** `:506` and `:1040` do carry the snippet independently, verified. Whatever reading is added belongs at both. That part survives.
- **§"Why not route through `plot-worker-state.sh`" argues against the fix that would work.** Its reason — *"a pure domain rule must not gain a shell dependency"* — does not apply: nothing proposes the rule call shell. The reaper is the **adapter**, it already spawns `node`, `git`, `ps` and `plot-pr-merged.sh`, and it already sources shell helpers. The section refutes a design nobody offered while declining the one component that answers the question.

## 3. What does the plan claim that a measurement contradicts?

**a) `plot-worker-state.sh:888` reads the exit record before reporting on the process.** False, measured above. It reads it only after `kill -0` fails. This is the amended plan's load-bearing sentence.

**b) The headline measurement is the recycling case.** Plan line 60: *"The measurement above **is** the recycling case, and the stale-file mechanism does not exist."* The first half is asserted, not measured — and my `running|6297` fixture shows recycling produces the wrong output word. The desks are gone (the three live desks here are all `free-*` with live pids), so the transcript is not re-runnable and the plan cannot have established this. Plan line 110 half-admits it: *"Each of #1004, #1007 and #1014 should be re-checked against the corrected mechanism before the slice starts."* **That re-check is a precondition of the diagnosis, not a follow-up** — the plan is built on the claim it defers.

**c) The recycled-pid risk is also open in the component the plan calls correct.** Plan line 86: *"It does not change `plot-worker-state.sh`. It was already correct."* Its staleness check needs `startedAt`, which comes only from the manifest; `plot-worker-state.sh:788-793` says the worktree-file fallback leaves `started_at` empty and *"the old behaviour applies — `kill -0` is trusted."* So on a manifest-less desk that script has the same recycled-pid hole. If recycling is the mechanism, both readers have it and only one is being fixed.

**d) A latent work-loss path the plan should state.** The reaper calls `firstReapRefusal` (`plot-reap.sh:594`) → `reapProblems`, which carries **no** `unpushedCommits` refusal; only `finishedWith` does (`reapable.ts:445-446`), and the reaper never calls it and never supplies `ahead` (no `ahead` reading in its readings block). Measured against the rule the reaper actually calls:

```
stalled-by-uncommitted (dirtyPath="M f.txt"): {"refusal":"uncommitted-changes","detail":"M f.txt"}
stalled-by-unpushed    (dirtyPath=""       ): null
```

The amendment dropped the first draft's `stalled` mapping, so this is no longer a defect **in** the plan — but it is the hazard any liveness widening runs into, and a desk whose worker has finished may hold unpushed commits that only that checkout has. MEMORY records the loss shape twice: *"Rescue a hung worker by committing its tree — 324 finished lines sat uncommitted"* and *"A stalled worker exits 0 with uncommitted work"*. The Done-when list should name it.

**e) Verified as true.** #1004 (`bug/the-approval-reads-why-the-host-said-nothing`), #1007 (`bug/a-wave-says-which-question-it-answered`), #1014 (`feature/a-card-sends-its-plan-to-the-jury`) are all `MERGED`, all 2026-09-26. The deadlock is real and the cost claim is credible. `plot-reap.sh` reads no exit record. `:506` and `:1040` are independent sites. `:441` is not the defect.

**f) Citation still off by one question.** `:441` is in `finishedWith`, which `plot-reap.sh` never calls; the reaper's path is `:89` in `reapProblems`. The amendment keeps quoting `:441` — now to *exonerate* it, which is fine as far as it goes, but §"What this does NOT do" promises *"it does not change `reapable.ts:441`"* about a line the subject does not execute.

## 4. What must the plan say before someone builds it?

1. **Correct line 47.** `plot-worker-state.sh:888` reads the exit record only when `kill -0` **fails**. Quote `:880-882`.
2. **Re-diagnose from the reproduction.** The divergence is `plot_worker_agent_alive` (`:580`) plus `plot_worker_task_state` (`:714`): `plot_worker_state` refines a **live** pid to `finished`/`waiting`/`stalled` when no `claude` descends from the wrapper; the reaper takes no such reading. That produces the transcript; recycling does not.
3. **Do the #1004/#1007/#1014 re-check before the slice, not during it.** If none carried an exit record, the exit-record fix closes none of the three and the plan's Done-when item 1 is untestable against the reported incident.
4. **Withdraw or re-argue §"Why not route through `plot-worker-state.sh`."** The domain-purity objection does not apply to an adapter that already spawns `node`, `git` and `ps`. If the eight-state classifier is still rejected, reject it on the `waiting`/`stalled` ambiguity alone and say what reading replaces it.
5. **Say whether `plot-worker-state.sh`'s manifest-less recycled-pid window is in scope.** Line 86 declares that script correct; on the fallback path it trusts `kill -0` exactly as the reaper does.
6. **Add the unpushed-commits guard to Done when.** `reapProblems` has no `unpushedCommits` refusal and the reaper supplies no `ahead`, so any widening of what counts as *not live* must not reap a desk holding the only copy of pushed-nowhere commits.
7. **Keep what is good.** "Both sites or neither", the readings-not-the-rule framing, `reapable.ts` unchanged, and the one-fixture agreement test are all sound and worth building once the reading is the right one.

## 5. Through your lens: what did executing reveal?

That two successive diagnoses of one transcript can both be wrong while each reads as measured. The first draft blamed a string test that sits downstream of a real `ps`; the amendment blames a recycled pid and an unread exit record, and I produced the transcript with neither — a live wrapper, a dead agent, a clean tree, no exit file. The word `finished` is the tell: it is reachable on the live-pid path only through `plot_worker_agent_alive`, and on the dead-pid path only with an exit file whose presence makes `--stop`'s companion reading say `running` instead.

Executing also showed the amendment's own fix is real but aimed past the target: the reaper genuinely reads no exit record, and in the measured population there is no exit record to read.

Two rounds have now moved the blame from the rule to the readings and from one site to two. Both moves are improvements. The mechanism is still not the one the estate produces, and the plan defers to a pre-slice re-check the very question its diagnosis rests on. The bug is worth fixing; this plan would ship a correct hardening that leaves the three desks exactly as they were.
