# Blast-radius lens — r2, a-plan-has-one-phase (#924)

Read at `origin/main` = `1a8943119`, plan at `50cb25008`. My question is what the rewrite costs the people whose deliveries are not broken. Every measurement below was run today.

## 1. The new claims about `plot-deliver.sh`

**`:98` parses before writing — TRUE.** `skills/plot/scripts/plot-deliver.sh:98` is `meta=$(bash "$script_dir/plot-plan-meta.sh" "$plan_file" …)`, and `:105` reads `.phase` from it. That is the pre-write parse.

**"never reads it back" — FALSE as stated, and the correction matters.** `grep -n plot-plan-meta.sh` returns a SECOND live parse at **`:384`**, inside `decide_transition()`, whose own comment at `:376-378` says it is *"called with the file's OWN parse rather than the caller's: on the booking-worktree flow those are different files."* So the script already parses twice, and `:384` is the parse that decides the transition. What is true is the narrower claim the plan needs: **neither parse happens AFTER `write_transition()`'s `mv`** (`:429-446`). The plan's sentence overstates by one parse and its conclusion survives. It should say *never re-parses after the write*.

**What it refuses today — TWO refusals, both pre-write.** The header at `:39-46` names them and the code matches: phase not `approved`/`delivered` (`:115-131`, `die` → exit 1) and any non-deferred branch unmerged (step 2). Plus non-refusal failures: no plan file (`:95`), unparseable plan (`:99`), plan outside the repo root (`:245`), no `## Status` section (`:437`), commit failure, and push rejected (`:627`, the only exit 1 AFTER the irreversible step).

**Documented exit codes — `:9-11`:** *"Exit 0 when the plan is Delivered on the default branch (whether this run did the work or found it already done); 1 on a refusal or a failure."* Two codes, and the plan's refusal fits the `1` slot without inventing a third. **But it does not fit the SENTENCE.** Exit 0's contract is *the plan is Delivered on the default branch* — which after a successful push is exactly what a gate-tripping run has achieved. The plan's refusal would exit 1 on a run where the documented exit-0 condition holds. That is a contract amendment the plan does not name.

**Unverified:** the reporter's project-repo numbers (74 both / 1 Status-only). External by construction; nothing in my verdict rests on them.

## 2. THE KEY QUESTION — what breaks for somebody whose delivery works

### 2a. The silence measurement: 275 of 275

I extracted the real `flip_phase` awk (`:271-285`) verbatim, forced every plan under `docs/plans/` to `State: Approved`, ran the flip, and re-parsed:

```
tested: 275   post-write-mismatch: 0   nothing-to-flip: 0
```

**Every plan on this estate flips to a file the parser reads as `delivered`.** Also confirmed: the idempotent re-run shape (already `Delivered`) re-parses `delivered`, and `phase_alt != NONE` on **0 of 289** plans. On this repository the gate is silent. That is the strongest thing the plan has going for it, and the measurement is real.

### 2b. The caller trace — and the one that matters is automatic

| caller | how | what it does with exit 1 |
|---|---|---|
| `/plot-deliver` SKILL.md:415 | agent runs the script, reads the `summary:` line | an agent reads prose; a refusal naming both values is actionable |
| `POST /api/deliver` → `deliver.ts` | spawns an agent (`DeliverButton.tsx:71` — *"spawns /plot-deliver"*), log read back via `GET /api/deliver/<slug>` | a person is watching; the refusal reaches them |
| **`maybeAutoDeliver` → `runAutoDeliver`** (`auto-deliver.ts:490`, wired live at **`fleet.ts:2986`**) | `scriptsFor(opts).start(DELIVER_SCRIPT, …)` or a spawned agent, **detached, nobody watching** | **`onExit` at `:349-356`: any non-zero → log a line, `return`, DO NOT REAP** |
| `plot-controller-gate.sh` | PreToolUse hook | exit **2** blocks the call; unrelated to a new exit 1 |

**`fleet.ts:2986` is the blast radius.** Auto-delivery runs on the pulse — every few seconds — against every plan whose slices are all merged. It is not a person clicking. Trace what a gate-tripping run does there:

1. The script writes, commits, **pushes to the default branch** (irreversible).
2. The new gate re-parses, disagrees, exits 1.
3. `onExit` sees non-zero and logs *"not reaping — the delivery refused, so its desks are not finished"* (`:352-353`). **The desks are not reaped and the refs are not released** — but the delivery DID land. That message is now false, and the chained `reap → plot-release-refs.sh` sequence (`:395-401`) never runs.
4. `pruneDelivering` (`:352`) next pulse: the plan's phase DID move to `delivered` on main, so `plan.phase !== 'approved'` → pruned as *"moved on — confirmed"*. No retry loop. Good.

So the failure mode is **not** a hot loop. It is: a delivery that landed, desks left standing, refs left live, and a log line saying the delivery refused. That is a genuinely new stranded state, and it is invisible because nobody is reading that log.

**One more, and it is the sharper one.** `plot-deliver.sh:639` calls `spend_action_receipt` — and it is the LAST line, after `exit 0` is reached. A refusal that `die`s before it **leaves the action receipt unspent**. `plot-state-receipt.sh:137-145` says that is deliberate for interruptions (*"a failed run is retried on the same licence"*), so this is not a leak. But it means the licence stays open on a run that already pushed — and the documented repair for a failed run is *run it again*, which here re-runs a delivery that already landed.

### 2c. Could it strand a delivery that is actually fine?

**Yes, in one measured shape, and the plan does not name it.** `flip_phase` carries `!done` (`:275`) — it flips only the FIRST `State:`/`Phase:` line in `## Status`. A plan carrying both:

```
before:  {"phase":"approved","phase_alt":"approved"}
after:   {"phase":"delivered","phase_alt":"approved"}
```

`.phase` is `delivered`, so a gate asserting only `.phase == delivered` passes. But a gate written as *"assert the phase the parser reports"* — the plan's own words — is ambiguous about whether `phase_alt` counts, and an implementer reading *"the refusal names BOTH values"* could reasonably include it. **0 plans here carry that shape, so no test on this estate distinguishes the two implementations.** The `Done when` must pin `.phase` specifically, or a correct delivery on a two-field plan refuses after pushing.

### 2d. The honest counterweight

For everyone whose delivery works, the cost is **one extra `plot-plan-meta.sh` invocation per delivery** (sub-second, already paid twice) and **zero behaviour change**, measured 275/275. The people the plan is protecting get a loud stop where they had a false success. That trade is good. My objection is not to the gate — it is that the gate fires on the wrong side of the irreversible step and nothing says what to do then.

## 3. Fires AFTER the write and the push — what state, and does the plan say?

**The plan does not say. This is its largest gap.**

The plan asserts *"the write is irreversible and re-running is the repair"* — inherited from the script's header (`:30-33`), which is true of an INTERRUPTION. It is not true here. After a gate-tripping run:

- The phase IS flipped and pushed to main. The `Delivered:` record IS written. The symlink IS moved. The sprint box IS ticked.
- The parser still answers `approved` (the defect), so **`decide_transition` at `:384` will answer `write` again on the next run** — it asks the domain with `.phase = approved`.
- `flip_phase` finds nothing matching `approved` → `changed=0` → `phase_report="already"`.
- The staged diff is empty → `push_report="nothing-to-commit"` (`:602`) → the run reaches the new gate again → **refuses again**.

So re-running produces the same refusal forever. That is the plan's own stated `Done when` (*"a second run on an unrepaired file refuses again"*) — correct as a gate, and it means **the documented repair path does not exist for this failure**. The plan states the refusal requirement and never states the remedy. A person hitting this has: a plan that reads `approved`, a main branch that carries `Delivered` in a block nobody reads, and a command that refuses. Their only exit is `plot-state-receipt.sh --unowned` — the escape hatch the ticket itself calls out as wrong to use routinely.

**The refusal must therefore carry the remedy**, and the `Done when` must pin that it does. "Names both values and the file" is not enough; it needs to name the action (*"your plan carries two formats; remove the front-matter `status:`/`phase:` field, then re-run"*). And it should say the delivery LANDED — otherwise a reader assumes nothing was written and goes looking for a delivery that is already on main.

**The cheaper alternative the plan does not weigh:** run the same check BEFORE the write, as a third pre-write refusal beside the two at `:115` and step 2. Same format-agnosticism is lost — it can only catch a *predictable* split, not an arbitrary writer/reader disagreement — but nothing irreversible has happened, `exit 1` means exactly what `:9-11` already documents, the auto-deliverer's "not reaping" message stays true, and re-running is genuinely the repair. The plan's format-agnostic property is real and worth something; it is not obviously worth a refusal that fires after a push with no way back.

## 4. What `Done when` fails to pin

1. **Which field the assertion reads.** `.phase` alone, or `.phase` and `.phase_alt`? §2c shows a shape where they differ and `.phase` is right. Unpinned, and unreachable by any fixture on this estate.
2. **What happens to the exit-0 contract.** `:9-11` says exit 0 means *the plan is Delivered on the default branch*. After a gate-tripping push it IS. Nothing pins the header being amended.
3. **The auto-deliverer's reap chain.** `auto-deliver.ts:352` logs *"not reaping — the delivery refused"* on any non-zero. Nothing pins that this message stays true, or that a delivery which landed-then-refused is distinguishable from one that refused before writing. This is the one caller with no human in the loop and the `Done when` never mentions it.
4. **The remedy in the refusal text.** Pinned: "names BOTH values and the file". Not pinned: names what to do, or that the push already happened.
5. **Where the gate sits relative to `spend_action_receipt` (`:639`).** An unspent receipt on a landed delivery is a live licence; nothing says whether that is intended.
6. **An implementation that satisfies every gate and is still wrong:** put the re-parse after the `mv` inside `write_transition` but BEFORE the commit/push, assert `.phase`, `die` on mismatch. Every listed gate passes — the fixture refuses, the message names both values, the exit code is 1, the second run refuses, agreeing deliveries are byte-identical, no parser field changes, contracts pass. And it is a *better* script than the plan describes, because nothing irreversible has happened. **The `Done when` cannot tell that apart from the version that pushes first**, which means it does not pin the one property §3 is about.

## 5. Strongest argument against doing this at all

**It converts a silent failure into a permanent dead end, on a path where nobody is watching, to protect a population this repository does not have.**

Measured: 0 of 289 plans here can trip it, 275 of 275 pass the flip-and-reparse. Every assertion runs against synthetic fixtures; the real corpus can never catch a regression in it. Meanwhile the change lands on the one lifecycle script that `fleet.ts:2986` runs automatically every few seconds, whose exit code gates a reap-and-release chain, and whose refusal path — per §3 — has no repair. The people it costs are not the people it helps.

The counter, which nearly carries and is why my verdict is not `reject`: the gate is genuinely format-agnostic, it is a gate where the first draft was a rule, it restores the idempotence complaint, and it fixes the estate's own *"can you answer 'did I complete this' without doing the work?"* test — which `plot-deliver.sh` fails today by construction. That is a real defect in a real script and this is the right shape of fix. **It is the placement that is wrong, not the idea.** Move the check before the irreversible step, or state the post-push remedy and pin it. Either converts this from a well-argued change with an unexamined failure mode into one I would ship.

Verdict: amend
