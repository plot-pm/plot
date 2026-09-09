# A lifecycle action needs a controller receipt

> *The master agent uses the controllers* is a rule, and a rule is a thing an agent rationalises around. Measured 2026-09-09: five dispatches in one session went to `plot-dispatch.sh` directly, and nothing said so — the violation surfaced because a person asked.

## Status

- **State:** Approved
- **Type:** feature
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1
- **Approved:** 2026-09-09, Jan Wloka, plan-PR #863 merged

## Changelog

- Calling a lifecycle script directly is refused. `plot-controller-gate.sh` clears only on a receipt the controller leaves before it spawns, so routing an action past the controller stops at the tool call instead of being noticed later, or never.

Board impact: no. The gate sits in front of the scripts the board already calls; the board's own path writes the receipt and is unaffected.

## Motivation

**`CLAUDE.md` states the rule and the same file states why a rule is not enough:**

> A master agent performs a lifecycle action by calling its controller. Not the script the controller calls, not `sed` over the field the script writes.

> **The test:** Can you answer "Did I complete this?" without actually doing the work? If yes, it's a rule. If no, it's a gate.

Routing through a controller fails that test today. Nothing observes it, so the answer is always *yes, I followed it* — including when it is false.

### Measured in one session, by the agent that was told the rule

**2026-09-09.** Every dispatch went to `plot-dispatch.sh` directly: five invocations across four plans. The agent had read the rule, had the board running and answering on `:7777`, and still called the script — because the script is what the skill's own prose names, and nothing between the intent and the call disagreed.

**It surfaced only when the operator asked** *"Don't we have a controller command dispatch?"* That is the same shape the state gate was built for: `CLAUDE.md` records four hand edits to `State:` lines in one session, each invisible to review, and closes with *"an editor on a markdown line invokes nothing"*. A script call invokes something — which is exactly what makes it gateable.

### The gap the rule cannot see

`/api/dispatch` spawns `plot-dispatch.sh` (`approve.ts:51`), so the script has one legitimate caller and one illegitimate one, and they are **byte-identical at the command line**. No grep separates them. A commit message, a branch name and an author are all things an agent types; so is `bash skills/plot/scripts/plot-dispatch.sh <slug>`.

**The state gate already solved this exact problem one layer down.** `plot-state-gate.sh` refuses a commit that changes a `State:` line unless the owning script left a receipt, and states the property that makes it work:

> The receipt is what makes this a gate: a commit message, the branch and the author are all things an agent types, while a receipt is only produced by running the script.

A controller receipt is the same instrument aimed one layer earlier: **only the controller can leave it, because only the controller runs before the script does.**

## Design

### The receipt is the controller's, and the shape is already written

`plot-state-receipt.sh` is sourced by the three scripts that own a `State:` line and by the gate that refuses every other writer — one file, because *"the gate and the owners must agree on where a receipt lives"*. This plan adds a second receipt kind with the same properties: machine-local under `.plot/state/` (a receipt travelling in a commit would clear the gate on every checkout that pulled it).

**It is spent on the action COMPLETING, not on the gate clearing**, and that is a deliberate difference from the state gate's receipt. `plot-approve.sh` and `plot-deliver.sh` are documented as idempotent precisely because their irreversible step is a host write: *"re-running is the repair for any interruption after it"*. A receipt spent at the gate would refuse that repair, turning the documented fix into a second controller call — and the operator most likely to need it is the one whose first run died halfway. So the gate clearing leaves the receipt in place, the script's own successful exit spends it, and a failed run can be retried on the same licence.

**The controller writes it immediately before spawning.** `/api/dispatch`, `/api/approve` and `/api/deliver` already spawn detached and immediately; the receipt is written in the same function, naming the script and the slug.

### What is gated, and what is deliberately not

**Gated: the lifecycle scripts a controller endpoint owns.** `plot-dispatch.sh`, `plot-approve.sh`, `plot-deliver.sh` — the three measured being called directly, each with a live endpoint.

**Not gated: `gh` and `git`, though both were used to bypass a controller in the same session.** `gh pr merge` on a plan PR *is* the approval under `Review: pr`, and `git push origin HEAD:main` writes what a controller would have written. They are left out because **a refusal must name a route**, and neither has an endpoint to point at: refusing `gh pr merge` with no alternative produces a gate whose only possible response is the escape hatch, which is the shape people turn off. The three scripts each have a live endpoint, so every refusal this gate issues can name a real command.

**Not gated: everything read-only.** `plot-fleet-scan.sh`, `plot-reconcile-scan.sh`, `plot-pr-state.sh` and the rest change nothing, and gating a read would make the estate unaskable without a running board. The gate's population is *scripts that write*, which is the same boundary `plot-dispatch.sh` names for itself: *"THIS IS THE ONE SCRIPT IN THE FLEET THAT WRITES."*

**Not gated: a call from inside a desk.** `plot-worker-loop.sh` runs in a dispatched worktree and reaches for the same helpers, and a dispatched worker is a `claude -p` process **inheriting the same plugin hooks** — so its tool calls reach this gate exactly as the master agent's do. The exemption is therefore explicit rather than accidental.

**The desk IS the exemption, read from where the call runs.** A call whose working directory is inside a dispatch worktree is a worker's; one from the repository root is the master agent's. That is the same distinction every other component already makes — `plot-dispatch.sh` finds a desk by asking git which worktree holds a branch, and `plot-reap.sh` recognises one by its `.plot-worker.pid`.

**Not an environment variable, and the reason is the whole design.** `PLOT_WORKER=1` would be simpler and it is refused for the same argument the receipt rests on: an env var is something an agent sets, and the gate exists because a master agent's own assertions cannot be trusted. A working directory is a measurement.

### An operator typing the script is gated too, and Plot stops advising it

**The refusal applies to a person at a terminal**, because a hand-typed script call bypasses the controller exactly as an agent's does. The escape hatch below is what serves the operator whose board is not running.

**So Plot must stop printing advice its own gate refuses.** `plot-worker-loop.sh:1497` tells the reader *"stop it with `plot-dispatch.sh --stop <branch>`"*, and after this change that sentence names a route the gate blocks. The slice owns both halves: the message names the controller, and the gate refuses the script. A tool that advertises one path and refuses it is worse than either alone.

### It fails OPEN on its own machinery, and CLOSED on the case it exists for

The two directions are the state gate's, and they are not symmetric by accident:

- **No `.plot/state/`, no board, no git** → allow, and say the routing went unverified. A gate that broke an unconfigured repository would be removed by the first person it blocked.
- **A gated script invoked with no receipt** → **refuse**, naming the endpoint to call instead. That is the case the gate exists for, and it is the one direction that must never be lenient.

**The refusal names the repair**, because a refusal an operator cannot act on becomes a flag somebody turns off:

```
plot-controller-gate: plot-dispatch.sh is a controller-owned action.
  Call the controller instead:  POST /api/dispatch {"slug":"<slug>"}
  Or, where the board is not running and you accept the bypass:
      plot-state-receipt.sh --unowned-action dispatch <slug> "<reason>"
```

### The escape is named, recorded, and counted

**A gate with no exit is one people route around**, which `CLAUDE.md` says of `plot-dispatch.sh`'s `--allow-local` and of `plot-state-receipt.sh --unowned`. The board is optional — `plot-ask.mjs` exists precisely because *"a board is optional and none was running when the choice was measured"* — so a gate requiring HTTP would strand every repository without one.

The escape follows the existing precedent exactly: the **reason is required**, and each use appends to `.plot/state/unowned-action-writes.tsv`. That file is the measurement of how large the routing gap still is, the way `unowned-state-writes.tsv` already counts the three writes no script owns.

### Not chosen: making the skills call the controller and trusting them

That is today's design. `/plot-dispatch`'s prose names the script, and a skill instruction is a rule with the same failure mode as the one being fixed. **Rewriting the prose is still worth doing** — it is what the agent reads first — but it is a rule improvement, not a gate, and this plan exists because the rule was insufficient.

### Not chosen: gating on the board's presence

*"Is a board running?"* is not the question. A repository with no board must still dispatch, and one **with** a board can still be bypassed by calling the script. The receipt asks the right question — *did the controller run?* — and the board's presence is neither necessary nor sufficient for it.

### Open Questions

- [ ] **Does the worker loop need an exemption, or does it inherit one?** A dispatched agent's calls originate inside a worktree the controller created. If the hook cannot tell that context from the master agent's, the loop needs a named exemption rather than an accident.
- [ ] **What happens to a second `--restart` while one receipt is unspent?** Receipts are spent on clearing, so two rapid controller calls leave two receipts. Whether they must be distinguishable per-slug is the slice's measurement.

## Slices

### Refusing

- `feature/a-controller-action-leaves-a-receipt` <!-- builds: the controller-action receipt and the gate that refuses an unreceipted lifecycle script --> — `plot-state-receipt.sh` gains the action-receipt kind, the three endpoints write one before spawning, and `plot-controller-gate.sh` refuses a gated script invoked without one.

  **Asserted: a direct `plot-dispatch.sh` call is REFUSED and names the endpoint** — the exact invocation measured five times on 2026-09-09. **Asserted: the same call through `/api/dispatch` succeeds**, since a gate that broke the legitimate path is worse than no gate.

  **Asserted: a call from inside a dispatch worktree is allowed** — a dispatched worker inherits these hooks, so without this every worker breaks. **Asserted: the exemption reads the working directory, never an environment variable** — an env var is something an agent sets, and this gate exists because an agent's own assertions cannot be trusted.

  **Asserted: a retry after a FAILED run is allowed on the same receipt** — `plot-approve.sh` and `plot-deliver.sh` document re-running as the repair for an interruption, and a gate that refused it would break the fix for the exact case it is most needed in. **Asserted: a second run after a SUCCESSFUL one is refused** — the receipt is spent by the script's own exit, so the licence covers one completed action.

  **Asserted: `plot-worker-loop.sh` no longer prints `plot-dispatch.sh --stop` as advice** — it names the controller, so Plot never advertises a route its own gate refuses. **Asserted: an operator typing the script is gated like an agent**, with the escape hatch as the answer for a machine running no board.

  **Asserted: a read-only script is never gated** — `plot-fleet-scan.sh` runs with no receipt and no board. **Asserted: `gh` and `git` are not gated** — a refusal must name a route, and neither has an endpoint to name. **Asserted: it fails OPEN with no `.plot/state/`, and says the routing went unverified** — failing open, not failing silently. **Asserted: the escape records its reason** to `.plot/state/unowned-action-writes.tsv`, because an uncounted escape is an off switch.

## Notes

Written 2026-09-09, in the session that produced the measurement. The agent writing this plan is the one that violated the rule five times, which is the argument for the gate rather than against it: the rule was read, understood, restated to the operator, and broken anyway.

**The receipt instrument is not invented here.** `plot-state-receipt.sh` and `plot-state-gate.sh` shipped on 2026-09-09 for the layer below, and this reuses both the mechanism and its failure directions. A second implementation of *what is a receipt* would be the drift this estate has already paid for twice.

Definition of Done: docs/definition-of-done.md
