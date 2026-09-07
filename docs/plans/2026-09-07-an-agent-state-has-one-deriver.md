# An agent state has one deriver

> The domain declares the eight agent states, validates transitions between them, and derives none. `plot-worker-state.sh` decides all eight from readings — and it is the only thing that does.

## Status

- **State:** Draft
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 1

## Changelog

- One rule derives an agent's state from readings, in the domain, so the eight states are decided where they are declared.

## Motivation

**Measured 2026-09-07, answering *is any lifecycle still outside the domain?***

`AgentState` is a declared lifecycle: eight states in `entities/agent.ts:15`, a `transitions/agent.ts` beside it, and the state-declaration gate reads clean at `lifecycle=11`. **The gate is right and the lifecycle is not owned.**

**THE DOMAIN VALIDATES; IT DOES NOT DERIVE.** `observeAgentState` refuses an unrecognised state and judges a transition legal — *given* a state somebody already decided. **`STATE_SOURCE` even records which of the eight come from the process and which from the desk.** What no domain function does is take readings and answer *which of the eight is this*.

**`plot-worker-state.sh` DOES.** All eight words appear in it — `running` 18 times, `finished` 17, `ended` 14, `stalled` 12, and `waiting`, `none`, `failed`, `elsewhere` 8, 8, 8 and 4. Its header calls it *"the ONE answer to 'is a worker running in this worktree?'"*, and it is sourced by both `plot-dispatch.sh` and `plot-fleet-scan.sh` — **so the duplication it was written to remove exists one layer up, between it and the domain.**

**AND `observeAgentState` IS REACHED BY A RE-EXPORT.** `index.ts:210` and nothing else. **This is the third instance of one shape in one session** — `scoreItem` through `openPromises`, `runs()` on the wrong port, and now this: a correct domain rule that production never calls.

**THE VOCABULARIES AGREE, WHICH IS WHY THIS IS INVISIBLE.** The shell's eight words and the domain's eight are the same eight. Nothing disagrees today, so nothing fails — and a reader grepping `AgentState` finds an enum, a transition file and a gate that passes, and concludes the lifecycle is owned.

**`free.ts` ALREADY NAMES A THIRD SPELLING.** Its comment: *"Two vocabularies spell this fact: the domain's eight process states and the board registry's five. They overlap on `running` — the only value this rule tests — and are not equal."* **Three spellings of one fact, and the rule that needs it takes a plain string to avoid choosing.**

## What this is not

**Not a rewrite of `plot-worker-state.sh`.** It reads the process table and the desk, and that is gathering — the right work in the right place. What moves is the `if` chain that turns readings into a word.

**Not a change to the eight states.** They are correct and they are the same in both places.

**Not a merge of the board registry's five.** `free.ts` is right that they are not equal; unifying them is a separate question this plan does not answer.

## Slices

### The domain derives the agent state (Branch: feature/an-agent-state-has-one-deriver)

A rule takes the readings `plot-worker-state.sh` gathers and returns one of the eight.

**READINGS AS VALUES, NO I/O.** The pid, its liveness, the exit code, the desk's dirtiness, a `PLOT-BLOCKED` marker, whether a worktree exists on this machine. The shell keeps reading them; the rule decides.

**`STATE_SOURCE` IS THE SPECIFICATION AND IT IS ALREADY WRITTEN.** `transitions/agent.ts:43` maps every state to whether the process or the desk answers it. A deriver that contradicts it is wrong by the domain's own record.

**THE SHELL REACHES IT THE WAY THE ESTATE ALREADY DOES.** `plot-ask.mjs` is the seam: a built bundle, `node`, no running board. Do not invent a second mechanism.

**A CORPUS TEST COMPARES BOTH ANSWERS OVER THE LIVE ESTATE.** Every desk on the machine, scored by the shell and by the rule, asserted equal. **That is what makes the agreement a fact rather than a coincidence** — the two vocabularies match today and nothing enforces it.

**Done when** one rule derives an agent's state from readings, `plot-worker-state.sh` calls it rather than deciding, `STATE_SOURCE` and the deriver cannot disagree, and a corpus test asserts both answers match on every desk.

## Notes

### Why the gate reads clean and the lifecycle is not owned — 2026-09-07

`check-state-declarations.sh` asks whether a state enum **declares its kind**, and `AgentState` does. It cannot ask whether anything **derives** one, because a derivation in bash has no enum for the gate to see.

**So the gate is honest about its own question and silent about this one.** The sprint that built it wrote *"a rule the domain owns that a script routes around is not enforced"* — and this is that case, in the lifecycle the fleet reads most.
