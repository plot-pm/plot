# Manifesto lens — fleet-control-finds-its-own-artifact

Position: amend

The plan is right about the defect, right about the fix, and right to refuse the probe. It fails on one thing the manifesto cares about most: the fourth Done-when is written as a gate and is currently a rule, and its own Done-when list understates one item while the "does NOT do" section understates the scope of a message it half-fixes.

## The 9-question checklist

| # | Question | Verdict |
|---|---|---|
| 1 | Keeps planning in git / no external dependency | **Pass** — a path resolution, nothing added |
| 2 | Project-agnostic / no hardcoded assumptions | **Pass, and this IS the question the plan answers.** `$repo_root/skills/plot/scripts/board/…` hardcodes the assumption that the consumer's checkout is Plot's checkout. Principle 5 in one line |
| 3 | Fails gracefully with helpful suggestions | **Partial, see below.** The plan fixes the refusal's message in one script and leaves the same false suggestion in the estate's other thirteen |
| 4 | Convention opted into, not enforced | N/A — a bug fix |
| 5 | Would removing it simplify without loss | **Pass** — the fix removes a line's worth of divergence and makes 27 sites say one thing |
| 6 | A human with basic git knowledge could do it | **Pass** — `sed` one line |
| 7 | A smaller model could follow the mechanical parts | **Pass** — the slice is one path edit plus a grep-shaped gate |
| 8 | Stays out of effort tracking | N/A |
| 9 | Ceremony scales with weight | **Pass on the plan's own shape** (one slice, one branch, bug type). The gate is where ceremony is questionable and I judge it earns its place — see below |

## On refusing the probe: sound, and the plan understates its own case

I verified the argument and it holds — but not for the reason the plan gives, and the real reason is stronger.

DESIGN-process.md §1 says *"neither may become a dependency of the other"* and names the one permitted touch: the supervisor may PUBLISH a reading the board consumes, one-directionally. The plan reads that correctly. A juror could still object that a read-only probe is a weak dependency and the rule is being over-read.

**The objection dies on a measurement the plan did not take.** `plot-board-probe.sh` contains `board-server.mjs` five times and the string `registryd` zero times. Its whole artifact resolution — `marketplaces/` first, npm second, checkout third — searches for `-name 'board-server.mjs'`. **The probe cannot answer this question at all.** "Adopting the probe" is not the heavier of two correct answers; it is teaching the board's probe about fleet control's artifact, which is §1's forbidden edge drawn explicitly rather than incidentally. The plan's own recommendation is right and its justification is the weaker half of the available one.

Manifesto Q5 also settles it independently: `$script_dir` needs no subprocess, no JSON parse, and cannot fail for a reason of its own. Removing the probe call loses nothing.

**Amend:** replace the §1 appeal with the measurement. `grep -c registryd plot-board-probe.sh → 0`. One fact retires the whole argument, and the plan currently argues from a rule it could have argued from a reading.

## Design split — right layer, and the plan proves it

Principle 3: *"skills interpret and adapt; scripts collect and report."* The bug is a path resolution inside a script that already owns fleet control's mechanics; the fix stays there and touches no skill prose. 26 peer sites — `plot-approve.sh:473`, `plot-open-pr.sh:37`, `plot-release-gate.sh:28`, `plot-write-config.sh:31`, `plot-worker-state.sh:728` — all resolve `$script_dir/board/*.mjs`. This is one file joining a settled convention. Correct layer, no layering-rule implications at all (no domain, no port, no adapter is touched).

## Is the Done-when gate a real gate?

**As written, no — it is a Done-when line, and Done-when lines are rules.** The manifesto's own test: *"Can you answer 'Did I complete this?' without actually doing the work?"* Today, yes — an implementer can write "the gate holds at zero" in a PR body and nothing contradicts it.

But the plan is not wrong to ask for one, and the shape is gateable. Measured against the two existing gates:

- `check-host-cli-callers.sh` is a **path check with a named exception list**, because *"the line itself is the violation"*. That is exactly this case: `$repo_root/…/scripts/board/*.mjs` is wrong wherever it appears, with no caller-intent to disambiguate. No `plot-ancestry:`-style author declaration is needed, because unlike ancestry there is no correct use of this idiom.
- It needs CI wiring (`ci.yml` runs seven `check-*.sh` scripts at :417–:522) and a self-test proving its refusal (`test/reconcile/host-cli-gate.test.mjs` exists precisely because *"a gate nothing tests is a gate that passes because nobody looked"*).

**Amend:** the slice must name the artifact — a `scripts/check-*.sh`, a CI step, and a test that points the gate at a fixture and proves it refuses. Without those three the fourth Done-when is unfalsifiable, which is the failure mode CLAUDE.md's "Gates Over Rules" section exists to prevent. The plan's own closing line — *"it survived because nothing said so"* — is the argument for making this concrete, and the plan then leaves it abstract.

## Slice item 2 is already satisfied and the plan does not know it

`plot-fleetctl.sh:593` fills `__REGISTRYD__` from `$registryd` — the same variable set at :89. There is **one** definition, so fixing line 89 fixes the unit fill by construction. The plan's framing — *"fixing the probe alone would be incomplete… the fill must use the same resolution"* — describes a second change that does not exist.

This is not harmless. It is the third of three numbered items in a one-line fix, and an implementer chasing it will look for a second resolution site and find none. State it as what it is: **the fill inherits the fix because `$registryd` has one definition**, and the Done-when becomes a regression assertion rather than a task.

I confirmed `__REPO_ROOT__` is separate and correctly stays `$repo_root` — it names the repository the daemon supervises, which IS the consumer's checkout. The plan's third "does NOT do" bullet is right.

## "What this does NOT do" — one disclaimer is too narrow

Three of four scope exclusions are correct. The gate stays, `$repo_root` elsewhere stays, and the probe is refused on a sound (understated) basis.

**The already-installed unit disclaimer is acceptable.** `--stop` then `--start` is the documented path, the unit bakes paths in permanently and says so for `__NODE__` in the same terms, and repairing a foreign machine's launchd plist is a blast radius no bug fix should claim. Q3 is satisfied by *documenting* the upgrade path, which the plan does. Not a reporter left broken — a reporter whose repair is one documented command.

**The message fix is scoped too narrowly to be honest.** Done-when #3 says *"A genuinely missing artifact still refuses, with a repair a consumer can perform."* I grepped: `pnpm build:board` appears as an operator-facing repair in **thirteen scripts** — `plot-deliver.sh:167`, `plot-approve.sh:483`, `plot-release-gate.sh:33`, `plot-open-pr.sh:46`, `plot-write-config.sh:40`, `plot-worker-state.sh:729`, `plot-fleet-scan.sh:3408`, `plot-dispatch.sh:1954`, and more. Every one of them tells a consumer to run a script their repository does not have. The plan's Motivation calls that half of the defect — *"Both lines are false"* — and then fixes it in one file.

This does not make the slice wrong; `plot-fleetctl.sh` is the reported failure and a bug fix may be narrow. But the plan must **say** the message is estate-wide and out of scope, rather than implying the repair is complete. A "does NOT do" that names the probe and the gate and omits twelve identical false messages is scoping by omission. Name it, and file it — the plan's own Notes section is where that belongs.

## Summary

Fix and reasoning: correct. Refusal of the probe: correct, on a weaker argument than the available one. Layer: correct. Ceremony: proportionate.

Three amendments, none structural:

1. **Justify the probe refusal with the measurement** (`registryd` appears 0 times in the probe), not only with DESIGN-process.md §1.
2. **Make the gate concrete** — name the `check-*.sh`, the CI step, and the fixture test that proves its refusal. As written it is a rule claiming to be a gate, which is the one thing this repo's "Gates Over Rules" section forbids.
3. **Correct two scope statements** — the unit fill needs no separate change (one `$registryd` definition), and the false `pnpm build:board` repair exists in thirteen scripts, which this plan deliberately does not fix.
