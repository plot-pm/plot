# A first-run refusal names its repair

> 16 of 126 refusals across the five scripts a first run touches name the command that fixes them. The other 110 state a cause and stop, which works when somebody who knows Plot is sitting next to you.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches

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

**Not a change to what refuses.** Every gate keeps its condition. Only the sentence changes.

## Slices

### The walkthrough names the reachable refusals (Branch: docs/the-reachable-refusals-are-listed)

A Bitbucket/Jenkins/Jira checkout is adopted and driven to a delivered plan, and every refusal met is recorded with its message.

**THIS RUNS FIRST AND ITS OUTPUT IS THE SCOPE.** Guessing which of 126 a newcomer hits is the error the measurement above exists to avoid — 13% is a fact about all of them and says nothing about which matter.

**IT IS RUN WITH NO CREDENTIALS FIRST, THEN WITH THEM.** The unauthenticated pass reaches the connector refusals a teammate meets before their tokens are set up, which is the first thing that happens on a new machine.

**Done when** the reachable refusals are listed with their current wording, the list distinguishes the credential-less pass from the authenticated one, and each entry says whether it names a repair.

### The reachable refusals name their repair (Branch: bug/a-first-run-refusal-names-its-repair) <!-- waits: docs/the-reachable-refusals-are-listed -->

Each refusal on that list names the command that fixes its condition.

**IN THE READER'S STACK, NOT OURS.** *"`gh` not authenticated"* is wrong advice on a Bitbucket team. A refusal from a connector names that connector's CLI.

**A REFUSAL THAT CANNOT NAME A REPAIR SAYS SO.** Some conditions have no single fix — a conflict, a plan somebody must decide about. Those name what the reader must decide, which is still more than a cause.

**THE `--stop` REFUSAL IS FIXED HERE OR NOT AT ALL.** It is on the list, it is wrong rather than terse, and `a-dispatch-stop-finds-the-desk` fixes the lookup. **This slice fixes the sentence even if the lookup lands later**, because a wrong refusal is the worst kind.

**Done when** every listed refusal names a repair or names a decision, no message names a CLI the reader's stack does not use, and the walkthrough is repeated with zero moments where a person had to be asked.

## Notes

### Why the count is the wrong target — 2026-09-07

13% could be raised to 100% by appending advice to 110 messages, and the sprint would be no closer to its goal. **The target is the walkthrough's count of moments somebody had to be asked**, which is zero or not zero, and which no amount of rewording reaches without running it.
