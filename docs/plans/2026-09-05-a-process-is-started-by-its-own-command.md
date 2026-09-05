# A process is started by its own command

> Plot runs two long-lived processes and neither has a command that owns it. The board is started by an adoption command's flag; the supervisor is started by copying a unit file out of a README. Both get a command named for the thing an operator already talks about, and the read that shares one of those names moves to the word it has always printed.

## Status

- **Phase:** Draft
- **Type:** feature
- **Review:** pr
- **Impl:** own branches

## Problem

**Nothing tells a user the supervisor exists.** `plot-registryd` shipped on 2026-09-04 with launchd and systemd units and a README that installs them. Measured the same day: `plot-init` and `plot-board-setup` mention it **zero times**, and no skill references `skills/plot/units/`. A user adopting Plot in their own repository learns about the board, dispatches agents, and never learns that the thing supervising those agents is not running.

**The board is started by an adoption command.** `/plot-board-setup --start` is documented as *"the daily action, not the ceremony"* — a runtime verb living inside a command whose other four steps probe, propose, write config and verify. Adoption happens once; starting happens every day.

**And the name a user would reach for is taken by a report.** `/plot-fleet` answers *what is the fleet doing, and what should I do?* — stateless, one pulse line written, nothing spawned. It is the right command and the wrong name for the namespace: an operator who wants to start the fleet's supervisor will type `/plot-fleet` and get a report.

**The vocabulary is already settled and already printed.** That report is a *pulse*: the skill says so 26 times, its own step 5 is *Append a Pulse Line*, the scan ends with `Pulse complete.`, and `DESIGN-pulse.md` defines the entity. The command has been called a pulse all along; only its name said otherwise.

## What this is not

**Not a rename of `plot-fleet-scan.sh`.** The scan reads the fleet and that name stays right. Measured 2026-09-05: of 284 files mentioning `plot-fleet`, only **22 references across 13 files** name the COMMAND — the rest are the script.

**Not a rewrite of the estate's prose.** 97 files under `docs/` mention `/plot-fleet` in plans, sprints and stories. Those are records of what was true when written, and rewriting them destroys `git blame` for a word. Same rule the `## Slices` migration applied to delivered plans.

**Not a new supervisor.** `plot-registryd` exists, ticks in 427 ms, and decides without performing. This plan gives it a door, not a body.

**And not a new agent.** The worker loop exists too. What is missing is the command that brings one into existence — see *Starting an agent*, which was added after a dispatch on 2026-09-05 queued a slice that no agent could take.

## Slices

### Freeing the name (Branch: feature/the-pulse-is-called-a-pulse)

`/plot-fleet` becomes `/plot-pulse`. The skill directory moves, its frontmatter and the 22 live command references follow, and `plot-fleet-scan.sh` does not move.

**A clean break, not an alias.** The name is being REUSED by the next slice, so an alias answering the old behaviour would be worse than an error: a user typing `/plot-fleet` expecting to start something would get a report and no indication they had asked for the wrong thing. Between the two slices the command is simply gone, which is a state a person can read.

**Done when** `/plot-pulse` reports what `/plot-fleet` reported, `pnpm test` passes (it validates that every skill parses and every `bumps:` names a real directory, so a missed reference fails CI), and `grep -rn 'plot-fleet' skills/ packages/*/src CLAUDE.md README.md` returns only `plot-fleet-scan` matches.

### Starting the fleet (Branch: feature/the-fleet-has-a-door)

`/plot-fleet` returns as the supervisor's command: `--start`, `--stop`, `--status`.

**It probes before it acts, and refuses rather than repairs** — the discipline `plot-board-setup` already applies. Four refusals, each a measurement:

| refusal | why |
|---|---|
| no `plot-registryd.mjs` | nothing to start; point at `pnpm build:board` |
| `node` is not the pinned major | **the unit bakes `$NODE` in permanently.** Measured 2026-09-05: `command -v node` on this machine answers 26.7.0 against a repo pinned to 24 |
| platform is neither launchd nor systemd | there is no unit to fill |
| a unit with that label is already loaded | launchd keys by label; a second repo needs a distinct one |

**`--once` is the gate.** The supervisor decides and performs nothing, so one tick against the live estate is free and proves the thing works before any unit is installed — the same shape as `--start` proving the board serves.

**Done when** `/plot-fleet --start` installs and loads the unit on macOS and Linux, `--status` answers whether it is alive without starting it, `--stop` unloads it, and each refusal above is reachable and names its repair.

### Starting the board (Branch: feature/the-board-has-a-door)

`/plot-board` takes `--start`, `--stop`, `--status`, and `plot-board-setup` keeps only adoption.

The starting logic MOVES rather than being rewritten: `--start` already resolves the artifact through `plot-board-probe.sh`, refuses when `artifact_source` is `none`, and warns when `cwd_is_root` is false because the board compares realpaths. `--status` is new and cheap — the server already answers *"Plot board already running at ..."* on its port.

**`plot-board-setup --start` is removed, not aliased**, for the reason the first slice gives: a flag that still works teaches the wrong command.

**Done when** `/plot-board --start` starts what `--start` started, `--status` reports the port and whether it answers, `plot-board-setup` no longer documents a `--start` step, and its README says where the flag went.

### Starting an agent (Branch: feature/an-agent-is-started-by-a-command)

`/plot-fleet --start` brings the supervisor up. Nothing brings an AGENT up, and
without one the supervisor has nobody to hand work to.

**Measured 2026-09-05, and this slice was added because of it.**
`/plot-dispatch the-workflow-owns-the-word-phase` reported `handed over
feature/a-plan-has-a-state → the registry` and `started=0`, which is correct
under the hand-over model. The supervisor then ticked `agents=0 queued=455
handed=0`: the slice is queued, the registry is willing, and there is no agent
in `.plot/agents/` to take it.

**The chain is dispatch queues → registry matches → an agent takes it, and the
last link has no starter.** Dispatch no longer spawns, by design. `--restart`
cannot stand in: it hands an EXISTING claim to a new worker, and the hand-over
deliberately pushes no claim, so there is nothing for it to restart.

**The four reaped desks are how this became visible rather than what caused
it.** An estate that happens to hold a free agent hides the gap; an empty one
shows it. The gap is in the model, not in the estate.

**Done when** a command brings an agent into existence with no slice assigned —
free, registered, waiting — and the supervisor's next tick hands it the queued
slice without a person touching the desk.

### Saying so where a user looks (Branch: docs/adoption-names-the-processes)

`/plot-init` and `/plot-board-setup` name both runtime commands in their closing summary, and the root README's skills table carries all three.

This is the slice the whole plan exists for: **the supervisor was invisible**, and a door nobody is told about is the same as no door.

**Done when** a reader who has just run `/plot-init` in a fresh repository is told, in that command's own output, that `/plot-board --start` and `/plot-fleet --start` exist and what each one does.

## Notes

### Why the flags do not go on the read — 2026-09-05

`/plot-pulse` keeps the contract `/plot-fleet` had: derived from git, nothing stored, one pulse line appended. Hanging `--start` on it would put a spawn inside the one command whose stated property is that it does not spawn.

**But `--status` is a reading**, and the pulse should report it: a fleet with dispatched agents and no supervisor is a fact an operator wants in the report they already run, next to the advice. That is a follow-on, not this plan — it depends on `--status` existing first.

### Why `plot-registry` was rejected — 2026-09-05

The supervisor IS the registry's, and `DESIGN-agent.md` draws `registry ──provides──► agents`. But that is domain vocabulary: naming the command `/plot-registry` asks a user to know that a registry exists, that it supervises agents, and that supervising is what starting means. **The fleet is the noun an operator already uses.** The registry stays the right word inside the domain and the wrong word on a command.
