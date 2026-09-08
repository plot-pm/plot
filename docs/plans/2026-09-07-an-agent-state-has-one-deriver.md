# The two agent-state answers are held together

> The domain declares the eight agent states, validates transitions between them, and derives none. `plot-worker-state.sh` decides all eight — and nothing asserts the two agree.

## Status

- **State:** Approved
- **Type:** bug
- **Sprint:** the-board-serves-a-team
- **Story:** the-domain-knows-what-plot-knows
- **Review:** pr
- **Impl:** own branches
- **Rounds:** 2
- **Approved:** 2026-09-07, Jan Wloka, plan-PR #790 merged

## Changelog

- A test asserts the domain and the shell answer the agent's state identically on every desk, so the agreement they already have becomes a fact rather than a coincidence.

## Motivation

**Measured 2026-09-07, answering *is any lifecycle still outside the domain?***

`AgentState` is a declared lifecycle: eight states in `entities/agent.ts:15`, a `transitions/agent.ts` beside it, and the state-declaration gate reads clean at `lifecycle=11`. **The gate is right and the lifecycle is not owned.**

**THE DOMAIN VALIDATES; IT DOES NOT DERIVE.** `observeAgentState` refuses an unrecognised state and judges a transition legal — *given* a state somebody already decided. **`STATE_SOURCE` even records which of the eight come from the process and which from the desk.** What no domain function does is take readings and answer *which of the eight is this*.

**`plot-worker-state.sh` DOES.** All eight words appear in it — `running` 18 times, `finished` 17, `ended` 14, `stalled` 12, and `waiting`, `none`, `failed`, `elsewhere` 8, 8, 8 and 4. Its header calls it *"the ONE answer to 'is a worker running in this worktree?'"*, and **five scripts source it**: `plot-dispatch.sh`, `plot-fleet-scan.sh`, `plot-fleetctl.sh`, `plot-quiet-stretch.sh` and `plot-worker-loop.sh`. **So the duplication it was written to remove exists one layer up, between it and the domain.**

**AND ONE OF THE FIVE IS THE AGENT'S OWN LOOP.** `plot-worker-loop.sh` runs per agent, unattended, for the length of a slice. Round 2 measured `node` startup at **39 ms**, so a deriver every caller must shell to is 39 ms × five callers × every pass — on a machine this session already saw at load 43.

**AND `observeAgentState` IS REACHED BY A RE-EXPORT.** `index.ts:210` and nothing else. **This is the third instance of one shape in one session** — `scoreItem` through `openPromises`, `runs()` on the wrong port, and now this: a correct domain rule that production never calls.

**THE VOCABULARIES AGREE, WHICH IS WHY THIS IS INVISIBLE.** The shell's eight words and the domain's eight are the same eight. Nothing disagrees today, so nothing fails — and a reader grepping `AgentState` finds an enum, a transition file and a gate that passes, and concludes the lifecycle is owned.

**`free.ts` ALREADY NAMES A THIRD SPELLING.** Its comment: *"Two vocabularies spell this fact: the domain's eight process states and the board registry's five. They overlap on `running` — the only value this rule tests — and are not equal."* **Three spellings of one fact, and the rule that needs it takes a plain string to avoid choosing.**

## What this is not

**Not a rewrite of `plot-worker-state.sh`.** It reads the process table and the desk, and that is gathering — the right work in the right place. What moves is the `if` chain that turns readings into a word.

**Not a change to the eight states.** They are correct and they are the same in both places.

**Not a merge of the board registry's five.** `free.ts` is right that they are not equal; unifying them is a separate question this plan does not answer.

## Slices

### A test asserts the two answers agree (Branch: feature/an-agent-state-has-one-deriver) <!-- waits: infra/a-shell-script-asks-the-domain -->

The domain derives the eight states from readings, and a corpus test proves it answers what the shell answers on every desk.

**THE DERIVATION LANDS IN THE DOMAIN AND THE SHELL KEEPS ITS OWN.** This is the shape `plot-pr-merged.sh` already has and it is not a compromise: **four scripts source it** — `plot-reap.sh`, `plot-release-refs.sh`, `plot-dispatch.sh`, `plot-quiet-stretch.sh` — while `rules/reapable.ts` and `rules/queue.ts` answer the same question in TypeScript. **One question, two implementations, and the estate's most consequential refusal rides on it.** What makes that safe is not that one of them is authoritative; it is that they are held together.

**THE MECHANISM IS NOT THIS PLAN'S TO STATE.** [`a-shell-script-asks-the-domain`](2026-09-07-a-shell-script-asks-the-domain.md) states when a shell script may keep a duplicate, where a call goes when it does not, and how a corpus comparison holds the pair — `docs/shell-and-domain.md`. This slice builds its comparison to that contract rather than restating it; the paragraph above records why this rule is a duplicate, which is the one fact the contract cannot know.

**SO THE TEST IS THE DELIVERABLE, NOT THE MOVE.** What is missing today is not one implementation — it is **any assertion that the two agree**. The shell's eight words and the domain's eight are the same eight, and nothing enforces that. A corpus test over every desk turns a coincidence into a contract, and it lands without touching a hot path.

**READINGS AS VALUES, NO I/O.** The pid, its liveness, the exit code, the desk's dirtiness, a `PLOT-BLOCKED` marker, whether a worktree exists on this machine. The shell keeps reading them; the rule decides from the same values.

**`STATE_SOURCE` IS THE SPECIFICATION AND IT IS ALREADY WRITTEN.** `transitions/agent.ts:43` maps every state to whether the process or the desk answers it. A deriver that contradicts it is wrong by the domain's own record.

**THE TYPESCRIPT SIDE ASKS THE RULE.** `board-server.mjs` and `plot-registryd.mjs` are already in Node and pay no hop, so they read the domain directly. **The five shell callers keep the shell**, and the test is what stops the two drifting.

**Done when** a domain rule derives the eight states from readings, `STATE_SOURCE` and the deriver cannot disagree, the board and the registry ask the rule, a corpus test asserts the shell and the rule answer identically on every desk on the machine, and no shell caller pays a `node` hop.

## Notes

### Why the gate reads clean and the lifecycle is not owned — 2026-09-07

`check-state-declarations.sh` asks whether a state enum **declares its kind**, and `AgentState` does. It cannot ask whether anything **derives** one, because a derivation in bash has no enum for the gate to see.

**So the gate is honest about its own question and silent about this one.** The sprint that built it wrote *"a rule the domain owns that a script routes around is not enforced"* — and this is that case, in the lifecycle the fleet reads most.

### Round 2 — 2026-09-07

**The plan said two scripts source `plot-worker-state.sh`. Five do**, and one of them is `plot-worker-loop.sh` — the agent's own loop, running unattended per agent for the length of a slice. **Measured: `node` starts in 39 ms**, so *"the shell calls the rule"* is 39 ms on every pass of every caller, on a machine this session already saw at load 43.

**That killed the done-when as written**, and looking for the right one found the estate had already answered it. `plot-pr-merged.sh` is sourced by **four** scripts while `reapable.ts` and `queue.ts` answer the same question in TypeScript — *did this land*, the estate's most consequential refusal, deliberately implemented twice. **What makes that safe is not one authority; it is that nothing lets them drift.**

**So the deliverable moved from the move to the test.** The shell's eight words and the domain's eight are the same eight today, by coincidence, with no assertion between them. A corpus test over every desk makes the agreement a fact — and unlike the move, it costs nothing on a hot path and can land first.
