# Estate lens — an unread status is not a sick fleet

Position: amend

The symptom is real, the diagnosis is honest, and the fix is aimed one layer too high. The estate already holds a precedent that refuses this exact move, and a measurement the plan did not take shows the cost it proposes to accommodate is almost entirely work the board throws away.

---

## 1. Other timeouts for the same kind of reading

Every budget in the codebase, with how each was chosen:

| constant | value | where | how chosen |
|---|---|---|---|
| `SUPERVISOR_TIMEOUT_MS` | **5 s** | `board/src/server/supervisor-reading.ts:50` | "3.5x the worst reading (1.42 s), and one refresh cadence" |
| `DOC_FETCH_TIMEOUT_MS` | 10 s | `app/lib/bounded-fetch.ts:32` | client fetch |
| `ACTION_TIMEOUT_MS` | 15 s | `app/lib/bounded-fetch.ts:45` | client action |
| `run()` default | 30 s | `server/fleet.ts:899` | generic script default |
| `CLAIM_TIMEOUT_MS` | 60 s | `server/claim.ts:54` | — |
| `FLEET_SCAN_BUDGET_MS` | **90 s** | `server/fleet.ts:1054` | measured, and **twice refused** |
| `TRANSITION_TIMEOUT_MS` | 120 s | `server/transition.ts:51` | — |
| `PULSE_TIMEOUT_MS` | 600 s | `refs-git.ts:27` | — |

**The precedent that governs is `FLEET_SCAN_BUDGET_MS`, and it argues against this plan as drafted.** Its header (`fleet.ts:1031-1053`) is the estate's written doctrine on raising a budget, and it says three things this plan must answer:

> *"90 s is HEADROOM over a 34-52 s cost, not cover for a 279 s one. **It was refused twice while the scan was 279 s**, because a budget raised to fit a 9x overrun hides the next regression instead of reporting it. The remaining per-branch `rev-list` block (64 calls) is the next thing to batch, and **when it lands this can come back down**."*

So the estate's rule is not *raise the budget to fit the measurement*. It is: **a budget may be raised to cover honest variance, and must not be raised to cover work that should be removed.** The scan's budget was held at a refusal until the underlying cost was batched down. This plan proposes the opposite order, and §2 shows the cost here is removable in a way the scan's was not.

The same header also supplies the one argument that genuinely supports this plan: *"a fixed budget below the loaded cost fails INTERMITTENTLY, which is the worst shape."* That is exactly the reported symptom, and it is why `amend` rather than `reject` — something must change.

**The 5 s value was already a considered choice, not a guess.** The plan calls it "a guessed one" (slice line) and "chosen for a command that answers in under two on an idle machine". The docstring at `:42-49` actually records 1.42 s measured *on the largest fleet here* with 27 worktrees, and picked 3.5x that plus a refresh-cadence argument. The plan should contest that reasoning on its merits rather than characterise it as unconsidered — the second half of the original argument ("one refresh cadence") is the part that constrains any new number, and the plan never engages it.

## 2. Does something already report this more cheaply? — **Yes, and this is the finding**

I measured the script's cost split on this machine (load average 9.66-9.81, 19 desks, supervisor live at pid 3260):

```
launchctl list <label>           4-5 ms      ← the supervisor answer
plot-config.sh get               23-33 ms
the 19-desk walk                 250 ms
--------------------------------------------
whole --status command           823-2905 ms  (8 runs)
```

**Read `plot-fleetctl.sh` in order.** `install_state` and the exit code are fully decided at `:350-390`, from `supervisor_loaded` + `supervisor_pid` — two `launchctl` calls, ~5 ms. The desk walk at `:439-465` runs *after* that, and contributes exactly two fields to the summary line: `agents_running` and `agents_other`.

**The board discards both.** `fleet.ts:7630` computes the verdict as:

```ts
supervisorVerdict({ ...entry.supervisor, agentsRunning: liveAgents })
```

and `liveAgents` comes from `fleet.ts:7525` — `entry.agents.filter(isLiveState).length`, the **registry**, not the script. `readSupervisor` (`supervisor-reading.ts:130-135`) keeps only `asked`, `exitCode`, `summarised`, `install`. **Not one of the four is produced by the desk walk.**

So the board pays 800-2900 ms to obtain a ~5 ms fact, and the 99% it pays for is a per-desk walk whose entire output it drops on the floor. The plan's central premise — *"it enumerates every agent and asks each desk for its worker state. That is inherent to the question"* (§"Why the command is slow") — is false for **this caller's** question. It is inherent to `--status`'s question as a human-facing command; it is not inherent to what the board asks.

This also disposes of the plan's growth argument. *"it grows with the fleet: on this estate it walks a dozen desks"* is correct and is precisely why a raised budget is a temporary fix: the cost scales with desks while the needed answer is O(1). Whatever number is chosen today gets overrun by a larger fleet, and the intermittent-failure shape returns.

**The cheaper routes, in the estate's own idiom** (the plan should pick one and record why):

1. **A `--status --brief` / `--supervisor-only` arm** that prints the `summary:` line and exits before the desk walk. Preserves the exit-code contract, the `summary:` prefix and `install=` exactly — everything `supervisorState` gates on — and cuts the reading to tens of milliseconds. This is the estate's shape: `plot-fleet-scan.sh --stream` and `--next` are the same move, narrowing a broad command for a caller that needs one part of it. A budget then becomes genuinely generous rather than marginal.
2. **Keep 5 s and fix the ordering.** Since `sup_word`/`install_state` are decided before the walk, emitting the summary line *first* would let even a killed run be `summarised`. This one needs care — it inverts `summary:`-is-last, which is load-bearing for the `unknown`/`down` split (`:466-471`) — so it is the weaker option, noted for completeness.

If the panel prefers to ship the budget raise first as a stopgap, the estate's precedent requires the plan to say so explicitly in the constant's docstring, in `FLEET_SCAN_BUDGET_MS`'s own words: *what the real fix is, and when this can come back down.* Raising it silently is the move that header refuses.

## 3. Is this genuinely a third cause? — **Yes, verified**

Both siblings landed today and are distinct mechanisms:

| defect | commit | landed |
|---|---|---|
| a leaked test unit holding the production label | `6d47cfa7a` *"a test can no longer reach this machine's launchctl"* | yes |
| a test suite unloading the supervisor | `e8ec081a9` *"the daemon did not die, a test stopped it"* | yes |
| `--status` read the label, not the process | `f241cfc6d` → PR **#960** merged (`a2940b9bf`), plan **Delivered** | yes |

That is arguably *four* causes behind the one symptom, not three — the plan names the leaked label and the unloading suite but omits `a-loaded-label-is-not-a-running-daemon`, which shipped today and is the most recent prior explanation of "the supervisor looks wrong".

**This one is not a residue of the others.** They produce `down`/`died` via exit 1; this produces `unknown` via `asked: false`. Different field, different arm, different rendering. I verified no leak survives: `launchctl list | grep plot-pm` returns exactly one line, `3260 0 com.plot-pm.registryd` — the production label, live, exit 0. The plan's stated premise (pid 3260, label loaded, `--status` exiting 0) is accurate.

**One caution the estate earned today.** `a-loaded-label-is-not-a-running-daemon` carries an `AMENDED AFTER PANEL` banner because its evidence turned out to measure a leaked test unit rather than production. Three of its facts were wrong while its symptom was real. This plan's three readings (5724/1780/2345 ms) are a single unreplicated sample, and my eight runs at comparable load produced 823-2905 ms with **nothing above 3 s**. The 5724 ms outlier is plausible — the machine also ran three panel agents — but it is one observation, and the whole proposed number rests on it. The amendment should re-measure, state the load average and the desk count alongside each reading (the script's own docstring does this: *"0.46 s with no fleet worktrees, 1.42 s with 27"*), and record the distribution rather than three points.

## 4. Slice conventions — **conforms**

Checked against all 17 plans dated 2026-09-20..22: every one uses `## Slices`, as this does. One branch, `bug/` prefix matching `Type: bug`, wave heading carrying `(Branch: …)`, `Review: in-session` + `Impl: own branches` matching the delivered sibling exactly. The done-when is checkable (a test pinning that an over-budget run answers `unknown`, and that `summarised: false` keeps its arm).

Two notes:

- **The `summarised: false` arm already exists** — `packages/domain/test/supervisor-reading.test.ts:44`, *"reads exit 1 with no summary line as unknown, not as down"*, plus `:101` and `:39`. The slice says "a test pins that"; it should say *keeps*, and point at the existing arms, or the implementer may add a duplicate. What is genuinely missing is a test at the `readSupervisor` layer proving a timeout yields `asked: false` — no test references `SUPERVISOR_TIMEOUT_MS` anywhere.
- **The changeset** is unmentioned. `packages/board/src/` is shipped code, so `no_changeset=` (reconcile §22) will fire without one; per memory, a board-only change uses `'@plot-pm/board': patch` frontmatter with no `bumps:` block.

## 5. The `unknown` prominence claim — **true, and stronger than the plan states**

Verified in both layers:

- `packages/domain/src/rules/supervisor-reading.ts:271` — `if (state === 'unknown') return 'note';` unconditionally, *before* the agent-count test on `:272`. The docstring at `:256-258` is explicit: *"`unknown` stays a `note` however many agents run."*
- `FleetControls.tsx:356` — `const loud = prominence === 'alert'`, so `note` renders grey (`text-slate-400`), **no `role="alert"`**, **no `⚠`**, and `:387` gates the detail sentence behind `loud` — so a `note`'s sentence appears in a `title` tooltip only.

The plan says *"`unknown` renders as a `note` rather than an `alert`, which is already the right prominence"*. Correct. The component header (`:346-349`) states the reasoning: *"a board that could not ask must render neither an alarm nor an all-clear. Promoting it would train the operator to dismiss the alert that matters."*

**This strengthens the estate case against a pure budget raise.** The rendering is already maximally quiet — grey text, no alert role, sentence hidden in a tooltip. The operator's complaint was not that the board shouted; it is that a *frequently-wrong* grey note is noise. Raising the budget makes it wrong less often without changing that the reading is 99% wasted work whose cost grows with the fleet. §2's fix removes the cause; the budget raise moves the threshold.

The plan's refusals of the two wrong fixes are both correct and well-argued — **not retrying** (doubles the slow case, hides it) and **not quieting `unknown`** (suppressing a true statement to work around a wrong budget). Both hold. The third option it does not consider is *make the reading cheap*, which is the one the estate's own scan precedent points to.

---

## What would move this to `proceed`

1. **Replace or sequence the fix with the cheap reading** — a `--status` arm that answers the supervisor question without the desk walk, or an explicit statement that the budget raise is a stopgap, recorded in the constant's docstring in `FLEET_SCAN_BUDGET_MS`'s idiom (what the real fix is, and when this comes back down).
2. **Correct the premise** that the desk walk is inherent. It is inherent to the human command, not to the board's question: the board discards `agents_running`, taking it from the registry at `fleet.ts:7525`.
3. **Re-measure with load and desk count recorded.** Eight runs here spanned 823-2905 ms and none reached 5724 ms; one unreplicated outlier is carrying the whole number, and the sibling plan needed a post-panel amendment for exactly this.
4. **Engage the original 5 s reasoning** — specifically the "one refresh cadence" half, which constrains any replacement number.
5. **Point the `summarised` test at the existing arms**, and add the missing one: a timeout at `readSupervisor` yielding `asked: false`.
6. **Name the changeset** (`'@plot-pm/board': patch`).
