# Manifesto lens — a-stop-that-reports-failure-does-not-exit-zero

Position: amend

## The amendment in one line

**`Board impact: none` (plan line 16) is false, and it is the plan's only manifesto failure.** The marker `--stop` leaves behind is read by a domain rule and rendered as a board alert. Say so, and add the domain-side assertion to `Done when`. Everything else in the plan passes.

## The chain the plan does not name

`plot-fleetctl.sh:241` — `fleet_install_state` returns `installed` when the unit file exists **and `start_marker` is present**. `--status` appends that word to its `summary:` line as `install=installed`.

`packages/board/src/server/supervisor-reading.ts:53,81` spawns `plot-fleetctl.sh --status` on the refresh clock and parses `install=` off that line.

`packages/domain/src/rules/supervisor-reading.ts:supervisorState` maps exit 1 + `install === 'installed'` to **`died`**, not `down`.

`supervisorVerdict` then renders `label: 'FLEET STOPPED UNEXPECTEDLY'` with the sentence *"The fleet was started here and is no longer running — nothing stopped it … Find out what happened before starting it again."*

So the false-negative unload does not merely mislead the next `--status` prose the plan quotes at lines 78-82. It drives a **domain state whose whole purpose is to say a supervisor died unexplained**, at `prominence: 'alert'` when agents run. The plan's own motivation — *"made the next `--status` announce a crash"* — is exactly `died`, and the plan reaches the right diagnosis without noticing the rule that implements it. This is a fix in shell whose correctness is asserted in TypeScript, and the plan budgets no test there.

Concretely: the plan writes *"It does not change `--status`'s prose. Its reasoning is correct; it was fed a wrong fact."* That is true and incomplete. The reasoning it names lives in `supervisor-reading.ts`, is already unit-tested, and is the one place a regression lock for this bug can be cheap and fast.

## The 9-question checklist, run explicitly

1. **Planning in git / no external dependency** — PASS. No new dependency; `launchctl`/`systemctl` were already reached.
2. **Project-agnostic** — PASS. Both platform arms handled at `:759-762`; the `--wait` flag is already generic. Nothing hardcoded.
3. **Fails gracefully with a helpful suggestion** — PASS, and it is the plan's strongest point. The unconfirmed arm names the bound and refuses rather than escalating (line 88). Matches the `--wait` refusal shape already at `:781` (*"Each desk and claim stands … raise the bound: --wait N"*).
4. **Convention opted into, not configuration enforced** — N/A. No new config key; it reuses `--wait`, which is the right call.
5. **Would removing it simplify without loss?** — NO, correctly. An exit code that lies is the one thing an automated caller cannot re-derive (line 20). Keep it.
6. **Could a human do this by hand?** — PASS. `launchctl print; sleep; launchctl print` is the manual form, which is what the plan measured at lines 39-43.
7. **Could a smaller model run the mechanical part?** — PASS. Poll-to-bound is Small tier.
8. **Stays focused, no effort-tracking creep** — PASS. The 41-minute tick is explicitly deferred to a sibling plan (line 91).
9. **Ceremony scaling with weight** — PASS. One slice, one branch, `Review: in-session`, `Impl: own branches` for a bug. Lightest allowed path; nothing to justify.

## Design split — "skills interpret and adapt; scripts collect and report"

**This belongs in the script.** Principle 3's split does not put polling on the wrong side. `supervisor_loaded` (`:135`) is a collection primitive, and polling it to a caller-supplied bound is still collection — the script reports *what it observed and for how long*. There is no judgement in it: no threshold it invents, no semantic comparison, no adaptation to unstructured input. The plan is right at lines 56-60 to refuse a fixed sleep — a constant would be the script deciding something it measured it cannot know, and that *would* be judgement in the wrong place. Deferring the bound to `--wait` keeps the decision with the caller.

The `--stop` arm already holds this exact pattern for agents at `:729-734`: signal, poll `plot_worker_state` to `wait_bound`, name what did not exit. The plan makes the supervisor obey the rule the same function already applies to every agent above it. That is a consistency repair, not a new mechanism.

## Gates over rules

**This is a gate, and it converts a rule into one.** The test is CLAUDE.md's own: *can a caller answer "did I complete this?" without doing the work?*

Today: yes — `--stop` exits 0 regardless, so a caller reads success without the supervisor being down. That is the rule form, and it failed exactly as the doctrine predicts.

After: no. The exit code is produced only by an observation of `supervisor_loaded` returning false. It cannot be satisfied by narration, and the plan is explicit that prose is not the contract (line 98: *"the exit code is what a caller gates on and prose is not"*). Objectively checkable, and `test/reconcile/fleetctl.test.mjs:738` already establishes the precedent — *"--status exits exactly 1 for every not-loaded state, on any platform"*. The new arms belong beside it.

## Layering — no violation, and no domain duplication

`controller → domain → port ← adapter → script`. The fix stays inside the script, which is the bottom of the chain, and adds no new caller of anything. No inversion.

**Is there a domain rule that already owns "is the supervisor loaded"?** There is one that *consumes* the answer — `supervisorState` — and its header settles the direction rather than creating a conflict:

> `plot-fleetctl.sh --status` is the ONE source. Its exit code is the contract — 0 loaded, 1 not — and a second implementation reading a pidfile, a process name or `launchctl` would drift toward *looks fine*, which is the direction nobody notices and the whole defect.

So the domain has deliberately declined to own the observation and delegated it to this script. Moving the poll into the domain would create the second implementation that header forbids. **Fixing it in shell is the layering-correct choice**, and the plan should cite this header as its licence — it is a stronger argument than the `plot-boardctl.sh` precedent at line 109, which is an analogy where this is a binding statement about the same script.

**Does this need declaring per `docs/shell-and-domain.md`?** No. That contract governs a duplicated *rule* — two implementations of one decision, held together by a corpus test. Here there is exactly one implementation of *is it loaded*, and the domain reads its exit code. Nothing to declare, no corpus entry owed. Worth one sentence in the plan so a reviewer does not ask.

**Cost rule:** `--stop` runs once per operator command, so a domain call would be affordable. It is still not warranted — there is no rule to ask.

## The Master Agent Uses The Controllers — the gap is real, and reporting it is enough

The nine controller endpoints are `dispatch`, `approve`, `deliver`, `idea`, `implement`, `drop`, `reslice`, `commission`, `continue`. **There is no `fleet stop` endpoint**, and `plot-ask.mjs` answers only `board` and `fleet` as read verbs. `/plot-fleet --stop` calls `plot-fleetctl.sh` directly and is the sanctioned route — `plot-controller-gate.sh:168` names this call chain explicitly.

CLAUDE.md's instruction for this case: *"Where no controller exists, the gap is the finding."* It is a finding, not a blocker for this plan. A stop is a process action on one machine, not a lifecycle transition; it writes no `State:` line, so `plot-state-gate.sh` has no claim on it either. Building an endpoint here would be scope the bug does not carry. **Note the gap in `Notes`; do not build it.**

## "What this does NOT do" — correctly scoped, with one gap

Three of the four disclaimers hold cleanly:

- **No force / no `kill -9`** (line 88) — correct, and it is the manifesto's Pacing rule applied. Ending a wedged process is human-paced; the script stops at the refusal. This is the same restraint that keeps the fleet without an autonomous merger.
- **Does not touch the agent loop** (line 89) — correct. Supervisor-last at `:756-758` is load-bearing and untouched.
- **Does not diagnose the 41-minute tick** (line 91) — correct, and properly handed to the sibling plan.

**The fourth disclaims something it must handle.** *"It does not change `--status`'s prose"* (line 90) is true about prose and hides the domain consequence above. The plan should disclaim the *prose* while owning the *state*: `--status`'s `install=` field, and the `died` verdict derived from it, are precisely what the marker decides.

## Evidence over assertion (Principle 12)

The plan is unusually good here and deserves saying plainly. Line 56 — *"That measurement did NOT reproduce the failure, and stating so is the point"* — is a negative result reported rather than buried, and it is what rules out the wrong fix. Lines 39-43 record what was executed, not what was read. This is the standard Principle 12 asks for.

## What to change before building

1. **Replace `Board impact: none`** with the chain: the marker feeds `fleet_install_state` (`plot-fleetctl.sh:241`) → `install=installed` on the `--status` summary → `supervisorState` → `died` → the `FLEET STOPPED UNEXPECTEDLY` alert. No payload or schema change; a false marker produces a false board alert, which is the same defect the motivation describes.
2. **Add one `Done when` item:** a domain test that `supervisorState({asked: true, summarised: true, exitCode: 1, install: 'installed'})` is `died` — the regression lock for what the false marker causes, in the package where it is cheap.
3. **Cite `packages/domain/src/rules/supervisor-reading.ts`'s "ONE source" header** as the licence for fixing this in shell. It answers the layering objection outright, where the `plot-boardctl.sh` analogy only suggests an answer.
4. **Amend the fourth disclaimer** to "does not change `--status`'s prose — it does change the `install=` state that prose is derived from."
5. **One line in `Notes`:** no `fleet stop` controller endpoint exists; `plot-controller-gate.sh:168` sanctions the direct call. Recorded as a gap, not built here.

None of these changes the slice, the branch, or the shape of the fix. The diagnosis is right, the fix is in the right layer, and the gate is a real gate. The plan under-declares its blast radius by exactly one hop.
