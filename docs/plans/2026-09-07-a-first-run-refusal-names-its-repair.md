# A first-run refusal names its repair

> 16 of 126 refusals across the five scripts a first run touches name the command that fixes them. The other 110 state a cause and stop, which works when somebody who knows Plot is sitting next to you.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #784 merged

## Changelog

- Every refusal reachable in a first unattended run names the command that fixes it, so a teammate who has not read this repository can act on what they were told.

## Motivation

**Measured 2026-09-07** across `plot-approve.sh`, `plot-deliver.sh`, `plot-fleetctl.sh`, `plot-dispatch.sh` and `plot-host.sh`:

| script | refusals | name a repair |
|---|---|---|
| `plot-approve.sh` | 24 | **2** |
| `plot-deliver.sh` | 23 | **1** |
| `plot-fleetctl.sh` | 17 | 4 |
| `plot-dispatch.sh` | 28 | 5 |
| `plot-host.sh` | 34 | 4 |
| **total** | **126** | **16** |

**13%.** The other 110 are correct, specific and complete about what went wrong.

**THE BAR ALREADY EXISTS IN THIS ESTATE.** `plot-fleetctl.sh`'s node refusal does not say *wrong version*; it says **`nvm use`**. `plot-dispatch.sh --stop`'s refusal quotes the exact command to run. `plot-reap.sh` names the path and says nothing was deleted. **This is not a new standard — it is four scripts' worth of an existing one, applied unevenly.**

**THE COST IS NOT CONFUSION, IT IS THE ASK.** A refusal that names a cause is actionable *for somebody who knows the estate*. The sprint's goal is a teammate who does not, running unattended — where the next step after an unactionable refusal is to find a person, and there is none.

**AND ONE MEASURED REFUSAL IS WORSE THAN UNHELPFUL.** `plot-dispatch --stop` answers *"no worktree for 'feature/x' at …"* — one path, implying that is the only place a desk could be. It is not; the desk exists elsewhere. **A refusal that names a cause confidently and wrongly sends a reader to `kill`**, which is what happened here on 2026-09-07.

## What this is not

**Not rewriting 110 messages.** Only refusals **reachable in a first unattended run** are in scope — the walkthrough defines the set, and it is far smaller than 110.

**Not a template.** *"Run X"* appended to a cause is worse than the cause alone when X is wrong. Each message names the repair for its own condition or stays as it is.

**NOT A WALKTHROUGH.** The plan first proposed writing one to scope the work. **The estate already has that shape and it did not work**: `docs/fleet-user-test.md` was written 2026-08-14 and has **one commit, zero edits in 24 days, and zero recorded results** — a protocol three release checklists cite and nobody ran. A second one would have been a second unread document, and the rule below needs no run to apply.

**Not a change to what refuses.** Every gate keeps its condition. Only the sentence changes.

## Slices

### Every first-run refusal names a repair or a decision (Branch: bug/a-first-run-refusal-names-its-repair)

One rule, applied to every refusal on the path from `/plot-init` to `/plot-deliver`.

**THE RULE IS TWO WORDS LONG AND NEEDS NO WALKTHROUGH TO APPLY.** A refusal names **the command that fixes its condition**, or **the decision the reader must make**. Nothing else changes: every gate keeps its condition, and only the sentence moves.

**THE SECOND ARM IS NOT AN ESCAPE.** *"A conflict — decide which side to keep"* is a decision named; *"conflict"* is a cause stated. Some conditions genuinely have no single command, and those must still tell a reader what they are choosing between.

**THE CONNECTOR NAMES ITS OWN CLI.** A refusal saying `gh auth login` is wrong advice on a Bitbucket team. Each connector already knows its vendor and its command, so the text comes from **the connector that failed** — no script branches on the stack, and `plot-host.sh` stays a place that collects and reports. This is the connector contract CLAUDE.md already states, applied to words instead of budgets.

**THE `--stop` REFUSAL IS IN SCOPE AND IT IS THE WORST ONE.** *"no worktree for 'feature/x' at …"* names one path and implies it is the only place a desk could be. It is not — the desk exists elsewhere, and on 2026-09-07 that sent a reader to `kill`. **A refusal that is confidently wrong is worse than one that is terse**, and this slice fixes the sentence whether or not `a-dispatch-stop-finds-the-desk` lands first.

**Done when** every refusal reachable from `/plot-init` to `/plot-deliver` names a repair or a decision, no message names a CLI the configured stack does not use, each connector supplies its own repair text, and the `--stop` refusal no longer asserts a path it did not check.

## Notes

### Why the count is the wrong target — 2026-09-07

13% could be raised to 100% by appending advice to 110 messages, and the sprint would be no closer to its goal. **The target is the walkthrough's count of moments somebody had to be asked**, which is zero or not zero, and which no amount of rewording reaches without running it.

### Round 1 — 2026-09-07

**The two-slice shape was cut, and the evidence against it was already on disk.** Slice 1 would have written a walkthrough whose output scoped slice 2. `docs/fleet-user-test.md` is that document, written 24 days earlier: one commit, never edited, no results recorded, cited by three release checklists and run by nobody.

**A plan whose first slice produces a document that must then be acted on has two failure modes and only one of them is visible.** It can be written and not run — which is what happened — and nothing about the artefact says which.

**So the scope comes from the rule instead of from a run.** *Name a repair or name a decision* applies to a refusal without anyone meeting it, and the 16-of-126 measurement already says how much there is.

**The round also placed the stack-aware wording.** A refusal must not say `gh auth login` to a Bitbucket team, and the question was where that knowledge lives. **The connector**: it already knows its vendor and its CLI, so no script branches on the stack and `plot-host.sh` stays a collector. That is the connector contract applied to words rather than budgets.

**The walkthrough is not lost.** It belongs in the release test list, where `fleet-user-test.md` already lives and where a person is already reading a checklist.
